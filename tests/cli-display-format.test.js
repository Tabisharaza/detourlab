import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCliLabel } from '../scripts/cli-display.js';

const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => first + index);
const controls = [...range(0, 0x1f), ...range(0x7f, 0x9f), 0x61c, 0x200e, 0x200f, ...range(0x2028, 0x202e), ...range(0x2066, 0x206f)];
const escaped = code => `\\u${code.toString(16).padStart(4, '0')}`;

test('CLI label formatter escapes every C0/C1, DEL, separator and selected bidi control', () => {
  for (const code of controls) {
    assert.equal(formatCliLabel(`before${String.fromCodePoint(code)}after`), `before${escaped(code)}after`, escaped(code));
  }
});

test('CLI label formatter handles adjacent and repeated controls without skipping matches', () => {
  const label = String.fromCodePoint(...controls);
  assert.equal(formatCliLabel(label + label), controls.map(escaped).join('').repeat(2));
});

test('CLI label formatter preserves ordinary Unicode, astral symbols and range neighbors exactly', () => {
  const neighbors = [0x20, 0x7e, 0xa0, 0x61b, 0x61d, 0x200d, 0x2010, 0x2027, 0x202f, 0x2065, 0x2070];
  const label = `  É 東京 🚚 e\u0301 مرحبا שלום 👩‍🔬 � \ufeff ${String.fromCodePoint(...neighbors, 0x10ffff)}  `;
  assert.equal(formatCliLabel(label), label);
  assert.equal(formatCliLabel(''), '');
  assert.equal(formatCliLabel('plain "quotes", punctuation: [a] / b'), 'plain "quotes", punctuation: [a] / b');
});

test('CLI label formatter makes literal escapes distinguishable and never interprets them', () => {
  assert.equal(formatCliLabel(String.raw`\u202e\u009b\n\r\t\x1b\\`), String.raw`\\u202e\\u009b\\n\\r\\t\\x1b\\\\`);
  assert.equal(formatCliLabel('\u202e'), String.raw`\u202e`);
  assert.equal(formatCliLabel(String.raw`\u202e`), String.raw`\\u202e`);
  assert.equal(formatCliLabel('\\' + '\u202e' + '\\'), String.raw`\\\u202e\\`);
  assert.equal(formatCliLabel('\\'.repeat(120)), '\\'.repeat(240));
});

test('CLI label formatter retains the complete expansion of a maximum-length valid name', () => {
  const label = '\u202e'.repeat(120), output = formatCliLabel(label);
  assert.equal(output, String.raw`\u202e`.repeat(120));
  assert.equal(output.length, 720);
  assert.equal(label.length, 120);
});
