import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProtocolTransport, launchChromium } from '../tools/browser-check/chromium.js';

function fixture(t, options) {
  const input = new PassThrough(), output = new PassThrough(), sent = [];
  output.on('data', data => sent.push(JSON.parse(data.toString().slice(0, -1))));
  const protocol = createProtocolTransport(output, input, options);
  t.after(() => { protocol.close(); input.destroy(); output.destroy(); });
  return { protocol, input, output, sent, reply: message => input.write(`${JSON.stringify(message)}\0`) };
}

test('pipe commands carry unique IDs and optional flattened target sessions', async t => {
  const { protocol, sent, reply } = fixture(t);
  const a = protocol.send('Browser.getVersion'), b = protocol.send('Runtime.enable', {}, 'page-1');
  assert.deepEqual(sent, [{ id: 1, method: 'Browser.getVersion', params: {} }, { id: 2, method: 'Runtime.enable', params: {}, sessionId: 'page-1' }]);
  reply({ id: 2, result: { second: true }, sessionId: 'page-1' });
  reply({ id: 1, result: { first: true } });
  assert.deepEqual(await a, { first: true }); assert.deepEqual(await b, { second: true });
});

test('split UTF-8 frames and coalesced events retain full data and session identity', async t => {
  const { protocol, input } = fixture(t, { maxFrameBytes: 100 });
  const events = [], dispose = protocol.on('Test.event', (params, session) => events.push([params, session]));
  const frame = Buffer.from(`${JSON.stringify({ method: 'Test.event', params: { label: 'جسر' }, sessionId: 's' })}\0`);
  const offset = frame.indexOf(Buffer.from('ج')) + 1;
  input.write(frame.subarray(0, offset)); input.write(Buffer.concat([frame.subarray(offset), frame, frame]));
  assert.deepEqual(events, Array(3).fill([{ label: 'جسر' }, 's']));
  dispose(); input.write(frame); assert.equal(events.length, 3);
});

test('protocol errors reject only their matching request', async t => {
  const { protocol, reply } = fixture(t);
  const bad = protocol.send('Test.bad'), good = protocol.send('Test.good');
  reply({ id: 1, error: { code: -1, message: 'synthetic failure' } });
  reply({ id: 2, result: {} });
  await assert.rejects(bad, /Test.bad failed: synthetic failure/); assert.deepEqual(await good, {});
});

test('session mismatch fails every pending command and future commands', async t => {
  const { protocol, reply } = fixture(t);
  const first = protocol.send('Test.one', {}, 'a'), second = protocol.send('Test.two');
  reply({ id: 1, result: {}, sessionId: 'b' });
  await assert.rejects(first, /session mismatch/); await assert.rejects(second, /session mismatch/);
  await assert.rejects(protocol.send('Test.three'), /session mismatch/);
});

for (const [name, frame, message] of [
  ['invalid JSON', '{bad}\0', /Invalid browser protocol JSON/],
  ['non-object', 'null\0', /Invalid browser protocol message/],
  ['array', '[]\0', /Invalid browser protocol message/],
  ['missing method', '{}\0', /Invalid browser protocol message/],
  ['missing response result', '{"id":1}\0', /Invalid browser protocol response/],
  ['conflicting response', '{"id":1,"result":{},"error":{}}\0', /Invalid browser protocol response/],
  ['non-numeric response ID', '{"id":"1","result":{}}\0', /Invalid browser protocol response/],
  ['empty frame', '\0', /Empty browser protocol frame/],
]) {
  test(`${name} stops the transport instead of accepting partial evidence`, async t => {
    const { protocol, input } = fixture(t), pending = protocol.send('Test.wait');
    input.write(frame); await assert.rejects(pending, message);
  });
}

test('unterminated and complete oversized frames fail before unbounded buffering', async t => {
  for (const suffix of ['', '\0']) {
    const { protocol, input } = fixture(t, { maxFrameBytes: 60 });
    const pending = protocol.send('Test.wait');
    input.write('x'.repeat(35)); input.write('x'.repeat(26) + suffix);
    await assert.rejects(pending, /frame exceeds/);
  }
});

