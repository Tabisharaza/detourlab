import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

/** Read a bounded regular file without following the final path component. */
export async function readBoundedRegularFile(filename, limit, name, limitMessage = `${name} exceeds its ${limit}-byte limit.`) {
  const entry = await lstat(filename);
  if (entry.isSymbolicLink()) throw new Error(`${name} must not be a symbolic link.`);
  if (!entry.isFile()) throw new Error(`${name} must be a regular file.`);
  // O_NOFOLLOW guards the final component where supported, not ancestor races.
  const handle = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`${name} must be a regular file.`);
    if (info.size > limit) throw new Error(limitMessage);
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error(limitMessage);
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}
