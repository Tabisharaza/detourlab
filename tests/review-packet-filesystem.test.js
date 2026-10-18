import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeReviewPacket } from '../scripts/write-review-packet.js';
import { REPORT_LIMITS } from '../scripts/experiment-report.js';

const serialized = () => ({ bundleJson: '{"ok":true}\n', reviewMarkdown: '# Review\n' });
const missing = async filename => assert.rejects(fs.lstat(filename), { code: 'ENOENT' });
function failure(message = 'Injected filesystem failure', code = 'EIO') {
  return Object.assign(new Error(message), { code });
}
async function temporary(t) {
  const parent = await fs.mkdtemp(path.join(tmpdir(), 'detourlab-packet-fs-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return { parent, target: path.join(parent, 'review') };
}
async function symlinkOrSkip(t, target, link, type = 'dir') {
  try { await fs.symlink(target, link, type); return true; }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Symlink creation unavailable'); return false; }
    throw error;
  }
}

test('writer stages complete files, publishes review before bundle, and removes staging', async t => {
  const { parent, target } = await temporary(t), input = serialized(), published = [];
  const adapter = { ...fs, async link(source, destination) {
    const name = path.basename(destination);
    assert.equal(await fs.readFile(source, 'utf8'), name === 'bundle.json' ? input.bundleJson : input.reviewMarkdown);
    assert.equal(path.dirname(source), path.dirname(published[0]?.source ?? source));
    if (name === 'bundle.json') assert.equal(await fs.readFile(path.join(target, 'REVIEW.md'), 'utf8'), input.reviewMarkdown);
    published.push({ name, source });
    await fs.link(source, destination);
  } };
  assert.deepEqual(await writeReviewPacket(target, input, adapter), { directory: target, files: ['bundle.json', 'REVIEW.md'] });
  assert.deepEqual(published.map(file => file.name), ['REVIEW.md', 'bundle.json']);
  assert.deepEqual(await fs.readdir(parent), ['review']);
  assert.deepEqual((await fs.readdir(target)).sort(), ['REVIEW.md', 'bundle.json']);
  assert.equal(await fs.readFile(path.join(target, 'bundle.json'), 'utf8'), input.bundleJson);
  assert.equal(await fs.readFile(path.join(target, 'REVIEW.md'), 'utf8'), input.reviewMarkdown);
});

for (const kind of ['file', 'empty directory', 'nonempty directory', 'symlink', 'dangling symlink']) {
  test(`writer refuses existing ${kind} without modifying it`, async t => {
    const { parent, target } = await temporary(t);
    if (kind === 'file') await fs.writeFile(target, 'keep');
    else if (kind.includes('symlink')) {
      const other = path.join(parent, 'other');
      if (kind === 'symlink') { await fs.mkdir(other); await fs.writeFile(path.join(other, 'keep'), 'keep'); }
      if (!await symlinkOrSkip(t, other, target)) return;
    } else {
      await fs.mkdir(target);
      if (kind === 'nonempty directory') await fs.writeFile(path.join(target, 'keep'), 'keep');
    }
    const original = await fs.lstat(target, { bigint: true });
    await assert.rejects(writeReviewPacket(target + (kind.includes('symlink') ? path.sep : ''), serialized()), /already exists/);
    const after = await fs.lstat(target, { bigint: true });
    assert.equal(after.ino, original.ino);
    assert.equal(after.dev, original.dev);
    if (kind === 'file') assert.equal(await fs.readFile(target, 'utf8'), 'keep');
    assert.equal((await fs.readdir(parent)).some(name => name.startsWith('.detourlab-review-')), false);
  });
}

test('writer does not create missing parents or treat a file as a parent', async t => {
  const { parent } = await temporary(t);
  await assert.rejects(writeReviewPacket(path.join(parent, 'missing', 'review'), serialized()), { code: 'ENOENT' });
  await missing(path.join(parent, 'missing'));
  const filename = path.join(parent, 'file');
  await fs.writeFile(filename, 'keep');
  await assert.rejects(writeReviewPacket(path.join(filename, 'review'), serialized()), /existing directory|ENOTDIR/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'keep');
});

test('writer can use an existing symlinked parent while refusing a symlink destination', async t => {
  const { parent } = await temporary(t), actual = path.join(parent, 'actual'), alias = path.join(parent, 'alias');
  await fs.mkdir(actual);
  if (!await symlinkOrSkip(t, actual, alias)) return;
  const result = await writeReviewPacket(path.join(alias, 'review'), serialized());
  assert.equal(result.directory, path.join(actual, 'review'));
  assert.equal(await fs.readFile(path.join(actual, 'review', 'bundle.json'), 'utf8'), serialized().bundleJson);
});

test('writer accepts exact UTF-8 byte limits including each final newline', async t => {
  const { target } = await temporary(t);
  const bytesAt = count => `${'é'.repeat((count - 2) / 2)}x\n`;
  const input = { bundleJson: bytesAt(REPORT_LIMITS.maxBundleBytes), reviewMarkdown: bytesAt(REPORT_LIMITS.maxReviewBytes) };
  await writeReviewPacket(target, input);
  assert.equal((await fs.stat(path.join(target, 'bundle.json'))).size, REPORT_LIMITS.maxBundleBytes);
  assert.equal((await fs.stat(path.join(target, 'REVIEW.md'))).size, REPORT_LIMITS.maxReviewBytes);
});

for (const [key, limit, label] of [
  ['bundleJson', REPORT_LIMITS.maxBundleBytes, 'bundle.json'],
  ['reviewMarkdown', REPORT_LIMITS.maxReviewBytes, 'REVIEW.md'],
]) {
  test(`writer rejects ${label} one byte over its limit before filesystem access`, async () => {
    let accesses = 0;
    const input = { ...serialized(), [key]: 'x'.repeat(limit) + '\n' };
    await assert.rejects(writeReviewPacket('unused', input, { async realpath() { accesses += 1; throw failure(); } }), /output limit/);
    assert.equal(accesses, 0);
  });
}

test('writer rejects invalid serialized text and invalid paths without output', async t => {
  const { parent, target } = await temporary(t);
  for (const input of [null, {}, { ...serialized(), bundleJson: '{}' }, { ...serialized(), reviewMarkdown: Buffer.from('x\n') }]) {
    await assert.rejects(writeReviewPacket(target, input), /serialized text/);
  }
  for (const output of ['', ' ', null, 'nul\0path']) await assert.rejects(writeReviewPacket(output, serialized()), /directory must/);
  assert.deepEqual(await fs.readdir(parent), []);
});

for (const operation of ['mkdtemp', 'open', 'mkdir', 'first link', 'second link', 'unsupported hard links']) {
  test(`writer rolls back an injected ${operation} failure without leftovers`, async t => {
    const { parent, target } = await temporary(t);
    let linkCount = 0;
    const adapter = { ...fs };
    if (['mkdtemp', 'open', 'mkdir'].includes(operation)) adapter[operation] = async () => { throw failure(); };
    else adapter.link = async (...args) => {
      linkCount += 1;
      if (operation !== 'second link' || linkCount === 2) throw failure('Injected filesystem failure', operation === 'unsupported hard links' ? 'ENOTSUP' : 'EIO');
      return fs.link(...args);
    };
    await assert.rejects(writeReviewPacket(target, serialized(), adapter), /Injected filesystem failure/);
    assert.deepEqual(await fs.readdir(parent), []);
  });
}

for (const operation of ['writeFile', 'sync', 'close']) {
  test(`writer cleans owned staging after an injected file ${operation} failure`, async t => {
    const { parent, target } = await temporary(t);
    let injected = false;
    const adapter = { ...fs, async open(...args) {
      const handle = await fs.open(...args);
      return {
        stat: (...a) => handle.stat(...a),
        writeFile: (...a) => handle.writeFile(...a),
        sync: (...a) => handle.sync(...a),
        close: (...a) => handle.close(...a),
        [operation]: async (...a) => {
          if (!injected) { injected = true; if (operation === 'close') await handle.close(); throw failure(); }
          return handle[operation](...a);
        },
      };
    } };
    await assert.rejects(writeReviewPacket(target, serialized(), adapter), /Injected filesystem failure/);
    assert.deepEqual(await fs.readdir(parent), []);
  });
}

test('a destination created during staging is never removed or overwritten', async t => {
  const { parent, target } = await temporary(t);
  const adapter = { ...fs, async mkdir(...args) {
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'keep'), 'unrelated');
    return fs.mkdir(...args);
  } };
  await assert.rejects(writeReviewPacket(target, serialized(), adapter), /already exists/);
  assert.deepEqual(await fs.readdir(parent), ['review']);
  assert.deepEqual(await fs.readdir(target), ['keep']);
  assert.equal(await fs.readFile(path.join(target, 'keep'), 'utf8'), 'unrelated');
});

