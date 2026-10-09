import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_FILES, verifyDist } from '../scripts/verify-dist.js';

const root = fileURLToPath(new URL('../', import.meta.url));
let workspace, source, distribution;
const hash = value => createHash('sha256').update(value).digest('hex');

function build() {
  const result = spawnSync(process.execPath, ['scripts/build.js'], {
    cwd: source, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'detourlab-release-test-'));
  source = path.join(workspace, 'source');
  await mkdir(path.join(source, 'scripts'), { recursive: true });
  for (const file of ['index.html', 'src', 'public', 'examples', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'scripts/build.js']) {
    await cp(path.join(root, file), path.join(source, file), { recursive: true });
  }
  build();
  distribution = path.join(source, 'dist');
});
after(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

async function copyDistribution(t) {
  const directory = await mkdtemp(path.join(workspace, 'copy-'));
  await cp(distribution, directory, { recursive: true });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function editManifest(directory, change) {
  const file = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  change(manifest);
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n');
}

test('release verification accepts the real build and compares every file to source', async () => {
  assert.deepEqual(await verifyDist(distribution), { files: RELEASE_FILES.length, compared: false });
  assert.ok(RELEASE_FILES.includes('LICENSE'));
  assert.ok(RELEASE_FILES.includes('THIRD_PARTY_NOTICES.md'));
  assert.equal(new Set(RELEASE_FILES).size, RELEASE_FILES.length);
});

test('two clean builds match all bytes including the manifest and license files', async t => {
  const first = await copyDistribution(t);
  build();
  assert.deepEqual(await verifyDist(distribution, first), { files: RELEASE_FILES.length, compared: true });
});

test('release verification rejects stale manifest hashes', async t => {
  const directory = await copyDistribution(t);
  await writeFile(path.join(directory, 'index.html'), 'changed');
  await assert.rejects(verifyDist(directory), /SHA-256 mismatch: index\.html/);
});

test('self-consistent hashes cannot conceal changed source or license bytes', async t => {
  for (const file of ['index.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    const directory = await copyDistribution(t), bytes = Buffer.from('changed');
    await writeFile(path.join(directory, file), bytes);
    await editManifest(directory, manifest => { manifest.files[file] = hash(bytes); });
    await assert.rejects(verifyDist(directory), /Distribution differs from source/);
  }
});

test('a missing license is rejected even when removed from the manifest', async t => {
  const directory = await copyDistribution(t);
  await rm(path.join(directory, 'LICENSE'));
  await editManifest(directory, manifest => { delete manifest.files.LICENSE; });
  await assert.rejects(verifyDist(directory), /missing \[LICENSE\]/);
});

test('unreviewed private or development files are rejected even with matching manifest entries', async t => {
  for (const file of ['.env', '.npmrc', 'package.json', 'src/.env.local', 'public/credentials.json', 'examples/private.json']) {
    const directory = await copyDistribution(t), bytes = Buffer.from('test fixture, not a credential');
    await writeFile(path.join(directory, file), bytes);
    await editManifest(directory, manifest => { manifest.files[file] = hash(bytes); });
    await assert.rejects(verifyDist(directory), /Unexpected release file/);
  }
});

test('unreviewed directories are rejected even when empty', async t => {
  for (const name of ['.git', 'node_modules', 'public/private']) {
    const directory = await copyDistribution(t);
    await mkdir(path.join(directory, name));
    await assert.rejects(verifyDist(directory), /Unexpected release directory/);
  }
});

test('manifest schema is closed, versioned, and requires a file-hash object', async t => {
  for (const contents of ['not JSON', 'null', '[]', '{"version":2,"files":{}}', '{"version":1,"files":[]}']) {
    const directory = await copyDistribution(t);
    await writeFile(path.join(directory, 'manifest.json'), contents);
    await assert.rejects(verifyDist(directory));
  }
  const directory = await copyDistribution(t);
  await editManifest(directory, manifest => { manifest.timestamp = 'not deterministic'; });
  await assert.rejects(verifyDist(directory), /Manifest fields.*unexpected \[timestamp\]/);
});

test('manifest names cannot escape the release allowlist or list the manifest itself', async t => {
  for (const file of ['../LICENSE', '/etc/passwd', 'src\\app.js', 'manifest.json', '__proto__']) {
    const directory = await copyDistribution(t);
    await editManifest(directory, manifest => {
      Object.defineProperty(manifest.files, file, { value: '0'.repeat(64), enumerable: true });
    });
    await assert.rejects(verifyDist(directory), /Manifest file list.*unexpected/);
  }
});

test('every release file must appear in the manifest', async t => {
  const directory = await copyDistribution(t);
  await editManifest(directory, manifest => { delete manifest.files['src/engine.js']; });
  await assert.rejects(verifyDist(directory), /Manifest file list.*missing \[src\/engine\.js\]/);
});

test('manifest hashes must be exact lowercase SHA-256 values', async t => {
  for (const value of [null, 42, [], '', '0'.repeat(63), 'A'.repeat(64), '0'.repeat(64)]) {
    const directory = await copyDistribution(t);
    await editManifest(directory, manifest => { manifest.files.LICENSE = value; });
    await assert.rejects(verifyDist(directory), /SHA-256 mismatch: LICENSE/);
  }
});

test('release files cannot be symlinks to files outside the distribution', { skip: process.platform === 'win32' }, async t => {
  const directory = await copyDistribution(t);
  await rm(path.join(directory, 'LICENSE'));
  await symlink(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
  await assert.rejects(verifyDist(directory), /Symbolic link/);
});

test('a symlink distribution root is rejected', { skip: process.platform === 'win32' }, async () => {
  const link = path.join(workspace, 'linked-dist');
  await symlink(distribution, link, 'dir');
  await assert.rejects(verifyDist(link), /root must be a real directory/);
});

test('manifest byte differences fail reproducibility even if parsed hashes match', async t => {
  const reference = await copyDistribution(t);
  const manifest = JSON.parse(await readFile(path.join(reference, 'manifest.json'), 'utf8'));
  await writeFile(path.join(reference, 'manifest.json'), JSON.stringify(manifest));
  await verifyDist(reference);
  await assert.rejects(verifyDist(distribution, reference), /Rebuild differs byte-for-byte: manifest\.json/);
});

test('reference build is verified rather than trusted by the comparison', async t => {
  const reference = await copyDistribution(t);
  await writeFile(path.join(reference, 'LICENSE'), 'changed');
  await assert.rejects(verifyDist(distribution, reference), /SHA-256 mismatch: LICENSE/);
});

test('release verifier CLI distinguishes success, failed verification, and invalid invocation', async t => {
  const run = (...args) => spawnSync(process.execPath, ['scripts/verify-dist.js', ...args], {
    cwd: root, encoding: 'utf8', timeout: 15000,
  });
  const pass = run(distribution, distribution);
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /Rebuild matches all file bytes/);
  const directory = await copyDistribution(t);
  await rm(path.join(directory, 'LICENSE'));
  const fail = run(directory);
  assert.equal(fail.status, 1);
  assert.equal(fail.stdout, '');
  assert.match(fail.stderr, /release verification failed/);
  for (const args of [['--unknown'], ['one', 'two', 'three']]) {
    const invalid = run(...args);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /Usage:/);
  }
});

test('the release toolchain is explicit and the committed lockfile remains dependency-free', async () => {
  const version = (await readFile(path.join(root, '.node-version'), 'utf8')).trim();
  assert.match(version, /^24\.\d+\.\d+$/);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(Object.keys(lock.packages), ['']);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.equal(Object.keys(pkg[field] ?? {}).length, 0, field);
  }
});
