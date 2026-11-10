// daemon.test.js — v1.0.2 · tests: scripts in a separate daemon process · changelog: act/CHANGELOG.md#acttestdaemontestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// slice 3 step 1: PROTEUS-K scripts in a SEPARATE daemon process (act/daemon/pkd.js + supervisor.js,
// engine 1.3.0). Every test FAILS on engine 1.2.2 (no daemon). Run: node --test test/daemon.test.js
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
const { Supervisor, permissionFlags } = require(path.join(ROOT, 'daemon/supervisor'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');   // 0.53.2: shipped built-ins only — an installed script (staging: scout) is not part of this test
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'pkd-' + t + '-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// scripts: [[name, src, extra]] · grants: what each script identity may call · daemon: Supervisor options, or false for in-process
function world(scripts, { grants = ['calc'], daemon = {}, fuel } = {}) {
  const dir = tmp('act'), box = tmp('box');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  const spec = [...SPEC];
  for (const [name, src, extra] of scripts) {
    fs.writeFileSync(path.join(dir, name + '.pk'), src);
    spec.push({ name, version: '1.0.0', kind: 'script', file: name + '.pk', produces: 'computed', world: false, runsAs: name, needs: [], input: { xs: 'array?', x: 'string?' }, acceptWarnings: true, ...(extra || {}) });
  }
  const actions = spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) }));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions }));
  const audit = [];
  const sup = daemon === false ? false : new Supervisor({ audit: (r) => audit.push(r), ...daemon });
  const engine = createEngine({ stateRoot: box, audit: (r) => audit.push(r), daemon: sup, fuel });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const g = {}; for (const a of grants) g[a] = {}; for (const [n] of scripts) g[n] = {};   // a script identity must hold its own script
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: { calc: {}, ...Object.fromEntries(scripts.map(([n]) => [n, {}])) } },
    ...scripts.map(([name]) => ({ name, kind: 'script', owner: 'alex', actions: g }))]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), fetch: async () => ({ status: 404, text: async () => '' }), filesRoot: box, audit: (l) => audit.push(JSON.parse(l)) });
  return { bus, audit, box, engine, sup };
}
const ask = (w, a, input = {}) => w.bus.ask('alex', a, input, {});
const LONG = '(for-each (a (input xs)) (for-each (b (input xs)) (for-each (c (input xs)) (+ (number a) (number b) (number c)))))';
const XS = Array.from({ length: 100 }, (_, i) => String(i));

test('daemon: a script runs in a separate process — same answer, labels and state as in-process', async () => {
  const src = '(do (remember n (+ 1 (or (remembered n) 0))) (get (calc :expr "2+3") "result"))';
  const d = world([['s', src]]), p = world([['s', src]], { daemon: false });
  try {
    for (let i = 0; i < 2; i++) {
      const a = await ask(d, 's'), b = await ask(p, 's');
      assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.value, b.value); assert.deepEqual(a.labels, b.labels);
    }
    const pid = d.sup.pidOf('s');
    assert.ok(Number.isInteger(pid) && pid !== process.pid, 'it ran in another process: pid ' + pid);
    const st = (w) => JSON.parse(fs.readFileSync(path.join(w.box, '.pk-state', 's-s', 'state.json'), 'utf8')).keys.n;
    assert.deepEqual(st(d), st(p), 'the core wrote the same state');
    assert.ok(d.audit.some((r) => r.kind === 'daemon-start' && r.identity === 's'));
  } finally { d.engine.close(); }
});

test('daemon: killed mid-run — that run fails, the server keeps answering, the next run gets a fresh daemon', async () => {
  const w = world([['long', LONG], ['quick', '(get (calc :expr "1+1") "result")']], { fuel: 100000000, daemon: { crashLimit: 99 } });
  try {
    const running = ask(w, 'long', { xs: XS });
    await sleep(400);
    const pid = w.sup.pidOf('long'); assert.ok(pid, 'the daemon is up');
    process.kill(pid, 'SIGKILL');
    const r = await running;
    assert.equal(r.ok, false); assert.match(r.error, /daemon exited during the run/);
    assert.equal((await w.bus.ask('alex', 'calc', { expr: '6*7' })).value.result, '42', 'the core still answers');
    w.sup.backoffMs = () => 0;                                         // skip the 1 s back-off in this test
    const again = await ask(w, 'long', { xs: ['1'] });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.notEqual(w.sup.pidOf('long'), pid, 'a fresh daemon');
    assert.ok(w.audit.some((x) => x.kind === 'daemon-crash' && x.identity === 'long'));
  } finally { w.engine.close(); }
});

