/** Format a schema-bounded name for human CLI output, never for JSON or hashes. */
export function formatCliLabel(label) {
  // Keep labels on one report line and make terminal/bidi controls visible.
  // Double literal backslashes so they cannot masquerade as generated escapes.
  // Unlike diagnostics, valid names need no truncation after escape expansion.
  return label.replace(/[\\\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u206f]/gu, character =>
    character === '\\' ? '\\\\' : `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`);
}
