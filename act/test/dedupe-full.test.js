// dedupe-full.test.js — v1.1.0 · tests: a root message's id is remembered for the whole window; at the cap the bus refuses (DEDUPE_FULL), never forgets · changelog: act/CHANGELOG.md#acttestdedupe-fulltestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// The fifth cold read's #1: bus.js 1.5.0 dropped an identity's oldest id at dedupeCap whatever its age — on a request
// (bus.js:132) and at start (bus.js:68) — so an id inside the 24 h window could be replayed. Tests marked FAIL-FIRST fail on
// kernel 0.54.2 (bus.js 1.5.0); tests marked GUARD hold on both. 1.1.0 (v0.54.4): a child the bus made is not remembered, so the script
// tests of 1.0.0 (a script refused before it starts, a 422 naming DEDUPE_FULL) are gone with what they tested — what replaces them is in
// caller-pays.test.js; the empty-id test (the sixth cold read's #6) and the two non-string-id tests fail on 0.54.3 (envelope.js 1.2.0,
// act.js 1.9.2, edge.js 1.0.3).
// Run: node --test test/dedupe-full.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'dd-' + t + '-'));
const H = 3600000, DAY = 24 * H;

function actions(scripts = [], engine, world = []) {
  const dir = tmp('act');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  const spec = [...SPEC];
  scripts.forEach(([name, src], k) => {
    fs.writeFileSync(path.join(dir, name + '.pk'), src);
    spec.push({ name, version: '1.0.0', kind: 'script', file: name + '.pk', produces: 'computed', world: !!world[k], runsAs: name, needs: [], input: {}, acceptWarnings: true });
  });
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  const loaded = registry.load(dir, 'registry.json', engine ? { scriptEngine: engine } : {});
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  return loaded.actions;
}
const IDS = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} },
  { name: 'bot', kind: 'euser', owner: 'alex', actions: { calc: {} } }, { name: 'bot2', kind: 'euser', owner: 'alex', actions: { calc: {} } }]);