test('daemon: a run over its time limit is stopped — the daemon is killed, not left running', async () => {
  const w = world([['slow', LONG, { timeoutMs: 400 }]], { fuel: 100000000, daemon: { crashLimit: 99 } });
  try {
    const r = await ask(w, 'slow', { xs: XS });
    assert.equal(r.ok, false); assert.equal(r.code, 'TIMEOUT', JSON.stringify(r));
    await sleep(300);
    assert.equal(w.sup.pidOf('slow'), null, 'the stuck daemon is gone');
    assert.ok(w.audit.some((x) => x.kind === 'daemon-crash' && /killed after 400 ms/.test(x.why)));
  } finally { w.engine.close(); }
});

test('daemon: repeated crashes PAUSE the identity (no restart storm)', async () => {
  let T = 1e12;
  const w = world([['long', LONG]], { fuel: 100000000, daemon: { crashLimit: 2, now: () => T } });
  try {
    for (let i = 0; i < 2; i++) {
      const running = ask(w, 'long', { xs: XS }); await sleep(300);
      process.kill(w.sup.pidOf('long'), 'SIGKILL'); await running; T += 120000;   // past the back-off
    }
    const r = await ask(w, 'long', { xs: ['1'] });
    assert.equal(r.ok, false); assert.match(r.error, /paused after 2 crashes/);
    assert.ok(w.audit.some((x) => x.kind === 'daemon-paused' && x.identity === 'long'));
  } finally { w.engine.close(); }
});

test('daemon: a forged message about another run is dropped; a call it sends is checked by the bus as the script itself', async () => {
  const fdir = tmp('fake'), fake = path.join(fdir, 'fake.js');
  fs.writeFileSync(fake, `let rid; process.on('message', (m) => {
    if (m.t === 'run') { rid = m.runId;
      process.send({ t: 'call', runId: m.runId + 999, callId: 7, action: 'calc', input: { expr: '1' }, labels: [], ctl: [] });
      process.send({ t: 'call', runId: m.runId, callId: 8, action: 'file-append', input: { name: 'x.txt', text: 'pwned' }, labels: [], ctl: [] });
    } else if (m.t === 'reply') process.send({ t: 'done', runId: rid, ok: true, value: String(m.reply.code || m.reply.ok), labels: ['person'], seen: [] });
  });
  process.send({ t: 'ready', pid: process.pid, permission: !!process.permission });`);
  const w = world([['s', '(get (calc :expr "1") "result")']], { daemon: { daemonPath: fake, allowRead: fdir } });
  try {
    const r = await ask(w, 's');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.value, 'NOT_PERMITTED', 'the bus refused file-append: the script identity holds only calc');
    assert.ok(w.audit.some((x) => x.kind === 'daemon-dropped'), 'the message about another run was dropped and audited');
    assert.equal(fs.existsSync(path.join(w.box, 's', 'x.txt')), false);
  } finally { w.engine.close(); }
});

test('daemon: it runs under the permission model — it cannot read a file outside its own code', async (t) => {
  if (!permissionFlags('/x')) return t.skip('this Node has no permission model');
  const fdir = tmp('fake'), other = tmp('other'), fake = path.join(fdir, 'fake.js');
  fs.writeFileSync(path.join(other, 'secret.txt'), 'secret');
  fs.writeFileSync(fake, `const fs = require('fs');
  process.on('message', (m) => { if (m.t !== 'run') return; let v; try { fs.readFileSync(${JSON.stringify(path.join(other, 'secret.txt'))}, 'utf8'); v = 'READ'; } catch (e) { v = 'DENIED ' + e.code; }
    process.send({ t: 'done', runId: m.runId, ok: true, value: v, labels: ['person'], seen: [] }); });
  process.send({ t: 'ready', pid: process.pid, permission: !!process.permission });`);
  const w = world([['s', '"x"']], { daemon: { daemonPath: fake, allowRead: fdir } });
  try {
    const r = await ask(w, 's');
    assert.match(r.value, /^DENIED/, JSON.stringify(r));
    assert.ok(w.audit.some((x) => x.kind === 'daemon-start' && x.permission === true));
  } finally { w.engine.close(); }
});