test('a colliding final filename is never overwritten or cleaned as owned data', async t => {
  const { parent, target } = await temporary(t);
  const adapter = { ...fs, async link(source, destination) {
    if (path.basename(destination) === 'bundle.json') await fs.writeFile(destination, 'keep');
    return fs.link(source, destination);
  } };
  await assert.rejects(writeReviewPacket(target, serialized(), adapter), /cleanup was incomplete/);
  assert.deepEqual(await fs.readdir(parent), ['review']);
  assert.deepEqual(await fs.readdir(target), ['bundle.json']);
  assert.equal(await fs.readFile(path.join(target, 'bundle.json'), 'utf8'), 'keep');
});

test('replacement target directory is retained rather than recursively removed', async t => {
  const { parent, target } = await temporary(t), moved = path.join(parent, 'moved-owned-directory');
  let calls = 0;
  const adapter = { ...fs, async link(source, destination) {
    calls += 1;
    if (calls === 2) {
      await fs.rename(target, moved);
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'keep'), 'unrelated');
      throw failure();
    }
    return fs.link(source, destination);
  } };
  await assert.rejects(writeReviewPacket(target, serialized(), adapter), /cleanup was incomplete/);
  assert.equal(await fs.readFile(path.join(target, 'keep'), 'utf8'), 'unrelated');
  assert.deepEqual(await fs.readdir(target), ['keep']);
  assert.deepEqual(await fs.readdir(moved), ['REVIEW.md']);
  assert.equal((await fs.readdir(parent)).some(name => name.startsWith('.detourlab-review-')), false);
});

