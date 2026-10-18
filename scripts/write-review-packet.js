import * as fileSystem from 'node:fs/promises';
import path from 'node:path';
import { REPORT_LIMITS } from './experiment-report.js';

const STAGING_PREFIX = '.detourlab-review-';
const FILES = Object.freeze([
  { name: 'REVIEW.md', key: 'reviewMarkdown', limit: REPORT_LIMITS.maxReviewBytes },
  // The machine-readable bundle appears last, after the complete review exists.
  { name: 'bundle.json', key: 'bundleJson', limit: REPORT_LIMITS.maxBundleBytes },
]);
const sameFile = (actual, expected) => actual.dev === expected.dev && actual.ino === expected.ino;

async function inspect(fs, filename) {
  try { return await fs.lstat(filename, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function matchesDirectory(fs, directory, identity) {
  const current = await inspect(fs, directory);
  return current !== null && current.isDirectory() && sameFile(current, identity);
}

function packetBytes(serialized) {
  return FILES.map(file => {
    const text = serialized?.[file.key];
    if (typeof text !== 'string' || !text.endsWith('\n')) {
      throw new Error('Review packet files must be serialized text ending with a newline.');
    }
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > file.limit) {
      throw new Error(`${file.name} exceeds the ${file.limit / (1024 * 1024)} MiB output limit.`);
    }
    return { ...file, bytes };
  });
}

/**
 * Write exactly two bounded files without replacing an existing destination.
 *
 * Stage complete bytes in a private sibling directory, then reserve the target
 * with exclusive mkdir. Hard links publish complete files without replacing any
 * existing entry. REVIEW.md is published first and bundle.json last. Portable
 * Node does not offer an atomic no-replace directory rename: a concurrent reader
 * can see an empty/one-file destination. Both files and matching integrity are
 * the completeness criterion. Unsupported hard links fail rather than falling
 * back to an overwrite-prone rename or copy.
 *
 * Cleanup is limited to the two fixed filenames with owned dev/inode identities
 * and empty, owned directories, never recursive removal. A crash, cleanup I/O
 * failure, or hostile concurrent parent-directory mutation can leave artifacts;
 * this is not a crash-durable transaction or a sandbox for untrusted co-writers.
 * The optional filesystem argument exists for deterministic failure tests.
 */
export async function writeReviewPacket(directory, serialized, fs = fileSystem) {
  const files = packetBytes(serialized);
  if (typeof directory !== 'string' || !directory.trim() || directory.includes('\0')) {
    throw new Error('Output directory must be a nonempty filesystem path.');
  }
  const requested = path.resolve(directory);
  const parent = await fs.realpath(path.dirname(requested));
  const parentIdentity = await fs.lstat(parent, { bigint: true });
  if (!parentIdentity.isDirectory()) throw new Error('The output parent must be an existing directory.');
  const target = path.join(parent, path.basename(requested));
  if (await inspect(fs, target)) throw new Error('Output destination already exists; choose a new directory.');

  let stage;
  let stageIdentity;
  let targetIdentity;
  const staged = new Map();
  let targetReserved = false;

  // Return false rather than deleting through a path whose identity has changed.
  async function cleanDirectory(directoryPath, identity) {
    if (!directoryPath) return true;
    if (!identity) return false;
    let clean = true;
    try {
      const current = await inspect(fs, directoryPath);
      if (!current) return true;
      if (!current.isDirectory() || !sameFile(current, identity)) return false;
      for (const file of files) {
        const expected = staged.get(file.name);
        if (!expected) continue;
        // Recheck the enclosing directory before every destructive operation.
        if (!await matchesDirectory(fs, directoryPath, identity)) return false;
        const filename = path.join(directoryPath, file.name);
        const entry = await inspect(fs, filename);
        if (!entry) continue;
        if (!entry.isFile() || !sameFile(entry, expected)) { clean = false; continue; }
        try { await fs.unlink(filename); } catch { clean = false; }
      }
      if (!await matchesDirectory(fs, directoryPath, identity)) return false;
      try { await fs.rmdir(directoryPath); } catch { clean = false; }
    } catch { clean = false; }
    return clean;
  }

  try {
    stage = await fs.mkdtemp(path.join(parent, STAGING_PREFIX));
    // Bound every cleanup path even when a filesystem adapter fails unexpectedly.
    if (path.dirname(stage) !== parent || !/^\.detourlab-review-[A-Za-z0-9]+$/u.test(path.basename(stage))) {
      stage = undefined;
      throw new Error('Could not validate the temporary review directory.');
    }
    stageIdentity = await fs.lstat(stage, { bigint: true });
    if (!stageIdentity.isDirectory()) throw new Error('Temporary review output is not a directory.');
    for (const file of files) {
      const handle = await fs.open(path.join(stage, file.name), 'wx', 0o600);
      try {
        staged.set(file.name, await handle.stat({ bigint: true }));
        await handle.writeFile(file.bytes);
        await handle.sync();
      } finally { await handle.close(); }
    }
    if (!await matchesDirectory(fs, parent, parentIdentity)) throw new Error('Output parent changed during packet creation.');
    try { await fs.mkdir(target, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Output destination already exists; choose a new directory.');
      throw error;
    }
    targetReserved = true;
    targetIdentity = await fs.lstat(target, { bigint: true });
    if (!targetIdentity.isDirectory()) throw new Error('Output destination changed during packet creation.');
    for (const file of files) {
      if (!await matchesDirectory(fs, target, targetIdentity) || !await matchesDirectory(fs, stage, stageIdentity)) {
        throw new Error('Output directory changed during packet creation.');
      }
      const source = path.join(stage, file.name);
      const sourceIdentity = await fs.lstat(source, { bigint: true });
      if (!sourceIdentity.isFile() || !sameFile(sourceIdentity, staged.get(file.name))) {
        throw new Error('Temporary review file changed during packet creation.');
      }
      await fs.link(source, path.join(target, file.name));
    }
    if (!await matchesDirectory(fs, target, targetIdentity)) throw new Error('Output directory changed during packet creation.');
    for (const file of files) {
      const published = await fs.lstat(path.join(target, file.name), { bigint: true });
      if (!published.isFile() || !sameFile(published, staged.get(file.name)) || published.size !== BigInt(file.bytes.length)) {
        throw new Error('Published review file changed during packet creation.');
      }
    }
    // Removing the staging links leaves the complete published files intact.
    if (!await cleanDirectory(stage, stageIdentity)) throw new Error('Could not remove temporary review output.');
    stage = undefined;
    return { directory: target, files: ['bundle.json', 'REVIEW.md'] };
  } catch (error) {
    const targetClean = !targetReserved || (targetIdentity && await cleanDirectory(target, targetIdentity));
    const stageClean = await cleanDirectory(stage, stageIdentity);
    if (!targetClean || !stageClean) {
      throw new Error('Review packet failed and cleanup was incomplete. Inspect the requested destination and sibling .detourlab-review-* directories.', { cause: error });
    }
    throw error;
  }
}