test('daemon: a too-large remembered value fails the script in the daemon exactly as in-process; nothing is written', async () => {
  const src = '(remember big (str ' + Array(50).fill('"' + 'x'.repeat(100) + '"').join(' ') + '))';
  const d = world([['s', src]]), p = world([['s', src]], { daemon: false });
  try {
    const a = await ask(d, 's'), b = await ask(p, 's');
    assert.equal(a.ok, false); assert.equal(a.error, b.error);
    assert.match(a.error, /larger than 4096 bytes/);
    assert.equal(fs.existsSync(path.join(d.box, '.pk-state', 's-s', 'state.json')), false);
  } finally { d.engine.close(); }
});

// 1.0.1 (061126, lab suite 7): the cap under CONCURRENT starts. spawn is stubbed (nothing forks; the daemons never get ready),
// so this tests only the supervisor's own bookkeeping — the real path is lab d1-cap.
function stubbed(opts) {
  const s = new Supervisor({ audit: () => {}, ...opts }), log = { spawned: [], killed: [] };
  s.spawn = function (id) {
    log.spawned.push(id);
    const x = { child: { kill: () => log.killed.push(id), connected: true, send() {} }, busy: null, idle: null, lastUsed: Date.now(), ready: new Promise(() => {}) };
    this.d.set(id, x); return x;
  };
  return { s, log };
}
test('daemon: the cap holds when runs for different identities start in the same turn', async () => {
  const { s, log } = stubbed({ max: 2 });
  const errs = [], codes = [];
  for (const id of ['a', 'b', 'c']) {
    s.run(id, {}, {}).catch((e) => { errs.push(id + ': ' + e.message); codes.push(e.code); });
    assert.ok(s.d.size <= 2, 'the cap holds after starting ' + id + ' (slots ' + s.d.size + ')');   // second-reader review, round 1: at every step, not only at the end
  }
  await sleep(50);
  assert.ok(s.d.size <= 2);
  assert.deepEqual(log.spawned, ['a', 'b']);
  assert.equal(s.d.size, 2);
  assert.deepEqual(errs, ['c: all 2 script daemons are busy — try again shortly']);
  assert.deepEqual(codes, ['DAEMON_FULL']);
  s.close();
});
test('daemon: a daemon that is still starting is not evicted to make room', async () => {
  const { s, log } = stubbed({ max: 1 });
  const errs = [];
  s.run('a', {}, {}).catch((e) => errs.push('a: ' + e.message));
  await sleep(20);
  s.run('b', {}, {}).catch((e) => errs.push('b: ' + e.message));
  await sleep(20);
  assert.deepEqual(log.killed, []);
  assert.deepEqual(log.spawned, ['a']);
  assert.deepEqual(errs, ['b: all 1 script daemons are busy — try again shortly']);
  s.close();
});

// Second-reader review, round 1 (061126): a same-identity concurrent run is a REFUSAL, not a crash — coded, audited, and the breaker never counts it,
// so defence in depth can never pause a healthy daemon. Six refusals with crashLimit 5: not paused, no crash recorded.
// WHY THE 50 ms RACE BELOW: the stubbed daemon never becomes ready, so on code without the overlap check the second run waits forever, the
// event loop drains, and node:test CANCELS the test instead of failing it (it also takes the next test down). Racing each run against 50 ms
// turns that hang into a plain assertion failure ("NO ANSWER"). Do not "simplify" it to a bare await.
test('daemon: a same-identity overlap is refused DAEMON_OVERLAP, audited, and never counts toward the crash breaker', async () => {
  const audit = [];
  const { s } = stubbed({ max: 2, crashLimit: 5, audit: (r) => audit.push(r) });
  s.run('a', {}, {}).catch(() => {});
  const codes = [];
  // raced against 50 ms: on supervisor 1.0.2 an overlapping run is NOT refused — it waits on the first one's start (a hang, not an answer)
  for (let i = 0; i < 6; i++) codes.push(await Promise.race([s.run('a', {}, {}).then(() => 'RAN', (e) => e.code), sleep(50).then(() => 'NO ANSWER (waited on the other run)')]));
  assert.deepEqual(codes, Array(6).fill('DAEMON_OVERLAP'));
  assert.equal(audit.filter((r) => r.kind === 'daemon-busy' && r.code === 'DAEMON_OVERLAP' && r.identity === 'a').length, 6, 'each refusal is audited');
  assert.equal(audit.filter((r) => r.kind === 'daemon-crash').length, 0, 'no refusal is a crash');
  assert.equal((s.crashes.get('a') || []).length, 0);
  assert.equal(s.paused.size, 0, 'six refusals with crashLimit 5: the identity is NOT paused');
  assert.equal(s.backoffMs('a'), 0, 'and no back-off either');
  s.close();
});

