// p0.test.js — v1.0.0 · tests: identities fixed per dispatch; the audit line on disk before a run · changelog: act/CHANGELOG.md#acttestp0testjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// F04 identities per dispatch · F05 audit durable before a run
// F06 duplicate ids survive a restart. Each test FAILS on bus.js 1.4.3 (v0.53.0 WIP).
//   node --test act/test/p0.test.js      (no dependencies)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus, ERR } = require(path.join(ROOT, 'core/bus'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');   // 0.53.2: shipped built-ins only — an installed script (staging: scout) is not part of this test
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'p0-' + t + '-'));

// gate: waits until the test opens its gate, THEN asks calc as a child — the moment another request could have swapped the snapshot
const GATE = "module.exports={run:async(i,ctx)=>{await (globalThis.__p0gate && globalThis.__p0gate[i.k]);const r=await ctx.send('calc',{expr:'1+1'});return r.ok?'ok':r.code;}};";
function actions() {
  const dir = tmp('act');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'gate.js'), GATE);
  const spec = [...SPEC, { name: 'gate', version: '1.0.0', kind: 'native', file: 'gate.js', produces: 'computed', world: false, input: { k: 'string' }, timeoutMs: 5000 }];
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  return registry.load(dir).actions;
}
const person = { name: 'alex', kind: 'person', owner: 'alex', actions: {} };
const WITH = caps.fromList([person, { name: 'bot', kind: 'euser', owner: 'alex', actions: { gate: {}, calc: {} } }]);      // calc granted
const WITHOUT = caps.fromList([person, { name: 'bot', kind: 'euser', owner: 'alex', actions: { gate: {} } }]);          // calc revoked
const opener = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

test('F04: a call carries its OWN identity snapshot — its child sees that snapshot, not the bus default', async () => {
  const bus = new Bus({ registry: actions(), identities: WITHOUT, names: new Names('local'), audit: () => {}, filesRoot: tmp('f') });
  globalThis.__p0gate = {};
  const r = await bus.ask('bot', 'gate', { k: 'none' }, { ids: WITH });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value, 'ok', 'the child used the bus default (calc revoked) instead of the call\'s snapshot');
});

test('F04: two requests in flight with different snapshots — each child sees its own (an older snapshot cannot leak into a newer call)', async () => {
  const bus = new Bus({ registry: actions(), identities: new Map(), names: new Names('local'), audit: () => {}, filesRoot: tmp('f') });
  const a = opener(), b = opener(); globalThis.__p0gate = { a: a.p, b: b.p };
  const ra = bus.ask('bot', 'gate', { k: 'a' }, { ids: WITH });       // granted calc when it started
  const rb = bus.ask('bot', 'gate', { k: 'b' }, { ids: WITHOUT });    // calc revoked when it started
  b.open(); a.open();
  const [A, B] = await Promise.all([ra, rb]);
  assert.equal(A.value, 'ok', 'A: ' + JSON.stringify(A));
  assert.equal(B.value, ERR.NOT_PERMITTED, 'B: a revoked grant survived — ' + JSON.stringify(B));
});

test('F05: the audit "run" line is on disk (fsync) BEFORE the action runs', async () => {
  const dir = tmp('audit'), file = path.join(dir, 'act.jsonl');
  const order = [];
  const realFsync = fs.fsyncSync;
  fs.fsyncSync = (fd) => { order.push('fsync'); return realFsync(fd); };
  try {
    const names = new Names('local');
    const loaded = actions();
    const calc = loaded.get('calc'), run = calc.impl.run;
    const spy = new Map(loaded); spy.set('calc', { ...calc, impl: { run: (i, c) => { order.push('run'); return run(i, c); } } });
    const bus = new Bus({ registry: spy, identities: WITH, names, auditFile: file, filesRoot: tmp('f') });
    const r = await bus.ask('bot', 'calc', { expr: '2+2' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(order.indexOf('fsync') !== -1 && order.indexOf('fsync') < order.indexOf('run'), 'order: ' + order.join(','));
    assert.match(fs.readFileSync(file, 'utf8'), /"outcome":"run"/);
  } finally { fs.fsyncSync = realFsync; }
});

test('F06: a duplicate id is still refused after a restart (a new bus over the same files folder)', async () => {
  const files = tmp('f');
  const mk = () => new Bus({ registry: actions(), identities: WITH, names: new Names('local'), audit: () => {}, filesRoot: files });
  const r1 = await mk().ask('bot', 'calc', { expr: '1+1' }, { id: 'once-only-1' });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const r2 = await mk().ask('bot', 'calc', { expr: '1+1' }, { id: 'once-only-1' });
  assert.equal(r2.code, ERR.DUPLICATE, 'ran twice after a restart: ' + JSON.stringify(r2));
  const r3 = await mk().ask('bot', 'calc', { expr: '1+1' }, { id: 'once-only-2' });
  assert.equal(r3.ok, true, 'a new id was refused: ' + JSON.stringify(r3));
});

test('F06: the dedupe file is compacted and expired ids are forgotten (no unbounded growth)', async () => {
  const files = tmp('f'); const clk = { t: Date.UTC(2026, 10, 5) };
  const mk = () => new Bus({ registry: actions(), identities: WITH, names: new Names('local'), audit: () => {}, filesRoot: files, clock: () => clk.t, dedupeMs: 1000 });
  const bus = mk();
  for (let i = 0; i < 200; i++) { await bus.ask('bot', 'calc', { expr: '1+1' }, { id: 'x' + i }); clk.t += 100; }
  clk.t += 5000;
  const again = await mk().ask('bot', 'calc', { expr: '1+1' }, { id: 'x0' });
  assert.equal(again.ok, true, 'an expired id was still refused: ' + JSON.stringify(again));
  const f = path.join(files, '.dedupe.jsonl');
  assert.ok(fs.existsSync(f), 'no dedupe file');
  assert.ok(fs.readFileSync(f, 'utf8').trim().split('\n').length < 100, 'not compacted: ' + fs.readFileSync(f, 'utf8').split('\n').length + ' lines');
});
