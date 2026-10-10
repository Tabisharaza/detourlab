import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { decodeFileInput, FILE_INPUT_MAX_BYTES } from '../src/file-input.js';

/** Read only a bounded regular file, without waiting for a named-pipe writer. */
export async function readInput(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Input must be a regular file.');
    if (info.size > FILE_INPUT_MAX_BYTES) throw new Error('File must be at most 2 MiB.');
    // Bound the actual read too, in case the file grows after stat(). One extra
    // byte detects an oversized input without reading the remainder of it.
    const buffer = Buffer.alloc(FILE_INPUT_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    return decodeFileInput(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}
