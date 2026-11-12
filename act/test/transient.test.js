// transient.test.js — v1.2.2 · tests: transient refusals, through every site they pass · changelog: act/CHANGELOG.md#acttesttransienttestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// One rule, the sites it passes through: supervisor (sets it) → engine (keeps it) → bus (code + transient: true, reply AND audit) →
// edge (503) → scheduler (a time trigger retries once, then `lost`) · and the mailbox, which needs no change (a refused run claimed
// nothing — proved below). Tests marked FAIL-FIRST fail on 0.53.3; tests marked GUARD hold on both (they pin what must not change).
// Run: node --test test/transient.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus, ERR } = require(path.join(ROOT, 'core/bus'));
const { STATUS } = require(path.join(ROOT, 'core/edge'));
const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
const { Supervisor } = require(path.join(ROOT, 'daemon/supervisor'));
const { Scheduler } = require(path.join(ROOT, 'scheduler'));
const { Mailbox } = require(path.join(ROOT, 'mailbox'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'tr-' + t + '-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CODES = ['DAEMON_FULL', 'DAEMON_EVICTING', 'DAEMON_OVERLAP', 'DAEMON_PAUSED', 'DAEMON_RESTARTING', 'DEDUPE_FULL'];   // 1.2.2 (v0.54.3): + DEDUPE_FULL
const LONG = '(for-each (a (input xs)) (for-each (b (input xs)) (for-each (c (input xs)) (+ (number a) (number b) (number c)))))';
const XS = Array.from({ length: 100 }, (_, i) => String(i));

// the same small world as daemon.test.js: scripts as identities that hold themselves, alex may call each
function world(scripts, { daemon = {}, fuel } = {}) {
  const dir = tmp('act'), box = tmp('box');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  const spec = [...SPEC];
  for (const [name, src] of scripts) {
    fs.writeFileSync(path.join(dir, name + '.pk'), src);
    spec.push({ name, version: '1.0.0', kind: 'script', file: name + '.pk', produces: 'computed', world: false, runsAs: name, needs: [], input: { xs: 'array?' }, acceptWarnings: true });
  }
  const actions = spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) }));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions }));
  const audit = [];
  const sup = new Supervisor({ audit: (r) => audit.push(r), ...daemon });
  const engine = createEngine({ stateRoot: box, audit: (r) => audit.push(r), daemon: sup, fuel });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: { calc: {}, ...Object.fromEntries(scripts.map(([n]) => [n, {}])) } },
    ...scripts.map(([name]) => ({ name, kind: 'script', owner: 'alex', actions: { calc: {}, [name]: {} } }))]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), fetch: async () => ({ status: 404, text: async () => '' }), filesRoot: box, audit: (l) => audit.push(JSON.parse(l)) });
  return { bus, audit, engine, sup };
}
function stubbed(opts) {
  const s = new Supervisor({ audit: () => {}, ...opts });
  s.spawn = function (id) { const x = { child: { kill() {}, connected: true, send() {} }, identity: id, busy: null, idle: null, lastUsed: Date.now(), ready: new Promise(() => {}) }; this.d.set(id, x); return x; };
  return s;
}
const refusal = (p) => Promise.race([p.then(() => ({ ran: true }), (e) => e), sleep(50).then(() => ({ hung: true }))]);

// ---------- supervisor ----------
test('FAIL-FIRST supervisor: every refusal of a run that never started is coded and transient; a shut-down supervisor is not', async () => {
  const s = stubbed({ max: 1, crashLimit: 1 });
  s.run('a', {}, {}).catch(() => {});
  const full = await refusal(s.run('b', {}, {}));
  const overlap = await refusal(s.run('a', {}, {}));
  s.crash('c', 'test'); const paused = await refusal(s.run('c', {}, {}));
  const r = stubbed({ max: 4, crashLimit: 99 }); r.crash('d', 'test'); const restarting = await refusal(r.run('d', {}, {}));
  const v = stubbed({ max: 1 }); v.spawn = function (id) { const x = { child: { kill() {}, connected: true, send() {} }, identity: id, busy: null, idle: null, lastUsed: Date.now(), ready: Promise.resolve() }; this.d.set(id, x); return x; };
  v.d.set('idle-one', { child: { kill() {}, connected: true, send() {} }, identity: 'idle-one', busy: null, idle: null, lastUsed: 0, ready: Promise.resolve() });
  const evicting = await refusal(v.run('f', {}, {}));
  for (const [e, code] of [[full, 'DAEMON_FULL'], [evicting, 'DAEMON_EVICTING'], [overlap, 'DAEMON_OVERLAP'], [paused, 'DAEMON_PAUSED'], [restarting, 'DAEMON_RESTARTING']]) {
    assert.equal(e.code, code, code + ': ' + JSON.stringify({ code: e.code, message: e.message }));
    assert.equal(e.transient, true, code + ' is transient');
  }
  assert.match(paused.message, /paused after 1 crashes/, 'the message is unchanged');
  s.close(); r.close(); v.close();
  const closed = await refusal(s.run('e', {}, {}));
  assert.notEqual(closed.transient, true, 'a shut-down supervisor is not transient: there is nothing to come back to');
});

