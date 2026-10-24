import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { RELEASE_FILES, verifyDist } from '../scripts/verify-dist.js';
const root = fileURLToPath(new URL('../', import.meta.url));

async function sourceCopy(t) {
  const copy = await mkdtemp(path.join(tmpdir(), 'detourlab-build-test-'));
  t.after(() => rm(copy, { recursive: true, force: true }));
  await mkdir(path.join(copy, 'scripts'));
  for (const item of ['index.html', 'src', 'public', 'examples', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'scripts/build.js']) {
    await cp(path.join(root, item), path.join(copy, item), { recursive: true });
  }
  return copy;
}

// Exercise the actual build with Win32 relative-path return values while all
// filesystem operations stay native. This is not a native Windows test.
const win32RelativeBuild = String.raw`
  import path from 'node:path';
  import assert from 'node:assert/strict';
  const relative = path.win32.relative;
  const resolve = path.win32.resolve;
  path.relative = (from, to) => relative(resolve('C:\\', from), resolve('C:\\', to));
  assert.equal(path.relative('/dist', '/dist/src/app.js'), 'src\\app.js');
  await import('./scripts/build.js');
`;

function build(copy, win32Relative = false) {
  const args = win32Relative ? ['--input-type=module', '--eval', win32RelativeBuild] : ['scripts/build.js'];
  const result = spawnSync(process.execPath, args, { cwd: copy, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result;
}

test('static build retains license notices and has a repeatable verified manifest', async t => {
  const copy = await sourceCopy(t);
  build(copy);
  const distribution = path.join(copy, 'dist');
  const first = await readFile(path.join(distribution, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(first);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    assert.equal(await readFile(path.join(distribution, file), 'utf8'), await readFile(path.join(root, file), 'utf8'));
    assert.ok(manifest.files[file], `${file} must be listed in the distribution manifest`);
  }
  for (const [file, hash] of Object.entries(manifest.files)) {
    assert.equal(createHash('sha256').update(await readFile(path.join(distribution, file))).digest('hex'), hash);
  }
  assert.deepEqual(await verifyDist(distribution), { files: RELEASE_FILES.length, compared: false });
  build(copy);
  assert.equal(await readFile(path.join(distribution, 'manifest.json'), 'utf8'), first);
});

test('Win32 relative-path behavior produces the same slash-keyed verified build', async t => {
  const copy = await sourceCopy(t);
  const distribution = path.join(copy, 'dist'), reference = path.join(copy, 'reference');
  build(copy);
  await cp(distribution, reference, { recursive: true });
  build(copy, true);
  const manifest = JSON.parse(await readFile(path.join(distribution, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.files).sort(), [...RELEASE_FILES].sort());
  assert.deepEqual(await verifyDist(distribution, reference), { files: RELEASE_FILES.length, compared: true });
});

test('manifest names preserve nested, spaced and Unicode directory-entry names', async t => {
  const copy = await sourceCopy(t);
  const fixtures = new Map([
    ['public/nested space/deeper/Café #1.txt', 'nested public bytes'],
    ['examples/sub folder/日本語.json', '{"synthetic":true}\n'],
  ]);
  for (const [file, bytes] of fixtures) {
    await mkdir(path.dirname(path.join(copy, file)), { recursive: true });
    await writeFile(path.join(copy, file), bytes);
  }
  let first;
  for (const win32Relative of [false, true]) {
    build(copy, win32Relative);
    const serialized = await readFile(path.join(copy, 'dist', 'manifest.json'), 'utf8');
    const manifest = JSON.parse(serialized);
    for (const [file, bytes] of fixtures) {
      assert.equal(manifest.files[file], createHash('sha256').update(bytes).digest('hex'));
      assert.equal(await readFile(path.join(copy, 'dist', file), 'utf8'), bytes);
    }
    if (first !== undefined) assert.equal(serialized, first);
    first = serialized;
  }
});

test('literal POSIX backslashes are not rewritten into directory separators', { skip: process.platform === 'win32' }, async t => {
  const copy = await sourceCopy(t);
  const fixtures = new Map([
    ['public/route\\demo.txt', 'literal backslash filename'],
    ['public/route/demo.txt', 'nested path filename'],
  ]);
  for (const [file, bytes] of fixtures) {
    await mkdir(path.dirname(path.join(copy, file)), { recursive: true });
    await writeFile(path.join(copy, file), bytes);
  }
  build(copy);
  const manifest = JSON.parse(await readFile(path.join(copy, 'dist', 'manifest.json'), 'utf8'));
  for (const [file, bytes] of fixtures) {
    assert.equal(manifest.files[file], createHash('sha256').update(bytes).digest('hex'));
  }
  // These fixtures test naming only; they are not authorized release assets.
  await assert.rejects(verifyDist(path.join(copy, 'dist')), /Unexpected release (file|directory)/);
});
