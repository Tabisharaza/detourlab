/**
 * Optional, offline tests of the JSON language-service API used by editors.
 * These do not launch VS Code or claim native-editor/browser coverage.
 * Run npm ci --ignore-scripts --no-audit --no-fund, then npm run verify here.
 * The explicit filename keeps optional dependencies out of root node --test.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import jsonLanguageService from 'vscode-json-languageservice';

const { DiagnosticSeverity, ErrorCode, TextDocument, getLanguageService } = jsonLanguageService;
const workspace = new URL('../../', import.meta.url);
const schemaURLs = {
  scenario: new URL('schemas/scenario-v1.schema.json', workspace).href,
  experiment: new URL('schemas/experiment-v1.schema.json', workspace).href,
};
const settings = JSON.parse(await readFile(new URL('.vscode/settings.json', workspace), 'utf8'));
const schemaSources = new Map(await Promise.all(Object.values(schemaURLs).map(async uri => [
  uri, await readFile(new URL(uri), 'utf8'),
])));
const fixtureKinds = new Map([
  ['examples/minimal-directed.json', 'scenario'],
  ['examples/meridian-default.json', 'scenario'],
  ['examples/meridian-all-bridges.json', 'scenario'],
  ['examples/minimal-experiment.json', 'experiment'],
  ['examples/meridian-experiment.json', 'experiment'],
]);
const fixtureSources = new Map(await Promise.all([...fixtureKinds.keys()].map(async path => [
  path, await readFile(new URL(path, workspace), 'utf8'),
])));

function editor() {
  const requests = [];
  const requestSchema = async uri => {
    requests.push(uri);
    if (!schemaSources.has(uri)) throw new Error(`Only known local schemas may be loaded: ${uri}`);
    return schemaSources.get(uri);
  };
  const service = getLanguageService({
    schemaRequestService: requestSchema,
    workspaceContext: {
      resolveRelativePath: (relativePath, resource) => new URL(relativePath, resource).href,
    },
  });
  // The JSON extension resolves workspace-relative setting URLs and supplies
  // folderUri for workspace settings. Reproduce that documented API boundary.
  service.configure({
    validate: true,
    allowComments: false,
    schemas: settings['json.schemas'].map(({ url, fileMatch }) => ({
      uri: new URL(url, workspace).href,
      fileMatch,
      folderUri: workspace.href,
    })),
  });
  function document(path, text) {
    const value = TextDocument.create(new URL(path, workspace).href, 'json', 1, text);
    return { document: value, parsed: service.parseJSONDocument(value) };
  }
  async function validate(path, text) {
    const { document: value, parsed } = document(path, text);
    const diagnostics = await service.doValidation(value, parsed, {
      schemaValidation: 'error', schemaRequest: 'error',
    });
    assert.equal(value.getText(), text, 'validation must not rewrite document text');
    return diagnostics;
  }
  async function complete(path, markedText) {
    const offset = markedText.indexOf('|');
    assert.notEqual(offset, -1, 'completion input needs a cursor marker');
    assert.equal(markedText.indexOf('|', offset + 1), -1, 'completion input needs exactly one marker');
    const text = markedText.replace('|', '');
    const { document: value, parsed } = document(path, text);
    const result = await service.doComplete(value, value.positionAt(offset), parsed);
    assert.equal(value.getText(), text, 'completion must not apply edits to document text');
    assert.ok(result, 'the language service should return completions');
    return result.items;
  }
  async function hover(path, text, property) {
    const offset = text.indexOf(`"${property}"`) + 1;
    assert.ok(offset > 0, `hover property ${property} must be present`);
    const { document: value, parsed } = document(path, text);
    const result = await service.doHover(value, value.positionAt(offset), parsed);
    assert.equal(value.getText(), text, 'hover must not rewrite document text');
    assert.ok(result, `${property} should have a hover`);
    const contents = Array.isArray(result.contents) ? result.contents : [result.contents];
    return contents.map(part => typeof part === 'string' ? part : part.value).join('\n');
  }
  function associated(path) {
    const { document: value, parsed } = document(path, '{}');
    return service.getLanguageStatus(value, parsed).schemas;
  }
  return { service, requests, requestSchema, validate, complete, hover, associated };
}

function assertProperties(items, expected, excluded = []) {
  const labels = items.map(item => item.label);
  for (const label of expected) assert.ok(labels.includes(label), `missing ${label}: ${labels.join(', ')}`);
  for (const label of excluded) assert.ok(!labels.includes(label), `unexpected ${label}: ${labels.join(', ')}`);
}

function assertDiagnostic(diagnostics, expected, token, text) {
  const diagnostic = diagnostics.find(item => expected.test(item.message));
  assert.ok(diagnostic, `expected ${expected}, received ${JSON.stringify(diagnostics)}`);
  assert.equal(diagnostic.severity, DiagnosticSeverity.Error);
  assert.ok(!diagnostics.some(item => item.code === ErrorCode.SchemaResolveError), 'schema resolution must succeed');
  if (token !== undefined) {
    const value = TextDocument.create('file:///diagnostic.json', 'json', 1, text);
    assert.equal(value.getText(diagnostic.range), token, 'the diagnostic should highlight the invalid field/value');
  }
}

test('workspace settings associate only local versioned schemas', () => {
  const associations = settings['json.schemas'];
  assert.equal(associations.length, 2);
  assert.deepEqual(new Set(associations.map(item => new URL(item.url, workspace).href)), new Set(Object.values(schemaURLs)));
  for (const { url, fileMatch } of associations) {
    assert.match(url, /^\.\/schemas\/(scenario|experiment)-v1\.schema\.json$/);
    assert.ok(fileMatch.length > 0);
    assert.ok(!fileMatch.includes('*.json') && !fileMatch.includes('/**/*.json'), 'do not claim every JSON file');
  }
});