test('oversized outgoing messages and unserializable params never write', async t => {
  const { protocol, sent } = fixture(t, { maxFrameBytes: 60 });
  await assert.rejects(protocol.send('Test.big', { value: 'x'.repeat(60) }), /command exceeds/);
  await assert.rejects(protocol.send('Test.bigint', { value: 1n }), /BigInt/);
  assert.equal(sent.length, 0);
});

test('command timeout closes all pending work and rejects later actions', async t => {
  const { protocol } = fixture(t, { timeoutMs: 5 });
  const first = protocol.send('Test.never'), second = protocol.send('Test.also');
  await assert.rejects(first, /Test.never timed out/); await assert.rejects(second, /Test.never timed out/);
  await assert.rejects(protocol.send('Test.later'), /timed out/);
});

test('EOF with incomplete frame reports truncation and ordinary EOF closes pending work', async t => {
  for (const partial of ['', '{']) {
    const { protocol, input } = fixture(t), pending = protocol.send('Test.wait');
    input.end(partial);
    await assert.rejects(pending, partial ? /Truncated/ : /ended/);
  }
});

test('read/write errors and explicit close reject pending commands', async t => {
  for (const target of ['input', 'output', 'close']) {
    const item = fixture(t), pending = item.protocol.send('Test.wait');
    if (target === 'close') item.protocol.close(new Error('synthetic close'));
    else item[target].emit('error', new Error(`synthetic ${target}`));
    await assert.rejects(pending, /synthetic/);
  }
});

test('write callback failure rejects without a dangling command timeout', async t => {
  const input = new PassThrough(), output = new Writable({ write(chunk, encoding, callback) { callback(new Error('synthetic write failure')); } });
  const protocol = createProtocolTransport(output, input);
  t.after(() => { protocol.close(); input.destroy(); output.destroy(); });
  await assert.rejects(protocol.send('Test.write'), /synthetic write failure/);
});

test('event handler errors are not silently swallowed', async t => {
  const { protocol, reply } = fixture(t), pending = protocol.send('Test.wait');
  protocol.on('Test.event', () => { throw new Error('synthetic handler failure'); });
  reply({ method: 'Test.event' }); await assert.rejects(pending, /synthetic handler failure/);
});

test('asynchronous event handler failures also stop pending evidence collection', async t => {
  const { protocol, reply } = fixture(t), pending = protocol.send('Test.wait');
  protocol.on('Test.event', async () => { throw new Error('async synthetic failure'); });
  reply({ method: 'Test.event' }); await assert.rejects(pending, /async synthetic failure/);
});

test('pending command count is bounded without losing existing requests', async t => {
  const { protocol } = fixture(t);
  const pending = Array.from({ length: 100 }, () => protocol.send('Test.wait').catch(error => error.message));
  await assert.rejects(protocol.send('Test.too-many'), /Too many pending/);
  protocol.close();
  assert.deepEqual(await Promise.all(pending), Array(100).fill('Browser protocol closed.'));
});

test('transport validates limits and command arguments', async t => {
  const { protocol } = fixture(t);
  for (const method of ['', null, 7]) await assert.rejects(protocol.send(method), /Invalid browser command/);
  await assert.rejects(protocol.send('Test.ok', {}, 7), /Invalid browser command/);
  for (const options of [{ timeoutMs: 0 }, { maxFrameBytes: 0 }, { timeoutMs: 1.5 }]) {
    assert.throws(() => createProtocolTransport(new PassThrough(), new PassThrough(), options), /limits/);
  }
});

test('browser launcher rejects implicit executables and existing or linked profiles without spawning', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'detourlab-driver-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const used = path.join(directory, 'used'), empty = path.join(directory, 'empty'), link = path.join(directory, 'link');
  await mkdir(used); await mkdir(empty); await writeFile(path.join(used, 'saved-data'), 'synthetic'); await symlink(empty, link, 'dir');
  for (const executable of ['', 'chromium', '--no-sandbox']) await assert.rejects(launchChromium(executable, empty), /explicit absolute path/);
  await assert.rejects(launchChromium('/not-run-browser', 'relative'), /absolute fresh directory/);
  for (const profile of [used, link, path.join(used, 'saved-data')]) await assert.rejects(launchChromium('/not-run-browser', profile), /empty real directory/);
});

