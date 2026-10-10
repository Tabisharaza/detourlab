import { LIMITS } from './scenario.js';

export const FILE_INPUT_MAX_BYTES = LIMITS.maxBytes;
export const INPUT_ERROR_MAX_LENGTH = 512;

/** Decode file bytes before handing JSON text to the unchanged schema parsers. */
export function decodeFileInput(bytes) {
  if (!(bytes instanceof ArrayBuffer) && !(bytes instanceof Uint8Array)) {
    throw new TypeError('File input must be an ArrayBuffer or Uint8Array.');
  }
  // Count the original bytes, including a possible leading UTF-8 BOM, before
  // decoding. TextDecoder consumes only that initial BOM, preserving labels.
  if (bytes.byteLength > FILE_INPUT_MAX_BYTES) throw new Error('File must be at most 2 MiB.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('File is not valid UTF-8. Save it as UTF-8 JSON and try again.');
  }
}

/** Keep supplied keys and filesystem messages bounded and safe in UI/terminals. */
export function formatInputError(error) {
  const message = typeof error?.message === 'string' && error.message ? error.message : 'The input could not be processed.';
  let result = '';
  for (const character of message) {
    const safe = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/u.test(character)
      ? `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}` : character;
    if (result.length + safe.length > INPUT_ERROR_MAX_LENGTH - 1) return result + '…';
    result += safe;
  }
  return result;
}