// Second-reader review, round 1 (061126): the cap with REAL forks through the bus (the path lab d1-cap measures): max 2, three script identities
// start together. Sampled every 10 ms while they run: never more than 2 daemons in the supervisor, never more than 2 child processes alive.
test('daemon: the cap holds with real forks — max 2, three identities, ≤ 2 daemons and ≤ 2 child processes throughout', async () => {
  const w = world([['p1', LONG], ['p2', LONG], ['p3', LONG]], { fuel: 100000000, daemon: { max: 2, crashLimit: 99 } });
  const pids = [], orig = w.sup.spawn.bind(w.sup);
  w.sup.spawn = (id) => { const x = orig(id); pids.push(x.child.pid); return x; };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let maxSlots = 0, maxAlive = 0;
  const runs = ['p1', 'p2', 'p3'].map((n) => ask(w, n, { xs: XS }));
  try {
    for (let i = 0; i < 60; i++) {
      maxSlots = Math.max(maxSlots, w.sup.d.size);
      maxAlive = Math.max(maxAlive, pids.filter(alive).length);
      await sleep(10);
    }
    w.engine.close();                                              // stops the LONG runs; the refused one has already answered
    const done = await Promise.all(runs);
    assert.ok(maxSlots <= 2, 'the supervisor never held more than 2 daemons (max seen ' + maxSlots + ')');
    assert.ok(maxAlive <= 2, 'never more than 2 child processes alive (max seen ' + maxAlive + ')');
    assert.ok(pids.length <= 2, 'at most 2 daemons were ever forked (forked ' + pids.length + ')');
    assert.ok(w.audit.some((r) => r.kind === 'daemon-busy' && r.code === 'DAEMON_FULL'), 'the third start was refused DAEMON_FULL and audited');
    assert.equal(done.filter((r) => r.ok === false && /all 2 script daemons are busy/.test(r.error || '')).length, 1, 'exactly one run was refused by the cap: ' + JSON.stringify(done.map((r) => r.error || r.value)));
  } finally { w.engine.close(); }
});

// Second-reader review, round 2 (061126): termination is GUARANTEED and the cap is a hard PROCESS bound. Every stop — eviction, idle stop, timeout — keeps the
// daemon's slot until its process exits, and a daemon that ignores SIGTERM is SIGKILLed after the grace. The stand-in daemons below are real
// child processes that ignore SIGTERM (as run B's did); the finally blocks SIGKILL whatever they forked, so even old code leaks nothing.
const slotsOf = (s) => s.d.size + (s.dying ? s.dying.size : 0);
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const CTX = { send: async () => ({ ok: false, code: 'NOT_PERMITTED', error: 'test', labels: [] }), stateSet() {} };
function stubborn(answers) {
  const fdir = tmp('stubborn'), fake = path.join(fdir, 'fake.js');
  fs.writeFileSync(fake, `process.on('SIGTERM', () => {});   // ignores SIGTERM
  process.on('message', (m) => { if (m.t === 'run' && ${answers ? 'true' : 'false'}) process.send({ t: 'done', runId: m.runId, ok: true, value: 'x', labels: ['person'], seen: [] }); });
  process.send({ t: 'ready', pid: process.pid, permission: !!process.permission });`);
  return { daemonPath: fake, allowRead: fdir };
}
function tracked(opts) {
  const audit = [], pids = [];
  const s = new Supervisor({ audit: (r) => audit.push(r), ...opts });
  const orig = s.spawn.bind(s); s.spawn = (id) => { const x = orig(id); pids.push(x.child.pid); return x; };
  return { s, audit, pids, cleanup() { s.close(); for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } } };
}