// ---------- engine + bus, through the real path ----------
test('FAIL-FIRST bus: a run refused DAEMON_FULL comes back with that code and transient: true — in the reply and in its audit line', async () => {
  const w = world([['p1', LONG], ['p2', '(get (calc :expr "1+1") "result")']], { fuel: 100000000, daemon: { max: 1, crashLimit: 99 } });
  try {
    const long = w.bus.ask('alex', 'p1', { xs: XS }, {});
    await sleep(300);
    const r = await w.bus.ask('alex', 'p2', {}, {});
    assert.equal(r.ok, false);
    assert.equal(r.code, 'DAEMON_FULL', JSON.stringify(r));
    assert.equal(r.transient, true);
    const line = w.audit.find((x) => x.outcome === 'error' && x.action === 'p2');
    assert.ok(line && line.code === 'DAEMON_FULL' && line.transient === true, 'audited with its code and transient: ' + JSON.stringify(line));
    w.engine.close(); await long;
  } finally { w.engine.close(); }
});

test('GUARD bus: a daemon cannot make its own failure transient — whatever it sends, a failed run is ACTION_ERROR', async () => {
  const fdir = tmp('fake'), fake = path.join(fdir, 'fake.js');
  fs.writeFileSync(fake, `process.on('message', (m) => { if (m.t === 'run') process.send({ t: 'done', runId: m.runId, ok: false, code: 'DAEMON_FULL', transient: true, message: 'DAEMON_FULL: I say so', labels: [] }); });
  process.send({ t: 'ready', pid: process.pid, permission: !!process.permission });`);
  const w = world([['s', '"x"']], { daemon: { daemonPath: fake, allowRead: fdir } });
  try {
    const r = await w.bus.ask('alex', 's', {}, {});
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ACTION_ERROR', JSON.stringify(r));
    assert.notEqual(r.transient, true);
  } finally { w.engine.close(); }
});

test('FAIL-FIRST edge: a transient refusal answers HTTP 503; the bus and the supervisor name the same six codes', () => {
  for (const c of CODES) { assert.equal(ERR[c], c, 'the bus knows ' + c); assert.equal(STATUS[c], 503, c + ' → 503'); }
  const { TRANSIENT } = require(path.join(ROOT, 'daemon/supervisor'));
  const { TRANSIENT_CODES } = require(path.join(ROOT, 'core/bus'));
  assert.deepEqual([...TRANSIENT].sort(), [...CODES].sort());
  assert.deepEqual([...TRANSIENT_CODES].sort(), [...CODES].sort(), 'a code added in one place must be added in the other');
});

// ---------- scheduler ----------
const H = 3600000;
function sched(triggers, answers) {
  const clk = { t: Date.UTC(2026, 10, 6, 15, 0) }, audit = [], calls = [];
  const bus = { ask: async (who, action) => { calls.push(action); return answers.length ? answers.shift() : { ok: true, labels: [] }; } };
  const s = new Scheduler({ bus, spec: { triggers }, stateDir: tmp('sched'), clock: () => clk.t, audit: (r) => audit.push(r), pending: () => 1 });   // the default ladder: 5 s, 30 s
  return { s, clk, audit, calls };
}
const T_FULL = { ok: false, code: 'DAEMON_FULL', transient: true, error: 'all 8 script daemons are busy', labels: [] };
const kinds = (audit) => audit.map((r) => r.kind);

