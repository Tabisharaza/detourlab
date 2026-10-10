#!/usr/bin/env node
import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// This is deliberately independent of build.js and manifest.json. Review any
// addition here: recursively copying a source folder must not publish a new
// configuration file, credential, private fixture, or development artifact.
export const RELEASE_FILES = Object.freeze([
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'examples/meridian-all-bridges.json',
  'examples/meridian-default.json',
  'examples/meridian-experiment.json',
  'examples/minimal-directed.json',
  'examples/minimal-experiment.json',
  'index.html',
  'public/favicon.svg',
  'src/app.js',
  'src/engine.d.ts',
  'src/engine.js',
  'src/experiment.d.ts',
  'src/experiment.js',
  'src/file-input.js',
  'src/map.js',
  'src/scenario.js',
  'src/simulation-worker.js',
  'src/style.css',
  'src/tutorial.js',
]);

const allowedFiles = new Set([...RELEASE_FILES, 'manifest.json']);
const allowedDirectories = new Set(RELEASE_FILES.flatMap(file => {
  const segments = file.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireSameNames(actual, expected, label) {
  const missing = expected.filter(name => !actual.includes(name));
  const extra = actual.filter(name => !expected.includes(name));
  if (missing.length || extra.length) {
    throw new Error(`${label}: missing [${missing.join(', ')}]; unexpected [${extra.join(', ')}]`);
  }
}

async function readDistribution(directory) {
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('Distribution root must be a real directory, not a symbolic link');
  }
  const files = new Map();
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link is not a release file: ${name}`);
      if (entry.isDirectory()) {
        if (!allowedDirectories.has(name)) throw new Error(`Unexpected release directory: ${name}`);
        await visit(name);
      } else if (entry.isFile()) {
        if (!allowedFiles.has(name)) throw new Error(`Unexpected release file: ${name}`);
        files.set(name, await readFile(path.join(directory, name)));
      } else {
        throw new Error(`Non-regular release entry: ${name}`);
      }
    }
  }
  await visit();
  requireSameNames([...files.keys()], [...allowedFiles], 'Distribution file list');

  const manifest = JSON.parse(files.get('manifest.json').toString('utf8'));
  if (!isRecord(manifest) || manifest.version !== 1 || !isRecord(manifest.files)) {
    throw new Error('Manifest must contain version 1 and a file-hash object');
  }
  requireSameNames(Object.keys(manifest), ['version', 'files'], 'Manifest fields');
  requireSameNames(Object.keys(manifest.files), RELEASE_FILES, 'Manifest file list');
  for (const file of RELEASE_FILES) {
    const bytes = files.get(file);
    const hash = manifest.files[file];
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash) || sha256(bytes) !== hash) {
      throw new Error(`Manifest SHA-256 mismatch: ${file}`);
    }
    const source = path.join(root, file);
    if (!(await lstat(source)).isFile()) throw new Error(`Source must be a regular file: ${file}`);
    if (!bytes.equals(await readFile(source))) throw new Error(`Distribution differs from source: ${file}`);
    if ((file === 'LICENSE' || file === 'THIRD_PARTY_NOTICES.md') && !bytes.toString('utf8').trim()) {
      throw new Error(`License notice is empty: ${file}`);
    }
  }
  return files;
}

// Both trees are independently verified, then compared as bytes (including the
// manifest itself). Matching manifests alone are not reproducibility evidence.
export async function verifyDist(directory = path.join(root, 'dist'), reference) {
  const files = await readDistribution(path.resolve(directory));
  if (reference !== undefined) {
    const previous = await readDistribution(path.resolve(reference));
    for (const [file, bytes] of files) {
      if (!bytes.equals(previous.get(file))) throw new Error(`Rebuild differs byte-for-byte: ${file}`);
    }
  }
  return { files: RELEASE_FILES.length, compared: reference !== undefined };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 2 || args.some(arg => arg.startsWith('--'))) {
    console.error('Usage: node scripts/verify-dist.js [distribution-directory] [reference-directory]');
    process.exitCode = 2;
  } else {
    try {
      const result = await verifyDist(...args);
      console.log(`Verified ${result.files} release files: SHA-256 hashes, exact allowlist, source bytes, and license notices.${result.compared ? ' Rebuild matches all file bytes, including manifest.json.' : ''}`);
    } catch (error) {
      console.error(`DetourLab release verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
