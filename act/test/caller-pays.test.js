// caller-pays.test.js — v1.0.0 · tests: a call a script or action makes is paid for by the caller who caused it · changelog: act/CHANGELOG.md#acttestcaller-paystestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// bus.js 1.7.0 (v0.54.4): a child the bus made (ctx.send) is not remembered and fills no identity's set (the sixth cold read's #7),
// and it counts against the ROOT caller's rate, not the identity it is sent as. On 0.54.3 a script's calls were spent from its runsAs
// identity, shared by all its callers: three callers could lock a fourth out of a shared script for 24 h (dedupe) or a minute (rate).
// Tests marked FAIL-FIRST fail on kernel 0.54.3 (bus.js 1.6.0); tests marked GUARD hold on both.
// Run: node --test test/caller-pays.test.js
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
const { Supervisor } = require(path.join(ROOT, 'daemon/supervisor'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'cp-' + t + '-'));
const ONE = '(get (calc :expr "1+1") "result")';
const FOUR = '(do (calc :expr "1+1") (calc :expr "1+1") (calc :expr "1+1") (calc :expr "1+1"))';

// scripts: [[name, source, runsAs]] · callers: [[name, rate?]] · scriptRates: { identity: rate } · every caller may call every script and calc
function world({ scripts, callers, cap = 50000, mode = 'in-process', scriptRates = {} }) {
  const dir = tmp('act'), box = tmp('box'), files = tmp('f'), audit = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  const sup = mode === 'daemon' ? new Supervisor({ audit: () => {} }) : false;
  const engine = createEngine({ stateRoot: box, audit: () => {}, daemon: sup });
  const spec = [...SPEC];
  for (const [name, src, runsAs] of scripts) {
    fs.writeFileSync(path.join(dir, name + '.pk'), src);
    spec.push({ name, version: '1.0.0', kind: 'script', file: name + '.pk', produces: 'computed', world: false, runsAs, needs: [], input: {}, acceptWarnings: true });
  }
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const all = { calc: {}, ...Object.fromEntries(scripts.map(([n]) => [n, {}])) };
  const people = callers.map(([name, rate]) => ({ name, kind: 'euser', owner: 'alex', actions: all, ...(rate ? { rate } : {}) }));
  const runsAs = [...new Set(scripts.map(([, , r]) => r))].filter((r) => !callers.some(([n]) => n === r));
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} }, ...people,
    ...runsAs.map((name) => ({ name, kind: 'script', owner: 'alex', actions: all, ...(scriptRates[name] ? { rate: scriptRates[name] } : {}) }))]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), audit: (l) => audit.push(JSON.parse(l)), filesRoot: files, dedupeCap: cap });
  return { bus, audit, files, close: () => { engine.close(); if (sup) sup.close(); } };
}
const lines = (files) => { try { return fs.readFileSync(path.join(files, '.dedupe.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const ran = (w, action) => w.audit.filter((x) => x.outcome === 'run' && x.action === action).length;

// ---------- dedupe: a child's id is not remembered ----------
for (const mode of ['in-process', 'daemon']) {
  test('FAIL-FIRST shared script (' + mode + '): three callers use a shared script at a cap of 3, and a fourth is still served — its replay is still 409', async () => {
    const w = world({ scripts: [['svc', ONE, 'svc']], callers: [['c1'], ['c2'], ['c3'], ['c4']], cap: 3, mode });
    try {
      for (const c of ['c1', 'c2', 'c3']) { const z = await w.bus.ask(c, 'svc', {}, { id: 'fill' }); assert.equal(z.ok, true, c + ': ' + JSON.stringify(z)); }
      const r = await w.bus.ask('c4', 'svc', {}, { id: 'Y' });
      assert.equal(r.ok, true, 'the fourth caller, whose own set is empty, is served: ' + JSON.stringify(r));
      const again = await w.bus.ask('c4', 'svc', {}, { id: 'Y' });
      assert.equal(again.code, 'DUPLICATE', 'a replay of a root id is still refused: ' + JSON.stringify(again));
      assert.ok(!(w.bus.seen.get('svc') && w.bus.seen.get('svc').size), 'the script identity holds no ids');
      assert.deepEqual(lines(w.files).map((l) => l.f + ':' + l.i), ['c1:fill', 'c2:fill', 'c3:fill', 'c4:Y'], 'only the roots are on disk');
      assert.equal(ran(w, 'calc'), 4, 'each served call ran its child');
    } finally { w.close(); }
  });
}

test('FAIL-FIRST own script: a caller one id below its cap runs a script that runs as itself — its calls spend nothing; the same id is 409', async () => {
  const w = world({ scripts: [['own', '(do (calc :expr "1+1") (calc :expr "1+1"))', 'ue']], callers: [['ue']], cap: 3 });
  try {
    for (const id of ['a', 'b']) assert.equal((await w.bus.ask('ue', 'calc', { expr: '1+1' }, { id })).ok, true);
    const r = await w.bus.ask('ue', 'own', {}, { id: 'X' });
    assert.equal(r.ok, true, 'one id left: the script runs, its two calls are not counted: ' + JSON.stringify(r));
    assert.equal((await w.bus.ask('ue', 'own', {}, { id: 'X' })).code, 'DUPLICATE');
    assert.equal(lines(w.files).length, 3, 'three root ids on disk, no child id');
  } finally { w.close(); }
});

// ---------- rate: a child counts against the root caller ----------
test('FAIL-FIRST shared rate: three callers drive a script whose identity is allowed 3 a minute, and a fourth caller, untouched, is not refused RATE', async () => {
  const w = world({ scripts: [['svc', ONE, 'svc']], callers: [['c1'], ['c2'], ['c3'], ['c4']], scriptRates: { svc: 3 } });
  try {
    for (const c of ['c1', 'c2', 'c3']) assert.equal((await w.bus.ask(c, 'svc', {}, {})).ok, true, c);
    const r = await w.bus.ask('c4', 'svc', {}, {});
    assert.equal(r.ok, true, 'the script identity has no rate of its own for its callers to share: ' + JSON.stringify(r));
    assert.ok(!w.audit.some((x) => x.code === 'RATE'), 'nothing was refused RATE');
  } finally { w.close(); }
});

test('FAIL-FIRST own rate: a caller allowed 3 a minute cannot run 4 calls through a script — refused at its own 4th message, which names the script', async () => {
  const w = world({ scripts: [['four', FOUR, 'four']], callers: [['c1', 3]] });
  try {
    const r = await w.bus.ask('c1', 'four', {}, {});
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.code, 'ACTION_ERROR', 'the script had started: ' + JSON.stringify(r));
    assert.match(r.error, /RATE c1 exceeded 3 messages per minute \(a call made for it by four\)/, 'the refusal names the payer and the script: ' + r.error);
    assert.equal(ran(w, 'calc'), 2, '1 root + 2 calls = 3 messages; the third call was refused');
    const refused = w.audit.find((x) => x.outcome === 'refused' && x.code === 'RATE');
    assert.ok(refused && refused.action === 'calc' && refused.from === 'four', 'refused at the call, sent as four: ' + JSON.stringify(refused));
  } finally { w.close(); }
});

test('GUARD trigger: a root sent as a script identity (a time trigger) pays for its own calls — they count against that identity', async () => {
  const w = world({ scripts: [['tick', FOUR, 'tick']], callers: [], scriptRates: { tick: 3 } });
  try {
    const r = await w.bus.ask('tick', 'tick', {}, {});   // as the scheduler sends it: from the trigger's runsAs identity
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.error, /RATE tick exceeded 3 messages per minute/, r.error);
    assert.equal(ran(w, 'calc'), 2);
  } finally { w.close(); }
});