test('cleanup failures are disclosed and never reported as a complete packet', async t => {
  const { parent, target } = await temporary(t);
  const adapter = { ...fs, async unlink(filename) {
    if (path.dirname(filename) !== target) throw failure('Cannot remove staging file');
    return fs.unlink(filename);
  } };
  await assert.rejects(writeReviewPacket(target, serialized(), adapter), /cleanup was incomplete/);
  await missing(target);
  assert.equal((await fs.readdir(parent)).filter(name => name.startsWith('.detourlab-review-')).length, 1);
});

test('unidentified temporary directory is not deleted and cleanup is disclosed', async t => {
  const { parent, target } = await temporary(t);
  const adapter = { ...fs, async lstat(filename, ...args) {
    if (path.basename(filename).startsWith('.detourlab-review-')) throw failure('Cannot identify staging');
    return fs.lstat(filename, ...args);
  } };
  await assert.rejects(writeReviewPacket(target, serialized(), adapter), /cleanup was incomplete/);
  await missing(target);
  assert.equal((await fs.readdir(parent)).filter(name => name.startsWith('.detourlab-review-')).length, 1);
});

test('final verification rejects a replaced review file and retains the foreign entry', async t => {
  const { parent, target } = await temporary(t);
  const adapter = { ...fs, async link(source, destination) {
    await fs.link(source, destination);
    if (path.basename(destination) === 'bundle.json') {
      await fs.unlink(path.join(target, 'REVIEW.md'));
      await fs.writeFile(path.join(target, 'REVIEW.md'), 'keep');
    }
  } };
  await assert.rejects(writeReviewPacket(target, serialized(), adapter), /cleanup was incomplete/);
  assert.deepEqual(await fs.readdir(parent), ['review']);
  assert.deepEqual(await fs.readdir(target), ['REVIEW.md']);
  assert.equal(await fs.readFile(path.join(target, 'REVIEW.md'), 'utf8'), 'keep');
});

test('invalid staging paths are never used for cleanup', async t => {
  const { parent, target } = await temporary(t), foreign = path.join(parent, 'foreign');
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, 'bundle.json'), 'keep');
  const adapter = { ...fs, async mkdtemp() { return foreign; } };
  await assert.rejects(writeReviewPacket(target, serialized(), adapter), /validate the temporary/);
  assert.equal(await fs.readFile(path.join(foreign, 'bundle.json'), 'utf8'), 'keep');
  await missing(target);
});
