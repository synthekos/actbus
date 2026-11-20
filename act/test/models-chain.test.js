// models-chain.test.js — v1.0.0 · tests: a model is allowed only if every identity in the chain lists it, through a script that runs as another identity (bus.js:205) · changelog: act/CHANGELOG.md#acttestmodels-chaintestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// empty-chain.test.js tests caps.modelsFor() itself; these test the bus's use of it, through a chained dispatch, so that ctx.models() is the
// chain's intersection and not the running identity's own list. Tests marked FAIL-FIRST fail when bus.js:205's `authority` is replaced by
// `[actAs]`; the GUARD holds either way.
// Run: node --test test/models-chain.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'mch-' + t + '-'));

// caller → asker (a script that runs as `asker`) → model. `asker` lists model-a; the caller's list is the argument.
function world(callerModels) {
  const dir = tmp('act'), box = tmp('box');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'asker.pk'), '(get (model :model "model-a" :prompt "hi") "text")\n');
  const spec = [...SPEC, { name: 'asker', version: '1.0.0', kind: 'script', file: 'asker.pk', produces: 'computed', world: false, runsAs: 'asker', needs: [], input: {}, acceptWarnings: true }];
  const actions = spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) }));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions }));
  const engine = createEngine({ stateRoot: box, audit: () => {} });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const g = { asker: {}, model: {} };
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: g, models: callerModels }, { name: 'asker', kind: 'script', owner: 'alex', actions: g, models: ['model-a'] }]);
  const names = new Names('local'); names.attach('model', 'model-a', 'local', async () => 'model says hi');
  const bus = new Bus({ registry: loaded.actions, identities: ids, names, filesRoot: box, audit: () => {} });
  return { bus };
}

test('FAIL-FIRST models: the caller lists no model, the script identity lists model-a — the script\'s model call is refused', async () => {
  const w = world([]);
  const r = await w.bus.ask('alex', 'asker', {});
  assert.equal(r.ok, false, 'the model ran for a caller whose list does not name it: ' + JSON.stringify(r));
  assert.match(String(r.error), /model model-a is not permitted/, JSON.stringify(r));
});

test('FAIL-FIRST models: the caller lists another model only — the script\'s model call is still refused', async () => {
  const w = world(['model-b']);
  const r = await w.bus.ask('alex', 'asker', {});
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.match(String(r.error), /model model-a is not permitted/, JSON.stringify(r));
});

test('GUARD models: when the caller lists model-a too, the script\'s model call runs', async () => {
  const w = world(['model-a']);
  const r = await w.bus.ask('alex', 'asker', {});
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, 'model says hi');
});