test('language service selects scenario versus experiment for every fixture and custom filename', () => {
  const service = editor();
  for (const [path, kind] of fixtureKinds) assert.deepEqual(service.associated(path), [schemaURLs[kind]], path);
  for (const kind of ['scenario', 'experiment']) {
    for (const path of [`trial.${kind}.json`, `drafts/nested/trial.${kind}.json`]) {
      assert.deepEqual(service.associated(path), [schemaURLs[kind]], path);
    }
  }
  for (const path of [
    'package.json', 'package-lock.json', '.vscode/settings.json', 'examples/unrelated.json',
    'docs/evidence/render-counts.json', 'schemas/scenario-v1.schema.json',
    '../outside/trial.scenario.json', '../outside/trial.experiment.json',
  ]) assert.deepEqual(service.associated(path), [], path);
});

test('all checked-in fixtures validate with zero editor diagnostics and no inserted schema field', async t => {
  const service = editor();
  for (const [path, source] of fixtureSources) {
    await t.test(path, async () => {
      assert.ok(!Object.hasOwn(JSON.parse(source), '$schema'), 'runtime data must not gain $schema');
      assert.deepEqual(await service.validate(path, source), []);
      assert.equal(await readFile(new URL(path, workspace), 'utf8'), source, 'fixture bytes remain unchanged');
    });
  }
  assert.deepEqual(new Set(service.requests), new Set(Object.values(schemaURLs)), 'load both schemas locally');
});

test('a document associated with the wrong format is rejected rather than silently accepted', async () => {
  const service = editor();
  assertDiagnostic(
    await service.validate('wrong.scenario.json', fixtureSources.get('examples/minimal-experiment.json')),
    /Property format is not allowed/,
  );
  assertDiagnostic(
    await service.validate('wrong.experiment.json', fixtureSources.get('examples/minimal-directed.json')),
    /Missing property "baseScenario"/,
  );
});