test('daemon: an EVICTED daemon keeps its slot until its process exits; one that ignores SIGTERM is SIGKILLed after the grace', async () => {
  const w = tracked({ max: 1, graceMs: 300, idleMs: 60000, ...stubborn(true) });
  try {
    assert.equal((await w.s.run('a', {}, CTX)).value, 'x');             // a is now idle
    const pa = w.pids[0];
    assert.equal(await w.s.run('b', {}, CTX).then(() => 'RAN', (e) => e.code), 'DAEMON_EVICTING', 'the start that evicts is refused: the slot is not free yet (0.53.4: its own code — was DAEMON_FULL in 0.53.3)');
    assert.equal(slotsOf(w.s), 1, 'the evicted daemon still holds its slot');
    await sleep(150);
    assert.ok(isAlive(pa), 'it ignores SIGTERM: alive inside the grace');
    assert.equal(await w.s.run('b', {}, CTX).then(() => 'RAN', (e) => e.code), 'DAEMON_FULL', 'during the grace the slot is still taken');
    assert.ok(w.pids.filter(isAlive).length <= 1, 'never more than max processes');
    await sleep(450);
    assert.equal(isAlive(pa), false, 'SIGKILLed after the grace');
    assert.equal(slotsOf(w.s), 0, 'its exit freed the slot');
    const stop = w.audit.find((r) => r.kind === 'daemon-stop' && r.identity === 'a');
    assert.ok(stop && stop.how === 'kill' && stop.why === 'evict', 'the stop is audited with how it died: ' + JSON.stringify(stop));
    assert.ok(w.audit.some((r) => r.kind === 'daemon-kill' && r.identity === 'a'));
    assert.equal((await w.s.run('b', {}, CTX)).value, 'x', 'now b gets the slot');
  } finally { w.cleanup(); }
});

test('daemon: an IDLE-STOPPED daemon that ignores SIGTERM keeps its slot and is SIGKILLed after the grace', async () => {
  const w = tracked({ max: 1, graceMs: 300, idleMs: 100, ...stubborn(true) });
  try {
    assert.equal((await w.s.run('a', {}, CTX)).value, 'x');
    const pa = w.pids[0];
    await sleep(200);                                                   // idle stop at 100 ms; grace until 400 ms
    assert.ok(w.audit.some((r) => r.kind === 'daemon-idle-stop' && r.identity === 'a'));
    assert.ok(isAlive(pa) && slotsOf(w.s) === 1, 'inside the grace: alive and still holding its slot');
    assert.equal(await w.s.run('b', {}, CTX).then(() => 'RAN', (e) => e.code), 'DAEMON_FULL');
    await sleep(450);
    assert.equal(isAlive(pa), false, 'SIGKILLed after the grace — no leak');
    assert.equal(slotsOf(w.s), 0);
    const stop = w.audit.find((r) => r.kind === 'daemon-stop' && r.identity === 'a');
    assert.ok(stop && stop.how === 'kill' && stop.why === 'idle', JSON.stringify(stop));
  } finally { w.cleanup(); }
});

test('daemon: a TIMED-OUT daemon is SIGKILLed and keeps its slot until its process has exited', async () => {
  const w = tracked({ max: 1, timeoutMs: 200, crashLimit: 99, ...stubborn(false) });
  try {
    const code = await w.s.run('a', {}, CTX).then(() => 'RAN', (e) => /^TIMEOUT/.test(e.message) ? 'TIMEOUT' : e.message);
    assert.equal(code, 'TIMEOUT');
    assert.equal(slotsOf(w.s), 1, 'at the moment of the timeout the slot is still held (the exit has not been seen yet)');
    await sleep(200);
    assert.equal(isAlive(w.pids[0]), false, 'SIGKILL — it cannot ignore that');
    assert.equal(slotsOf(w.s), 0, 'freed by its exit');
    const stop = w.audit.find((r) => r.kind === 'daemon-stop' && r.identity === 'a');
    assert.ok(stop && stop.how === 'kill' && stop.why === 'timeout', JSON.stringify(stop));
  } finally { w.cleanup(); }
});