test('FAIL-FIRST scheduler: a time trigger refused transiently is retried on the first rung (5 s) — and the retry runs', async () => {
  const { s, clk, audit, calls } = sched([{ id: 'hourly', script: 'thought', runsAs: 'helper', every: 3600 }], [T_FULL]);
  clk.t += H; await s.tick();
  assert.deepEqual(calls, ['thought']);
  assert.ok(kinds(audit).includes('trigger-retry-later'), JSON.stringify(kinds(audit)));
  clk.t += 4000; await s.tick(); assert.equal(calls.length, 1, 'not before the first rung');
  clk.t += 1000; await s.tick(); assert.equal(calls.length, 2, 'the retry fires');
  const fires = audit.filter((r) => r.kind === 'trigger-fire');
  assert.equal(fires[1].retry, true, 'audited as the retry');
  assert.equal(audit.filter((r) => r.kind === 'trigger-done').pop().ok, true);
  clk.t += 60000; await s.tick(); assert.equal(calls.length, 2, 'no further retry');
});

test('FAIL-FIRST scheduler: one ladder for every code — 5 s, then 30 s, then lost; never a fourth try', async () => {
  const { s, clk, audit, calls } = sched([{ id: 'hourly', script: 'thought', runsAs: 'helper', every: 3600 }], [T_FULL, { ...T_FULL, code: 'DAEMON_OVERLAP' }, { ...T_FULL, code: 'DAEMON_PAUSED' }]);
  const t0 = clk.t;
  clk.t += H; await s.tick(); clk.t += 5000; await s.tick();
  clk.t += 29000; await s.tick(); assert.equal(calls.length, 2, 'the second rung is 30 s, whatever the code');
  clk.t += 1000; await s.tick();
  assert.equal(calls.length, 3);
  const lost = audit.find((r) => r.kind === 'trigger-lost');
  assert.ok(lost && lost.code === 'DAEMON_PAUSED', JSON.stringify(audit.slice(-3)));
  clk.t += 60000; await s.tick(); clk.t += 60000; await s.tick(); assert.equal(calls.length, 3, 'lost means lost: the next try is the next period');
  clk.t = t0 + 2 * H; await s.tick(); assert.equal(calls.length, 4, 'the next period fires as normal (ticked on time: later than graceMs would be a missed fire, skipped by design)');
  assert.equal(audit.filter((r) => r.kind === 'trigger-fire' && r.retry).length, 2, 'two retries, audited as such');
});

test('FAIL-FIRST scheduler: a normal fire that comes due first replaces the pending retry (never two)', async () => {
  const { s, clk, audit, calls } = sched([{ id: 'often', script: 'thought', runsAs: 'helper', every: 60 }], [T_FULL]);
  s.retryMs = [90000, 90000];                                     // the retry would come after the next period
  clk.t += 60000; await s.tick(); assert.equal(calls.length, 1);
  clk.t += 60000; await s.tick(); assert.equal(calls.length, 2, 'the next period fired');
  assert.ok(audit.some((r) => r.kind === 'trigger-skip' && /replaces the pending retry/.test(r.why)), JSON.stringify(kinds(audit)));
  clk.t += 30000; await s.tick(); assert.equal(calls.length, 2, 'the replaced retry does not fire as well');
});

test('GUARD scheduler: an ordinary failure is not retried, and a message trigger is never retried by the scheduler', async () => {
  const a = sched([{ id: 'hourly', script: 'thought', runsAs: 'helper', every: 3600 }], [{ ok: false, code: 'ACTION_ERROR', error: 'boom', labels: [] }]);
  a.clk.t += H; await a.s.tick(); a.clk.t += 30000; await a.s.tick();
  assert.equal(a.calls.length, 1); assert.ok(!kinds(a.audit).includes('trigger-retry-later'));
  const m = sched([{ id: 'inbox', script: 'reader', runsAs: 'helper', on: 'message', topic: 'notes' }], [T_FULL]);
  await m.s.tick();
  assert.ok(!kinds(m.audit).includes('trigger-retry-later'), 'its messages are still waiting: the next tick fires it again');
  await m.s.tick(); assert.equal(m.calls.length, 2, 'and it does');
});