function world({ cap = 3, files = tmp('f'), clk = { t: Date.UTC(2026, 10, 11, 12, 0) } } = {}) {
  const audit = [];
  const bus = new Bus({ registry: actions(), identities: IDS, names: new Names('local'), audit: (l) => audit.push(JSON.parse(l)), filesRoot: files, clock: () => clk.t, dedupeCap: cap });
  return { bus, audit, files, clk };
}
const ask = (w, id, who = 'bot') => w.bus.ask(who, 'calc', { expr: '1+1' }, { id });
const lines = (files) => { try { return fs.readFileSync(path.join(files, '.dedupe.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('FAIL-FIRST request path: at the cap a new id is refused DEDUPE_FULL (transient, nothing run, nothing written), and the oldest id is still remembered', async () => {
  const w = world({ cap: 3 }); const t0 = w.clk.t;
  for (const id of ['a1', 'a2', 'a3']) { const r = await ask(w, id); assert.equal(r.ok, true, id + ': ' + JSON.stringify(r)); w.clk.t += 1000; }
  const r4 = await ask(w, 'a4');
  assert.equal(r4.ok, false, 'the fourth id ran: an id was forgotten to make room — ' + JSON.stringify(r4));
  assert.equal(r4.code, 'DEDUPE_FULL', JSON.stringify(r4));
  assert.equal(r4.transient, true, 'DEDUPE_FULL is transient: the run never started');
  assert.equal(r4.retryAfterMs, t0 + DAY - w.clk.t, 'retryAfterMs is the time until the oldest id leaves the window');
  assert.ok(!w.audit.some((x) => x.id === 'a4' && x.outcome === 'run'), 'a4 was never run');
  assert.ok(w.audit.some((x) => x.id === 'a4' && x.outcome === 'refused' && x.code === 'DEDUPE_FULL'), 'the refusal is audited');
  assert.ok(!lines(w.files).some((j) => j.i === 'a4'), 'a refused id is not remembered (it never ran: the caller may send it again)');
  const again = await ask(w, 'a1');
  assert.equal(again.code, 'DUPLICATE', 'the oldest id, inside the window, was forgotten and replayed: ' + JSON.stringify(again));
});

test('FAIL-FIRST start path: ids loaded from .dedupe.jsonl inside the window are all kept, whatever the cap', async () => {
  const files = tmp('f'), t = Date.UTC(2026, 10, 11, 12, 0);
  fs.writeFileSync(path.join(files, '.dedupe.jsonl'), ['b1', 'b2', 'b3', 'b4'].map((i, k) => JSON.stringify({ f: 'bot', i, t: t - H + k * 1000 })).join('\n') + '\n');
  const w = world({ cap: 3, files, clk: { t } });
  const r = await ask(w, 'b1');
  assert.equal(r.code, 'DUPLICATE', 'an id inside the window was dropped at start and replayed: ' + JSON.stringify(r));
  const n = await ask(w, 'b5');
  assert.equal(n.code, 'DEDUPE_FULL', 'more ids than the cap came back from disk: the identity is full until they age out — ' + JSON.stringify(n));
});

test('FAIL-FIRST ageing out: an id that leaves the window frees one slot, and only one', async () => {
  const w = world({ cap: 3 }); const t0 = w.clk.t;
  for (const id of ['c1', 'c2', 'c3']) { await ask(w, id); w.clk.t += 10; }
  w.clk.t = t0 + DAY;   // c1 is exactly at the edge: out of the window
  const r1 = await ask(w, 'c4'); assert.equal(r1.ok, true, 'a slot was freed: ' + JSON.stringify(r1));
  const r2 = await ask(w, 'c5');
  assert.equal(r2.code, 'DEDUPE_FULL', 'only one slot was freed: ' + JSON.stringify(r2));
  assert.equal(r2.retryAfterMs, t0 + 10 + DAY - w.clk.t, 'the next slot frees when c2 leaves the window');
  const old = await ask(w, 'c1'); assert.equal(old.code, 'DEDUPE_FULL', 'c1 left the window; it is a new id and must wait for a slot like any other');
});

test('GUARD per identity: one identity at the cap neither blocks nor flushes another', async () => {
  const w = world({ cap: 2 });
  await ask(w, 'd1'); await ask(w, 'd2');
  const other = await ask(w, 'd1', 'bot2'); assert.equal(other.ok, true, 'bot2 is blocked by bot: ' + JSON.stringify(other));
  const dup = await ask(w, 'd1'); assert.equal(dup.code, 'DUPLICATE', "bot's ids were flushed by bot2's");
});

test('GUARD M14: an id is remembered even when the request is refused at a later check', async () => {
  const w = world({ cap: 3 });
  const r = await w.bus.ask('bot', 'units', { value: '1', from: 'm', to: 'km' }, { id: 'e1' });   // bot does not hold units
  assert.equal(r.ok, false); assert.notEqual(r.code, 'DEDUPE_FULL');
  const again = await w.bus.ask('bot', 'calc', { expr: '1+1' }, { id: 'e1' });
  assert.equal(again.code, 'DUPLICATE', 'a refused request did not take its slot: ' + JSON.stringify(again));
});

// ---------- through act.js: the route, the start path and Retry-After ----------
test('FAIL-FIRST HTTP: through act.js, a full identity answers 503 DEDUPE_FULL with a Retry-After that says when a slot frees', async () => {
  const APP = path.join(ROOT, '..');
  const actmod = require(path.join(APP, 'act.js'));
  const ALEX = { role: 'admin', auth: 'login', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-00000000000f', loginId: 'alex' };
  const BOT = { role: 'euser', auth: 'key', uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000b0', loginId: 'bot', actGrants: JSON.stringify({ owner: 'alex', ownerId: ALEX.uniqueId, actions: { calc: {} } }) };
  const USERS = [ALEX, BOT];
  const prisma = { user: { findMany: async () => USERS.slice(), findUnique: async ({ where }) => USERS.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null, update: async () => null } };
  const src = path.join(ROOT, 'actions'), actionsDir = tmp('acts');
  const builtins = JSON.parse(fs.readFileSync(path.join(src, 'registry.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  for (const e of builtins) fs.copyFileSync(path.join(src, e.file), path.join(actionsDir, e.file));
  fs.writeFileSync(path.join(actionsDir, 'registry.json'), JSON.stringify({ actions: builtins }));
  const appDir = tmp('app'); fs.mkdirSync(path.join(appDir, 'act-files'), { recursive: true });
  const oldest = Date.now() - H, who = 'u-' + BOT.uniqueId;   // the bus's default cap: 50 000 ids, all inside the window
  const out = []; for (let k = 0; k < 50000; k++) out.push(JSON.stringify({ f: who, i: 'pre-' + k, t: oldest + k }));
  fs.writeFileSync(path.join(appDir, 'act-files', '.dedupe.jsonl'), out.join('\n') + '\n');
  const A = actmod.create({ prisma, models: { isInstalled: () => false }, modelUrl: 'http://127.0.0.1:1', appDir, log: { error() {} }, actionsDir });
  try {
    const headers = {};
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { headers[k] = v; return this; } };
    await A.route({ euser: BOT, body: { action: 'calc', input: { expr: '1+1' } } }, res);
    assert.equal(res.code, 503, 'a full identity ran or was refused otherwise: ' + JSON.stringify(res.body));
    assert.equal(res.body.code, 'DEDUPE_FULL');
    const s = Number(headers['Retry-After']);
    assert.ok(Number.isInteger(s) && s > 23 * 3600 - 120 && s <= 23 * 3600 + 1, 'Retry-After is the time until the oldest id leaves the window (about 23 h), in whole seconds: ' + headers['Retry-After']);
    const dup = { headers: {}, code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } };
    await A.route({ euser: BOT, body: { id: 'pre-0', action: 'calc', input: { expr: '1+1' } } }, dup);
    assert.equal(dup.body.code, 'DUPLICATE', 'the oldest id loaded at start was forgotten: ' + JSON.stringify(dup.body));
  } finally { if (A.stop) A.stop(); }
});

test('FAIL-FIRST edge: the edge sends the refusal\'s own Retry-After, rounded up to whole seconds, at least 1', async () => {
  const http = require('http');
  const { createEdge } = require(path.join(ROOT, 'core/edge'));
  const reply = { ok: false, code: 'DEDUPE_FULL', transient: true, retryAfterMs: 7200001, error: 'full', labels: [] };
  const srv = http.createServer(createEdge({ bus: { ask: async () => reply }, resolveKey: () => 'bot' }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const post = () => fetch('http://127.0.0.1:' + srv.address().port + '/act', { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'calc', input: {} }) });
  try {
    const r = await post(); assert.equal(r.status, 503); assert.equal(r.headers.get('retry-after'), '7201', 'rounded up');
    reply.retryAfterMs = 0; const r1 = await post(); assert.equal(r1.headers.get('retry-after'), '1', 'at least 1: 0 ms is sent as 1 s, not 0');
    delete reply.retryAfterMs; reply.code = 'DAEMON_FULL'; const r2 = await post(); assert.equal(r2.headers.get('retry-after'), '5', 'a code with no retryAfterMs keeps 5 s');
  } finally { srv.close(); }
});

// ---------- a time trigger ----------
test('FAIL-FIRST scheduler: a time trigger whose identity is full is refused DEDUPE_FULL, climbs the ladder, and is then lost — audited', async () => {
  const { Scheduler } = require(path.join(ROOT, 'scheduler'));
  const w = world({ cap: 1 }); const clk = w.clk;
  await ask(w, 'f1');   // bot is now full for 24 h
  const audit = [];
  const s = new Scheduler({ bus: w.bus, spec: { triggers: [{ id: 'hourly', script: 'calc', runsAs: 'bot', every: 3600 }] }, stateDir: tmp('sched'), clock: () => clk.t, audit: (r) => audit.push(r), pending: () => 1 });
  clk.t += H; await s.tick(); await new Promise((r) => setTimeout(r, 20));
  clk.t += 5000; await s.tick(); await new Promise((r) => setTimeout(r, 20));
  clk.t += 30000; await s.tick(); await new Promise((r) => setTimeout(r, 20));
  const done = audit.filter((r) => r.kind === 'trigger-done');
  assert.ok(done.length >= 1 && done.every((r) => r.code === 'DEDUPE_FULL' && r.transient === true), 'each fire refused DEDUPE_FULL, transient: ' + JSON.stringify(done));
  const lost = audit.find((r) => r.kind === 'trigger-lost');
  assert.ok(lost && lost.code === 'DEDUPE_FULL', 'lost after the ladder, and the audit line says why: ' + JSON.stringify(audit.map((r) => r.kind + ':' + (r.code || ''))));
});

// ---------- an id (the sixth cold read's #6) ----------
test('FAIL-FIRST non-string id (act.js): an id that is not a string (7, null, {}) is refused 400 BAD_ENVELOPE through act.js — never replaced, never run', async () => {
  const APP = path.join(ROOT, '..');
  const actmod = require(path.join(APP, 'act.js'));
  const ALEX = { role: 'admin', auth: 'login', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-00000000000f', loginId: 'alex' };
  const BOT = { role: 'euser', auth: 'key', uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000b0', loginId: 'bot', actGrants: JSON.stringify({ owner: 'alex', ownerId: ALEX.uniqueId, actions: { calc: {} } }) };
  const USERS = [ALEX, BOT];
  const prisma = { user: { findMany: async () => USERS.slice(), findUnique: async ({ where }) => USERS.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null, update: async () => null } };
  const src = path.join(ROOT, 'actions'), actionsDir = tmp('acts');
  const builtins = JSON.parse(fs.readFileSync(path.join(src, 'registry.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  for (const e of builtins) fs.copyFileSync(path.join(src, e.file), path.join(actionsDir, e.file));
  fs.writeFileSync(path.join(actionsDir, 'registry.json'), JSON.stringify({ actions: builtins }));
  const appDir = tmp('app'); fs.mkdirSync(path.join(appDir, 'act-files'), { recursive: true });
  const A = actmod.create({ prisma, models: { isInstalled: () => false }, modelUrl: 'http://127.0.0.1:1', appDir, log: { error() {} }, actionsDir });
  const call = async (body) => { const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } }; await A.route({ euser: BOT, body }, res); return res; };
  try {
    for (const id of [7, null, {}]) {
      const r = await call({ id, action: 'calc', input: { expr: '1+1' } });
      assert.equal(r.code, 400, JSON.stringify(id) + ' was run or replaced: ' + JSON.stringify(r.body));
      assert.equal(r.body.code, 'BAD_ENVELOPE', JSON.stringify(id));
    }
    const ok = await call({ action: 'calc', input: { expr: '1+1' } });
    assert.equal(ok.code, 200, 'a missing id still gets one: ' + JSON.stringify(ok.body));
  } finally { if (A.stop) A.stop(); }
});

test('FAIL-FIRST non-string id (edge): the bus\'s own edge refuses an id that is not a string 400 BAD_ENVELOPE — never replaced, never run', async () => {
  const http = require('http');
  const { createEdge } = require(path.join(ROOT, 'core/edge'));
  const w = world();
  const srv = http.createServer(createEdge({ bus: w.bus, resolveKey: () => 'bot' }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const post = (body) => fetch('http://127.0.0.1:' + srv.address().port + '/act', { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (const id of [7, null, {}]) {
      const r = await post({ id, action: 'calc', input: { expr: '1+1' } });
      assert.equal(r.status, 400, JSON.stringify(id));
      assert.equal((await r.json()).code, 'BAD_ENVELOPE', JSON.stringify(id));
    }
    assert.ok(!w.audit.some((x) => x.outcome === 'run'), 'nothing ran');
    const ok = await post({ action: 'calc', input: { expr: '1+1' } });
    assert.equal(ok.status, 200, 'a missing id still gets one');
  } finally { srv.close(); }
});
test('FAIL-FIRST empty id: an id of "" is refused BAD_ENVELOPE — never replaced, never run, never remembered; a missing id still gets one', async () => {
  const w = world();
  const r = await ask(w, '');
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.code, 'BAD_ENVELOPE', 'an empty id is refused, not replaced: ' + JSON.stringify(r));
  assert.ok(!w.audit.some((x) => x.outcome === 'run'), 'nothing ran');
  assert.equal(lines(w.files).length, 0, 'nothing remembered');
  const none = await w.bus.ask('bot', 'calc', { expr: '1+1' }, {});
  assert.equal(none.ok, true, JSON.stringify(none));
  assert.match(none.id, /^[0-9a-f-]{36}$/, 'a missing id is made: ' + none.id);
});
