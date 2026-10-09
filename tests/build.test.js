import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));

test('static build retains license notices and has a repeatable verified manifest', async () => {
  const copy = await mkdtemp(path.join(tmpdir(), 'detourlab-build-test-'));
  try {
    await mkdir(path.join(copy, 'scripts'));
    for (const item of ['index.html', 'src', 'public', 'examples', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'scripts/build.js']) {
      await cp(path.join(root, item), path.join(copy, item), { recursive: true });
    }
    const build = () => {
      const result = spawnSync(process.execPath, ['scripts/build.js'], { cwd: copy, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    build();
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
    build();
    assert.equal(await readFile(path.join(distribution, 'manifest.json'), 'utf8'), first);
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
});