// ---------- mailbox: why it needs no change ----------
test('GUARD mailbox: a run refused before it started claimed nothing — the message keeps all its attempts; a run that read and failed spends one', () => {
  const mb = new Mailbox({ dir: tmp('mb') });
  mb.send({ from: 'a', to: 'b', topic: 't', body: 'x', trace: 's1' });
  mb.finish('trace-refused', false);                              // what act.js does when the triggered run is refused DAEMON_FULL
  let m = mb.list('b')[0];
  assert.equal(m.status, 'new'); assert.equal(m.attempts, 0, 'a refused run spent no attempt');
  mb.read('b', 't', 'trace-ran'); mb.finish('trace-ran', false);   // a run that read it, then failed
  m = mb.list('b')[0];
  assert.equal(m.attempts, 1, 'a run that was attempted and failed spends one');
});

test('FAIL-FIRST scheduler: a DAEMON_EVICTING refusal is never the last word — once per fire it gets one more first-rung try', async () => {
  const E = { ...T_FULL, code: 'DAEMON_EVICTING' };
  const a = sched([{ id: 'hourly', script: 'thought', runsAs: 'helper', every: 3600 }], [T_FULL, T_FULL, E]);
  a.clk.t += H; await a.s.tick(); a.clk.t += 5000; await a.s.tick(); a.clk.t += 30000; await a.s.tick();   // the ladder is spent on EVICTING
  assert.ok(!kinds(a.audit).includes('trigger-lost'), 'not lost yet: ' + JSON.stringify(kinds(a.audit)));
  a.clk.t += 5000; await a.s.tick();
  assert.equal(a.calls.length, 4, 'the one extra try');
  assert.equal(a.audit.filter((r) => r.kind === 'trigger-done').pop().ok, true);
  const b = sched([{ id: 'hourly', script: 'thought', runsAs: 'helper', every: 3600 }], [T_FULL, T_FULL, E, E]);
  b.clk.t += H; await b.s.tick(); b.clk.t += 5000; await b.s.tick(); b.clk.t += 30000; await b.s.tick(); b.clk.t += 5000; await b.s.tick();
  assert.ok(kinds(b.audit).includes('trigger-lost'), 'EVICTING twice at the end: lost (the freed slot was taken) — ' + JSON.stringify(kinds(b.audit)));
  b.clk.t += 60000; await b.s.tick(); assert.equal(b.calls.length, 4, 'bounded: at most 4 tries per fire');
});

// End to end (found 6 Nov 18:20): the real bus, engine and supervisor, the real scheduler, one slot. The first fire is refused because the
// slot is BUSY; by the retry the busy daemon is IDLE but still holds the slot, so the retry is the start that evicts it — refused by design
// (0.53.3 r3) — and on the first draft of this kit the fire was LOST although the slot freed within the grace. Now that refusal is
// DAEMON_EVICTING, retried after evictMs, and the fire runs.
test('FAIL-FIRST end to end: a time trigger refused while the only slot is busy still runs — its retry evicts the idle daemon and the next try gets the slot', async () => {
  const w = world([['busy', LONG], ['tick', '(get (calc :expr "1+1") "result")']], { fuel: 100000000, daemon: { max: 1, crashLimit: 99, graceMs: 300 } });
  const clk = { t: Date.UTC(2026, 10, 6, 15) }, sa = [];
  const s = new Scheduler({ bus: { ask: (who, a, i, m) => w.bus.ask('alex', a, i, m) }, spec: { triggers: [{ id: 'tk', script: 'tick', runsAs: 'alex', every: 3600 }] },
    stateDir: tmp('s'), clock: () => clk.t, audit: (r) => sa.push(r) });
  try {
    const long = w.bus.ask('alex', 'busy', { xs: Array.from({ length: 40 }, (_, i) => String(i)) }, {});
    await sleep(200);
    clk.t += H; await s.tick();                                     // the slot is busy
    assert.equal((await long).ok, true);                            // now its daemon is idle and holds the slot
    clk.t += 5000; await s.tick();                                  // the first rung: it is the start that evicts the idle daemon
    await sleep(600);                                               // the evicted daemon exits (grace 300 ms)
    clk.t += 30000; await s.tick();                                 // the second rung gets the slot
    const trail = sa.filter((r) => /fire|done|retry|lost/.test(r.kind)).map((r) => r.kind.replace('trigger-', '') + (r.code ? ':' + r.code : '') + (r.ok ? ':ok' : ''));
    assert.ok(!trail.some((x) => x.startsWith('lost')), 'not lost: ' + trail.join(' → '));
    assert.ok(sa.some((r) => r.kind === 'trigger-done' && r.ok === true), 'the fire ran: ' + trail.join(' → '));
    assert.ok(trail.includes('done:DAEMON_EVICTING'), 'the evicting refusal is named: ' + trail.join(' → '));
  } finally { w.engine.close(); }
});

