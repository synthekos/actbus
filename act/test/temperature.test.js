// temperature.test.js — v1.1.0 · tests: the kernel fixes the model's sampling temperature at 0.2; only the host's code can change it · changelog: act/CHANGELOG.md#acttesttemperaturetestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// The model action's request is built by act.js's modelGenerate(), which sends `options: { temperature: 0.2 }` on every call.
// Nothing a script, a grant or an EUser supplies reaches that value: the action's input is { model, prompt, system? } and the
// registry refuses any other field; the handler takes { model, prompt, system } and nothing else; create() refuses any own option it does
// not know, a temperature included, and reads none from the environment. These tests fail if the value becomes settable by anything but a change to the host's code.
// No real network: fetchImpl is a stand-in that keeps each request body.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const actmod = require(path.join(ROOT, '..', 'act.js'));
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'temperature-' + t + '-'));
const prisma = { user: { findMany: async () => [] } };
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.json'), 'utf8')).actions.find((e) => e.name === 'model');

// every way a caller could try to pass a temperature: as an input field, as model options, and in odd spellings
const TRIES = [{ temperature: 1.5 }, { options: { temperature: 1.5 } }, { options: { temperature: 1.5, seed: 7 } }, { Temperature: 1.5 },
  { temp: 1.5 }, { top_p: 0.9 }, { __proto__: { temperature: 1.5 } }];

function make(extra) {
  const bodies = [];
  const fetchImpl = async (url, opt) => { bodies.push(JSON.parse(opt.body)); return { ok: true, json: async () => ({ response: 'ok' }) }; };
  const A = actmod.create({ prisma, models: { isInstalled: () => true }, appDir: tmp('app'), log: { error() {}, warn() {} }, daemon: true,
    modelUrl: 'http://127.0.0.1:9', fetchImpl, env: {}, ...extra });
  return { A, bodies };
}

test('the model action\'s declared input is model, prompt and system: the registry refuses a temperature or any other field', () => {
  assert.deepEqual(Object.keys(SPEC.input).sort(), ['model', 'prompt', 'system']);
  for (const t of TRIES) {
    const input = Object.assign(Object.create(Object.getPrototypeOf(t)), { model: 'm', prompt: 'p' }, t);
    const own = Object.keys(t);
    if (own.length) assert.match(registry.checkInput(SPEC.input, input) || '', /^unknown input field: /, JSON.stringify(own));
    else assert.equal(registry.checkInput(SPEC.input, input), null, 'an inherited field is not an input field');
  }
});

test('every request to the model server carries options { temperature: 0.2 } and nothing else, whatever the call carries', async () => {
  const { A, bodies } = make({});
  try {
    const h = A.bus.names.resolve('model', 'm').handler;
    await h({ model: 'm', prompt: 'p' });
    for (const t of TRIES) await h({ model: 'm', prompt: 'p', system: 's', identity: 'alex', trace: 't1', ...t });
  } finally { await A.stop(); }
  assert.equal(bodies.length, 1 + TRIES.length);
  for (const b of bodies) assert.deepEqual(b.options, { temperature: 0.2 });
});

test('create() refuses an own temperature option, and an environment variable naming one changes nothing on the wire', async () => {
  for (const opt of [{ temperature: 1.5 }, { modelOptions: { temperature: 1.5 } }, { options: { temperature: 1.5 } }])
    assert.throws(() => make(opt), { message: /^create\(\): unknown option "(temperature|modelOptions|options)" — the options are / });
  const env = { TEMPERATURE: '1.5', MODEL_TEMPERATURE: '1.5', ACT_TEMPERATURE: '1.5', PK_TEMPERATURE: '1.5' };
  const { A, bodies } = make({ env });
  try { await A.bus.names.resolve('model', 'm').handler({ model: 'm', prompt: 'p' }); } finally { await A.stop(); }
  assert.deepEqual(bodies.map((b) => b.options), [{ temperature: 0.2 }]);
});

test('the value is written once, in act.js, as a literal; the model action forwards no options', () => {
  const src = fs.readFileSync(path.join(ROOT, '..', 'act.js'), 'utf8');
  assert.deepEqual(src.match(/temperature/g), ['temperature'], 'act.js names temperature exactly once');
  assert.equal(src.split('\n').filter((l) => l.includes('options: { temperature: 0.2 } })')).length, 1);
  assert.equal((src.match(/async function modelGenerate\(\{ model, prompt, system \}\) \{/g) || []).length, 1, 'the handler takes model, prompt and system only');
  const model = fs.readFileSync(path.join(ROOT, 'actions/model.js'), 'utf8');
  assert.equal(/temperature|options/.test(model.split('\n').filter((l) => !l.startsWith('//')).join('\n')), false, 'model.js passes no options');
});

test('GUARD create(): an inherited temperature option changes nothing on the wire', async () => {
  const bodies = [];
  const fetchImpl = async (url, opt) => { bodies.push(JSON.parse(opt.body)); return { ok: true, json: async () => ({ response: 'ok' }) }; };
  const opts = Object.assign(Object.create({ temperature: 1.5, modelOptions: { temperature: 1.5 }, options: { temperature: 1.5 } }),
    { prisma, models: { isInstalled: () => true }, appDir: tmp('inherited'), log: { error() {}, warn() {} }, daemon: true, modelUrl: 'http://127.0.0.1:9', fetchImpl, env: {} });
  const A = actmod.create(opts);
  try { await A.bus.names.resolve('model', 'm').handler({ model: 'm', prompt: 'p' }); } finally { await A.stop(); }
  assert.deepEqual(bodies.map((b) => b.options), [{ temperature: 0.2 }]);
});