test('scenario numeric, required and unknown-field failures produce focused editor diagnostics', async t => {
  const cases = [
    ['zero distance', value => { value.edges[0].distanceM = 0; }, /below the minimum of 0\.01/, '0'],
    ['travel time maximum', value => { value.edges[0].travelTimeS = 86401; }, /above the maximum of 86400/, '86401'],
    ['zero duration', value => { value.durationS = 0; }, /exclusive minimum of 0/, '0'],
    ['noninteger seed', value => { value.seed = 1.5; }, /Expected "integer"/, '1.5'],
    ['required root field', value => { delete value.name; }, /Missing property "name"/],
    ['required edge field', value => { delete value.edges[0].distanceM; }, /Missing property "distanceM"/],
    ['unknown root field', value => { value.unexpected = true; }, /Property unexpected is not allowed/, '"unexpected"'],
    ['unknown edge field', value => { value.edges[0].speed = 10; }, /Property speed is not allowed/, '"speed"'],
  ];
  for (const [name, mutate, expected, token] of cases) {
    await t.test(name, async () => {
      const value = JSON.parse(fixtureSources.get('examples/minimal-directed.json'));
      mutate(value);
      const text = JSON.stringify(value, null, 2);
      assertDiagnostic(await editor().validate('drafts/invalid.scenario.json', text), expected, token, text);
    });
  }
});

test('experiment diagnostics follow local refs into the shared scenario and closure variants', async t => {
  const cases = [
    ['format value', value => { value.format = 'scenario'; }, /Value must be "detourlab-experiment"/, '"scenario"'],
    ['missing variants', value => { delete value.variants; }, /Missing property "variants"/],
    ['too few variants', value => { value.variants = value.variants.slice(0, 1); }, /Expected 2 or more/],
    ['unknown variant field', value => { value.variants[0].durationS = 1; }, /Property durationS is not allowed/, '"durationS"'],
    ['missing variant name', value => { delete value.variants[0].name; }, /Missing property "name"/],
    ['negative closure time', value => { value.variants[1].closures[0].atS = -1; }, /below the minimum of 0/, '-1'],
    ['unknown closure field', value => { value.variants[1].closures[0].untilS = 12; }, /Property untilS is not allowed/, '"untilS"'],
    ['nested edge distance', value => { value.baseScenario.edges[0].distanceM = 0; }, /below the minimum of 0\.01/, '0'],
    ['base closures must be empty', value => { value.baseScenario.closures = value.variants[1].closures; }, /Expected 0 or fewer/],
  ];
  for (const [name, mutate, expected, token] of cases) {
    await t.test(name, async () => {
      const value = JSON.parse(fixtureSources.get('examples/minimal-experiment.json'));
      mutate(value);
      const text = JSON.stringify(value, null, 2);
      assertDiagnostic(await editor().validate('drafts/invalid.experiment.json', text), expected, token, text);
    });
  }
});

test('root property and fixed-value completions distinguish the two formats', async () => {
  const service = editor();
  assertProperties(await service.complete('new.scenario.json', '{ | }'),
    ['version', 'seed', 'nodes', 'edges', 'jobs', 'durationS'], ['format', 'baseScenario', 'variants', '$schema']);
  assertProperties(await service.complete('new.experiment.json', '{ | }'),
    ['format', 'version', 'baseScenario', 'variants'], ['seed', 'nodes', 'edges', 'durationS', '$schema']);
  assertProperties(await service.complete('new.scenario.json', '{ "version": | }'), ['1'], ['2']);
  assertProperties(await service.complete('new.experiment.json', '{ "format": | }'), ['"detourlab-experiment"']);
  assertProperties(await service.complete('new.experiment.json', '{ "version": | }'), ['1'], ['2']);
});