// End to end, the ladder from second-reader review, round 1 (found 6 Nov 18:35): the busy run OUTLASTS the first rung, so the 30 s retry is the evicting start. With the
// ladder alone (5 s, 30 s, lost) that fire was LOST — measured: FULL → FULL → EVICTING → lost. The one extra try for EVICTING runs it.
test('FAIL-FIRST end to end: a busy run that outlasts the first rung — the 30 s retry evicts, and the fire still runs', async () => {
  const w = world([['busy', LONG], ['tick', '(get (calc :expr "1+1") "result")']], { fuel: 100000000, daemon: { max: 1, crashLimit: 99, graceMs: 300 } });
  const clk = { t: Date.UTC(2026, 10, 6, 15) }, sa = [];
  const s = new Scheduler({ bus: { ask: (who, a, i, m) => w.bus.ask('alex', a, i, m) }, spec: { triggers: [{ id: 'tk', script: 'tick', runsAs: 'alex', every: 3600 }] },
    stateDir: tmp('s'), clock: () => clk.t, audit: (r) => sa.push(r) });
  try {
    const long = w.bus.ask('alex', 'busy', { xs: XS }, {});
    await sleep(200);
    clk.t += H; await s.tick();                                     // try 1: busy
    clk.t += 5000; await s.tick();                                  // try 2: still busy
    assert.equal((await long).ok, true);                            // the busy run ends; its daemon idles, holding the slot
    clk.t += 30000; await s.tick(); await sleep(600);               // try 3: the evicting start
    clk.t += 5000; await s.tick();                                  // try 4: the one extra try
    const trail = sa.filter((r) => /fire|done|retry|lost/.test(r.kind)).map((r) => r.kind.replace('trigger-', '') + (r.code ? ':' + r.code : '') + (r.ok ? ':ok' : ''));
    assert.ok(!trail.some((x) => x.startsWith('lost')), 'not lost: ' + trail.join(' → '));
    assert.ok(sa.some((r) => r.kind === 'trigger-done' && r.ok === true), 'the fire ran: ' + trail.join(' → '));
  } finally { w.engine.close(); }
});

// Second-reader review, round 1, note: an EUser client gets the same hint the scheduler has — 503 with Retry-After: 5 — on the edge AND on act.js's /api/act.
test('FAIL-FIRST HTTP: a transient refusal answers 503 with Retry-After: 5 — on the edge and through act.js', async () => {
  const http = require('http');
  const { createEdge } = require(path.join(ROOT, 'core/edge'));
  const reply = { ok: false, code: 'DAEMON_FULL', transient: true, error: 'all 8 script daemons are busy', labels: [] };
  const srv = http.createServer(createEdge({ bus: { ask: async () => reply }, resolveKey: () => 'bot' }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch('http://127.0.0.1:' + srv.address().port + '/act', { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'calc', input: {} }) });
    assert.equal(r.status, 503); assert.equal(r.headers.get('retry-after'), '5', 'the edge sends Retry-After');
    const plain = { ok: false, code: 'ACTION_ERROR', error: 'x', labels: [] }; reply.code = plain.code; delete reply.transient;
    const r2 = await fetch('http://127.0.0.1:' + srv.address().port + '/act', { method: 'POST', headers: { authorization: 'Bearer k' }, body: JSON.stringify({ action: 'calc', input: {} }) });
    assert.equal(r2.headers.get('retry-after'), null, 'not on an ordinary failure');
  } finally { srv.close(); }
  // act.js's /api/act: the real route, its bus stubbed to refuse transiently
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
  const A = actmod.create({ prisma, models: { isInstalled: () => false }, modelUrl: 'http://127.0.0.1:1', appDir: tmp('app'), log: { error() {} }, actionsDir });
  try {
    A.bus.ask = async () => ({ ok: false, code: 'DAEMON_PAUSED', transient: true, error: 'paused', labels: [] });
    const headers = {};
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { headers[k] = v; return this; } };
    await A.route({ euser: BOT, body: { action: 'calc', input: { expr: '1' } } }, res);
    assert.equal(res.code, 503, JSON.stringify(res.body)); assert.equal(headers['Retry-After'], '5', 'act.js sends Retry-After');
  } finally { if (A.stop) A.stop(); }
});