test('missing executable is an actual spawn error, not a skipped browser pass', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'detourlab-driver-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(launchChromium(path.join(directory, 'does-not-exist'), directory), /ENOENT/);
});

async function fakeExecutable(t, source) {
  const directory = await mkdtemp(path.join(tmpdir(), 'detourlab-fake-browser-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const profile = path.join(directory, 'profile'), executable = path.join(directory, 'fake-browser.cjs');
  await mkdir(profile);
  await writeFile(executable, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return { executable, profile };
}

test('launcher drives actual anonymous pipes in an isolated fake child and closes idempotently', async t => {
  const { executable, profile } = await fakeExecutable(t, `
    const fs = require('node:fs');
    const profile = process.argv.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    fs.writeFileSync(profile + '/arguments.json', JSON.stringify(process.argv.slice(2)));
    const input = fs.createReadStream(null, { fd: 3 });
    input.on('data', bytes => {
      const command = JSON.parse(bytes.toString().slice(0, -1));
      fs.writeSync(4, JSON.stringify({ id: command.id, result: { product: 'Synthetic/1' } }) + '\\0');
    });
  `);
  const browser = await launchChromium(executable, profile);
  t.after(() => browser.close());
  assert.deepEqual(browser.version, { product: 'Synthetic/1' });
  const args = JSON.parse(await readFile(path.join(profile, 'arguments.json'), 'utf8'));
  assert.equal(args.filter(arg => arg.startsWith('--user-data-dir=')).length, 1);
  assert.ok(args.includes(`--user-data-dir=${profile}`)); assert.ok(args.includes('--remote-debugging-pipe'));
  assert.ok(args.includes('--headless')); assert.equal(args.at(-1), 'about:blank');
  assert.ok(!args.includes('--no-sandbox')); assert.ok(!args.some(arg => arg.startsWith('--remote-debugging-port')));
  await browser.close(); await browser.close();
  await assert.rejects(browser.send('Test.after-close'), /closed|exited|ended/);
});

test('early process exit is a bounded startup failure with bounded diagnostic output', async t => {
  const { executable, profile } = await fakeExecutable(t, `
    process.stderr.write('x'.repeat(12000));
    process.stderr.write(' synthetic crash');
    process.exitCode = 7;
  `);
  await assert.rejects(launchChromium(executable, profile), error => {
    assert.match(error.message, /exited|ended|closed/);
    assert.match(error.message, /synthetic crash/);
    assert.ok(error.message.length < 8500);
    return true;
  });
});

test('closing terminates an uncooperative owned child rather than leaving a process running', async t => {
  const { executable, profile } = await fakeExecutable(t, `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    fs.createReadStream(null, { fd: 3 }).on('data', bytes => {
      const command = JSON.parse(bytes.toString().slice(0, -1));
      fs.writeSync(4, JSON.stringify({ id: command.id, result: { product: 'Synthetic/1' } }) + '\\0');
    });
  `);
  const browser = await launchChromium(executable, profile);
  t.after(() => browser.close());
  await browser.close();
  await assert.rejects(browser.send('Test.after-kill'), /closed|exited|ended/);
});

test('launcher source keeps isolation and sandbox flags explicit', async () => {
  const source = await readFile(new URL('../tools/browser-check/chromium.js', import.meta.url), 'utf8');
  assert.match(source, /--remote-debugging-pipe/); assert.match(source, /--user-data-dir=/);
  assert.match(source, /--disable-background-networking/);
  assert.doesNotMatch(source, /--no-sandbox|--disable-web-security|--remote-debugging-port/);
  assert.doesNotMatch(source, /shell:\s*true/);
});
