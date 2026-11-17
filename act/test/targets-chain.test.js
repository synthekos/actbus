// targets-chain.test.js — v1.0.0 · tests: an absent targets field restricts a chain as an empty list does (issue #18) · changelog: act/CHANGELOG.md#acttesttargets-chaintestjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// Tests marked FAIL-FIRST fail on ACTBUS v0.3.7 (capabilities.js 1.1.0); tests marked GUARD hold on both.
// Run from anywhere: node --test act/test/targets-chain.test.js — the test finds the kernel by its own location (act/test/..), never by ACT_ROOT
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');   // the kernel's act/, found from this file's own location
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-' + t + '-'));
const HOST = 'rates.example', URL_ = 'https://' + HOST + '/usdcad';

function world(callerFetch) {
  const dir = tmp('act'), box = tmp('box'), files = tmp('f'), audit = [], seen = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  const engine = createEngine({ stateRoot: box, audit: () => {}, daemon: false });
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  fs.writeFileSync(path.join(dir, 'rate.pk'), '(get (fetch :url "' + URL_ + '") "status")');
  spec.push({ name: 'rate', version: '1.0.0', kind: 'script', file: 'rate.pk', produces: 'computed', world: true, runsAs: 'svc', needs: [], input: {}, acceptWarnings: true });
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  assert.deepEqual(loaded.refused, []);
  const caller = { name: 'caller', kind: 'euser', owner: 'alex', actions: { rate: {}, ...(callerFetch === undefined ? {} : { fetch: callerFetch }) } };
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} },
    { name: 'svc', kind: 'script', owner: 'alex', actions: { rate: {}, fetch: { targets: [HOST] } } }, caller]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), filesRoot: files, audit: (l) => audit.push(JSON.parse(l)),
    fetch: async (u) => { seen.push(u); return { status: 200, text: async () => 'x' }; } });
  return { bus, ids, audit, seen, close: () => engine.close() };
}

test('FAIL-FIRST effective(): an absent targets field intersects as an empty list, for every target-taking action', () => {
  for (const a of ['fetch', 'email', 'send', 'messages']) {
    const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} },
      { name: 'p', kind: 'euser', owner: 'alex', actions: { [a]: {} } },
      { name: 'q', kind: 'euser', owner: 'alex', actions: { [a]: { targets: ['x'] } } }]);
    assert.deepEqual(caps.effective(ids, ['p', 'q'], a).targets, [], a + ': absent then listed');
    assert.deepEqual(caps.effective(ids, ['q', 'p'], a).targets, [], a + ': listed then absent');
  }
});

test('FAIL-FIRST a caller whose fetch grant has no targets field cannot reach a host through a PROTEUS-K script that may', async () => {
  const w = world({});
  try {
    const r = await w.bus.ask('caller', 'rate', {});
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(w.seen.length, 0, 'no network call');
    const f = w.audit.filter((l) => l.action === 'fetch');
    assert.deepEqual(f.map((l) => l.outcome + ':' + (l.code || '')), ['refused:NO_TARGET']);
  } finally { w.close(); }
});

for (const [label, g, ok] of [['an empty list', { targets: [] }, false], ['another host', { targets: ['other.example'] }, false], ['the same host', { targets: [HOST] }, true]]) {
  test('GUARD a caller with ' + label + ' through the script: ' + (ok ? 'reaches' : 'does not reach') + ' the host', async () => {
    const w = world(g);
    try { const r = await w.bus.ask('caller', 'rate', {}); assert.equal(r.ok, ok, JSON.stringify(r)); assert.equal(w.seen.length, ok ? 1 : 0); } finally { w.close(); }
  });
}

test('GUARD alone, an absent targets field reaches nothing (unchanged)', async () => {
  const w = world({});
  try { const r = await w.bus.ask('caller', 'fetch', { url: URL_ }); assert.equal(r.code, 'NO_TARGET'); assert.equal(w.seen.length, 0); } finally { w.close(); }
});

test('GUARD an action with no target form is unaffected (calc through effective)', () => {
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} },
    { name: 'p', kind: 'euser', owner: 'alex', actions: { calc: {} } }, { name: 'q', kind: 'euser', owner: 'alex', actions: { calc: {} } }]);
  const e = caps.effective(ids, ['p', 'q'], 'calc');
  assert.ok(e && (e.targets === null || (Array.isArray(e.targets) && e.targets.length === 0)), JSON.stringify(e));
});
