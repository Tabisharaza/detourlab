import { spawn } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

const FRAME_LIMIT = 16 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15000;

/** Small CDP pipe transport, also exercised with in-memory streams in core tests. */
export function createProtocolTransport(writable, readable, { maxFrameBytes = FRAME_LIMIT, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 1 || !Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid browser protocol limits.');
  let nextId = 0, buffered = Buffer.alloc(0), failure;
  const pending = new Map(), listeners = new Map();
  function fail(error = new Error('Browser protocol closed.')) {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    buffered = Buffer.alloc(0);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(failure); }
    pending.clear(); listeners.clear();
  }
  function dispatch(bytes) {
    let message;
    try { message = JSON.parse(bytes.toString('utf8')); }
    catch { throw new Error('Invalid browser protocol JSON.'); }
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid browser protocol message.');
    if (Object.hasOwn(message, 'id')) {
      if (!Number.isInteger(message.id) || message.id < 1 || Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) throw new Error('Invalid browser protocol response.');
      const request = pending.get(message.id);
      if (!request) return; // A command may have timed out before its reply arrives.
      if (message.sessionId !== request.sessionId) throw new Error('Browser protocol response session mismatch.');
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(`Browser command ${request.method} failed: ${String(message.error.message || 'protocol error').slice(0, 300)}`));
      else request.resolve(message.result);
    } else if (typeof message.method === 'string') {
      for (const listener of listeners.get(message.method) || []) {
        // Surface listener failures rather than silently losing a browser event.
        Promise.resolve(listener(message.params ?? {}, message.sessionId)).catch(fail);
      }
    } else throw new Error('Invalid browser protocol message.');
  }
  readable.on('data', chunk => {
    if (failure) return;
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      // Consume a chunk frame-by-frame so coalesced small frames need not fit
      // inside the single-frame limit, and an unterminated frame stays bounded.
      let start = 0;
      for (;;) {
        const end = bytes.indexOf(0, start), piece = bytes.subarray(start, end < 0 ? bytes.length : end);
        if (buffered.length + piece.length > maxFrameBytes) throw new Error('Browser protocol frame exceeds its byte limit.');
        buffered = Buffer.concat([buffered, piece]);
        if (end < 0) break;
        if (!buffered.length) throw new Error('Empty browser protocol frame.');
        const complete = buffered; buffered = Buffer.alloc(0); dispatch(complete);
        if (failure) break;
        start = end + 1;
        if (start === bytes.length) break;
      }
    } catch (error) { fail(error); }
  });
  readable.on('end', () => fail(new Error(buffered.length ? 'Truncated browser protocol frame.' : 'Browser protocol ended.')));
  readable.on('close', () => fail());
  readable.on('error', fail); writable.on('error', fail);
  return {
    send(method, params = {}, sessionId) {
      if (failure) return Promise.reject(failure);
      if (typeof method !== 'string' || !method || (sessionId !== undefined && typeof sessionId !== 'string')) return Promise.reject(new Error('Invalid browser command.'));
      if (pending.size >= 100) return Promise.reject(new Error('Too many pending browser commands.'));
      let bytes;
      const id = ++nextId;
      try {
        bytes = Buffer.from(`${JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) })}\0`);
        if (bytes.length - 1 > maxFrameBytes) throw new Error('Browser command exceeds its byte limit.');
      } catch (error) { return Promise.reject(error); }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          // A timed-out operation has an uncertain result. End the transport;
          // callers must not keep issuing potentially dependent actions.
          fail(new Error(`Browser command ${method} timed out.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, method, sessionId });
        try { writable.write(bytes, error => { if (error) fail(error); }); }
        catch (error) { fail(error); }
      });
    },
    on(method, listener) {
      if (failure) throw failure;
      if (typeof method !== 'string' || typeof listener !== 'function') throw new Error('Invalid browser event listener.');
      if (!listeners.has(method)) listeners.set(method, new Set());
      const handlers = listeners.get(method); handlers.add(listener);
      return () => { handlers.delete(listener); if (!handlers.size) listeners.delete(method); };
    },
    close: fail,
  };
}

/** Explicit executable and a fresh caller-owned profile; never attach to a user browser. */
export async function launchChromium(executable, profileDirectory) {
  if (typeof executable !== 'string' || !path.isAbsolute(executable) || executable.includes('\0')) throw new Error('Browser executable must be an explicit absolute path.');
  if (typeof profileDirectory !== 'string' || !path.isAbsolute(profileDirectory)) throw new Error('Browser profile must be an absolute fresh directory.');
  const info = await lstat(profileDirectory);
  if (!info.isDirectory() || info.isSymbolicLink() || (await readdir(profileDirectory)).length) throw new Error('Browser profile must be an empty real directory.');
  const child = spawn(executable, [
    '--headless', '--remote-debugging-pipe', `--user-data-dir=${profileDirectory}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-sync',
    '--metrics-recording-only', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '', ended = false, closing;
  const transport = createProtocolTransport(child.stdio[3], child.stdio[4]);
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-8192); });
  child.once('error', error => { ended = true; transport.close(error); });
  const exit = new Promise(resolve => {
    child.once('error', resolve);
    child.once('exit', (code, signal) => {
      ended = true; transport.close(new Error(`Browser exited (${signal || code}).`)); resolve();
    });
  });
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      // SIGTERM reaches only the child we created, never a user browser process.
      // Do not wait for a CDP reply that a closing browser need not send.
      if (!ended) child.kill('SIGTERM');
      const force = setTimeout(() => { if (!ended) child.kill('SIGKILL'); }, 2000);
      try { await exit; } finally {
        clearTimeout(force); transport.close();
        // An exited process cannot produce more evidence. Close inherited pipe
        // handles too, instead of waiting indefinitely for a descendant's EOF.
        child.stderr.destroy(); child.stdio[3].destroy(); child.stdio[4].destroy();
      }
    })();
    return closing;
  }
  try {
    const version = await transport.send('Browser.getVersion');
    if (!version || typeof version.product !== 'string' || !version.product) throw new Error('Browser did not identify its product version.');
    return { send: transport.send, on: transport.on, close, version };
  } catch (error) {
    await close();
    // This is a local test-launch diagnostic, not a captured private profile.
    throw new Error(`${error.message}${stderr ? `\nBrowser stderr: ${stderr}` : ''}`);
  }
}
