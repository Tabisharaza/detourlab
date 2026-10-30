import { validateExperiment } from '../../src/experiment.js';
import { FILE_INPUT_MAX_BYTES } from '../../src/file-input.js';

// Original synthetic cases derived from the hand-checkable four-node example.
export function browserFixtures(tiny) {
  const two = structuredClone(tiny);
  two.id = 'browser-two'; two.name = 'Browser two-variant roundtrip';
  two.variants = two.variants.slice(0, 2);
  const six = structuredClone(tiny);
  six.id = 'browser-six'; six.name = 'Browser six-variant roundtrip';
  six.baseScenario.jobs.push({ id: 'job-2', nodeId: 'B', vehicleId: 'van-1', dueTimeS: 40, serviceTimeS: 0 });
  six.variants.push(
    { id: 'disconnect', name: 'Disconnected at dispatch', closures: [{ id: 'block', edgeIds: ['ab'], atS: 0 }] },
    { id: 'fractional', name: 'After fractional edge entry', closures: [{ id: 'fractional', edgeIds: ['bc'], atS: 10.5 }] },
    { id: 'equal-time', name: 'Two edges close together', closures: [{ id: 'two', edgeIds: ['bc', 'bd'], atS: 10 }] },
  );
  const hostile = structuredClone(two);
  hostile.id = 'browser-labels'; hostile.name = '<img src=x onerror=alert(1)> literal \uFFFD';
  hostile.variants[0].name = '<svg onload=alert(1)>';
  hostile.baseScenario.edges[0].roadName = '<script>alert(1)</script>';
  return [two, six, hostile].map(validateExperiment);
}

export function invalidBrowserFiles(validText) {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const text = Buffer.from(validText);
  return [
    { name: 'malformed.json', bytes: Buffer.from('{"format":'), error: /Import rejected/u },
    { name: 'invalid-utf8.json', bytes: Buffer.from([0xc3, 0x28]), error: /not valid UTF-8/u },
    { name: 'oversized.json', bytes: Buffer.alloc(FILE_INPUT_MAX_BYTES + 1, 0x20), error: /at most 2 MiB/u },
    { name: 'bom-over-limit.json', bytes: Buffer.concat([bom, text, Buffer.alloc(FILE_INPUT_MAX_BYTES - text.length - 2, 0x20)]), error: /at most 2 MiB/u },
  ];
}