test('nested edge, variant and closure property completion follows local definitions', async () => {
  const service = editor();
  for (const [path, text] of [
    ['new.scenario.json', '{ "edges": [{ | }] }'],
    ['new.experiment.json', '{ "baseScenario": { "edges": [{ | }] } }'],
  ]) {
    const items = await service.complete(path, text);
    assertProperties(items, ['id', 'from', 'to', 'distanceM', 'travelTimeS', 'roadName'], ['variants', 'atS', 'closures']);
    assert.match(items.find(item => item.label === 'distanceM').documentation, /meters/);
    assert.match(items.find(item => item.label === 'travelTimeS').documentation, /seconds/);
  }
  assertProperties(await service.complete('new.experiment.json', '{ "variants": [{ | }] }'),
    ['id', 'name', 'closures'], ['edges', 'durationS', 'baseScenario']);
  assertProperties(await service.complete('new.experiment.json', '{ "variants": [{ "closures": [{ | }] }] }'),
    ['id', 'edgeIds', 'atS'], ['untilS', 'distanceM']);
  assertProperties(await service.complete('new.experiment.json', '{ "baseScenario": { "version": | } }'), ['1'], ['2']);
});

test('editor completion does not invent referenced IDs or numeric bounds as allowed-value enums', async () => {
  const service = editor();
  for (const [path, text] of [
    ['new.scenario.json', '{ "edges": [{ "from": | }] }'],
    ['new.scenario.json', '{ "edges": [{ "distanceM": | }] }'],
    ['new.experiment.json', '{ "variants": [{ "closures": [{ "edgeIds": [|] }] }] }'],
  ]) assert.deepEqual(await service.complete(path, text), [], 'graph references stay a runtime check');
});

test('hover supplies units and boundary semantics at root, edge and nested variant levels', async () => {
  const service = editor();
  const scenario = fixtureSources.get('examples/minimal-directed.json');
  const experiment = fixtureSources.get('examples/minimal-experiment.json');
  assert.match(await service.hover('new.scenario.json', scenario, 'durationS'), /604800 seconds/);
  assert.match(await service.hover('new.scenario.json', scenario, 'distanceM'), /meters/);
  assert.match(await service.hover('new.scenario.json', scenario, 'travelTimeS'), /seconds/);
  assert.match(await service.hover('new.experiment.json', experiment, 'distanceM'), /meters/);
  const cutoff = await service.hover('new.experiment.json', experiment, 'atS');
  assert.match(cutoff, /seconds/i);
  assert.match(cutoff, /exactly at the cutoff is blocked/);
  assert.match(await service.hover('new.scenario.json', scenario, 'dueTimeS'), /Arrival exactly at the deadline is on time/);
});

test('schema loader rejects every unrecognized URL without a network or arbitrary-file fallback', async () => {
  const service = editor();
  for (const uri of [
    'https://example.invalid/remote.schema.json',
    'http://json-schema.org/draft-07/schema',
    ...[...schemaSources.values()].map(source => JSON.parse(source).$id),
    new URL('package.json', workspace).href,
    new URL('schemas/unknown.schema.json', workspace).href,
  ]) await assert.rejects(service.requestSchema(uri), /Only known local schemas may be loaded/);

  // Exercise the refusal through the real service as well as the callback.
  const remote = 'https://example.invalid/remote.schema.json';
  service.service.configure({ schemas: [{ uri: remote, fileMatch: ['*.external.json'], folderUri: workspace.href }] });
  const diagnostics = await service.validate('blocked.external.json', '{}');
  assert.ok(diagnostics.some(item => item.code === ErrorCode.SchemaResolveError));
  assert.match(diagnostics.map(item => item.message).join('\n'), /Only known local schemas may be loaded/);
  assert.equal(service.requests.at(-1), remote);
});

test('editor operations leave checked-in fixture and schema bytes unchanged', async () => {
  for (const [path, source] of fixtureSources) assert.equal(await readFile(new URL(path, workspace), 'utf8'), source, path);
  for (const [uri, source] of schemaSources) assert.equal(await readFile(new URL(uri), 'utf8'), source, uri);
});
