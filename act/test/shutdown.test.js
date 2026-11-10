// shutdown.test.js — v1.1.0 · tests: the stop path stops every script daemon first · changelog: act/CHANGELOG.md#acttestshutdowntestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// the server's stop path stops every script daemon FIRST.
// FAIL-FIRST tests fail on 0.53.4 (no act/shutdown.js, server.js has no handler). The real-process tests run test/shutdown-harness.js — a
// stand-in for server.js with a REAL bus, engine, supervisor and one REAL pkd daemon in the middle of a long run — and stop it as the box does.
// Measured on the VM before writing them: without a handler that daemon outlived its server by 3.9 s; with it, 8 ms.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const HARNESS = path.join(__dirname, 'shutdown-harness.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const WITHIN_MS = 500;                                            // the bound under test: well under the 3.9 s window it replaces

function start(mode, how) {
  const child = cp.spawn(process.execPath, [HARNESS, mode, how], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  const info = new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; const i = buf.indexOf('\n'); if (i >= 0) { try { resolve(JSON.parse(buf.slice(0, i))); } catch (e) { reject(e); } } });
    exited.then(({ code, signal }) => reject(new Error('the harness ended before it was ready (code ' + code + ', signal ' + signal + '): ' + err.slice(0, 300))));
  });
  const cleanup = (pids = []) => {
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    for (const p of pids) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    info.then((j) => { for (const d of j.dirs || []) if (String(d).startsWith(require('os').tmpdir())) fs.rmSync(d, { recursive: true, force: true }); }, () => {});
  };
  return { child, info, exited, cleanup };
}
const DIES_MS = 5000;                                            // a server that does not die is a failure, not a hang
const ended = (h) => Promise.race([h.exited, sleep(DIES_MS).then(() => ({ code: 'STILL RUNNING after ' + DIES_MS + ' ms', signal: null }))]);
async function goneWithin(pids, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 <= ms) { if (!pids.some(alive)) return Date.now() - t0; await sleep(5); }
  return null;
}

for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test('FAIL-FIRST ' + sig + ': the server stops every script daemon first — a busy daemon is gone within ' + WITHIN_MS + ' ms, and the server still dies of ' + sig, async () => {
    const h = start('with', 'wait'); let pids = [];
    try {
      const j = await h.info; pids = j.daemons;
      assert.equal(pids.length, 1, 'one real daemon was forked');
      await sleep(300);                                           // the daemon is in the middle of its run
      assert.ok(pids.every(alive), 'the daemon is alive and running before the signal');
      h.child.kill(sig);
      const end = await ended(h);
      assert.equal(end.signal, sig, 'the server died of ' + sig + ' as before (code ' + end.code + ', signal ' + end.signal + ') — the watchdog, npm and launchd see no change');
      const ms = await goneWithin(pids, WITHIN_MS);
      assert.notEqual(ms, null, 'the busy daemon was still alive ' + WITHIN_MS + ' ms after the server died');
    } finally { h.cleanup(pids); }
  });
}

test('FAIL-FIRST process.exit: the daemons are stopped on the way out (the exit code is unchanged)', async () => {
  const h = start('with', 'exit'); let pids = [];
  try {
    const j = await h.info; pids = j.daemons;
    const end = await ended(h);
    assert.equal(end.code, 3, 'the harness exited with its own code');
    assert.notEqual(await goneWithin(pids, WITHIN_MS), null, 'the busy daemon outlived process.exit');
  } finally { h.cleanup(pids); }
});

test('FAIL-FIRST uncaught exception: the daemons are stopped on the way out', async () => {
  const h = start('with', 'throw'); let pids = [];
  try {
    const j = await h.info; pids = j.daemons;
    const end = await ended(h);
    assert.notEqual(end.code, 0, 'the harness died of the exception (code ' + end.code + ')');
    assert.notEqual(await goneWithin(pids, WITHIN_MS), null, 'the busy daemon outlived the crash');
  } finally { h.cleanup(pids); }
});

test('GUARD the window is real: WITHOUT the handler a busy daemon outlives a SIGTERMed server (what 0.53.5 closes)', async () => {
  const h = start('without', 'wait'); let pids = [];
  try {
    const j = await h.info; pids = j.daemons;
    await sleep(300);
    h.child.kill('SIGTERM');
    const end = await ended(h);
    assert.equal(end.signal, 'SIGTERM');
    assert.equal(await goneWithin(pids, WITHIN_MS), null, 'without the handler the daemon died within ' + WITHIN_MS + ' ms — this test can no longer see the window');
  } finally { h.cleanup(pids); }
});

// the unit: a stand-in process object, nothing is killed
function fakeProc() {
  const on = {}, kills = [];
  return { pid: 4242, kills, on: (e, f) => { (on[e] = on[e] || []).push(f); }, removeListener: (e, f) => { on[e] = (on[e] || []).filter((g) => g !== f); },
    emit: (e) => { for (const f of [...(on[e] || [])]) f(); }, count: (e) => (on[e] || []).length, kill: (pid, sig) => kills.push([pid, sig]) };
}
test('FAIL-FIRST unit: stop() runs once (the signal, then exit); the listener is closed; the same signal is raised again with no handler left', () => {
  const { installShutdown } = require(path.join(ROOT, 'shutdown'));
  const p = fakeProc(); let stops = 0, closed = 0;
  const server = { listening: true, close() { closed++; this.listening = false; } };
  const s = installShutdown({ stop: () => { stops++; }, server, proc: p, log: { log() {}, error() {} } });
  assert.equal(p.count('SIGTERM'), 1); assert.equal(p.count('SIGINT'), 1); assert.equal(p.count('SIGHUP'), 1); assert.equal(p.count('exit'), 1);
  p.emit('SIGTERM');
  assert.equal(stops, 1, 'stopped on the signal'); assert.equal(closed, 1, 'the listener was closed');
  assert.deepEqual(p.kills, [[4242, 'SIGTERM']], 'the same signal was raised again, at itself');
  assert.equal(p.count('SIGTERM'), 0, 'its SIGTERM handler was removed first'); assert.equal(p.count('SIGINT'), 0, 'and its SIGINT handler'); assert.equal(p.count('SIGHUP'), 0, 'and its SIGHUP handler');
  p.emit('exit');
  assert.equal(stops, 1, 'exit after the signal does not stop twice'); assert.equal(s.signalled, 'SIGTERM'); assert.equal(s.stopped, true);
});
test('FAIL-FIRST unit: a stop() that throws is logged, and the stop goes on (the listener, given as a getter, is closed; the signal raised)', () => {
  const { installShutdown } = require(path.join(ROOT, 'shutdown'));
  const p = fakeProc(), errs = []; let closed = 0;
  const srv = { listening: true, close() { closed++; } };
  installShutdown({ stop: () => { throw new Error('boom'); }, server: () => srv, proc: p, log: { log() {}, error: (m) => errs.push(m) } });   // the server as a getter, as server.js passes it
  p.emit('SIGINT');
  assert.equal(errs.length, 1); assert.match(errs[0], /boom/);
  assert.equal(closed, 1); assert.deepEqual(p.kills, [[4242, 'SIGINT']]);
  assert.throws(() => installShutdown({ proc: fakeProc() }), TypeError, 'stop() is required');
});

test('FAIL-FIRST unit: a signal BEFORE act or the server exists (a real ReferenceError) is logged, and the signal is still raised again', () => {
  const { installShutdown } = require(path.join(ROOT, 'shutdown'));
  const p = fakeProc(), errs = [];
  // as server.js wires it — late-bound — but called before the two consts below have been reached (their temporal dead zone)
  installShutdown({ stop: () => act.stop(), server: () => server, proc: p, log: { log() {}, error: (m) => errs.push(m) } });
  p.emit('SIGHUP');
  assert.equal(errs.length, 1, 'one line logged'); assert.match(errs[0], /not created yet/, 'and it says the core was not created yet: ' + errs[0]);
  assert.deepEqual(p.kills, [[4242, 'SIGHUP']], 'the signal was still raised again, so the process dies of it as before');
  assert.equal(p.count('SIGHUP') + p.count('SIGTERM') + p.count('SIGINT'), 0, 'all three handlers removed first');
  const act = { stop() { throw new Error('never called'); } }, server = null;   // eslint-disable-line no-unused-vars
});

test('FAIL-FIRST server.js wires it: installShutdown late-bound, right after act is created and before the server listens', () => {
  const src = fs.readFileSync(path.join(ROOT, '..', 'server.js'), 'utf8');
  const actMade = src.indexOf("const act = require('./act').create(");
  const wired = src.indexOf("require('./act/shutdown').installShutdown({ stop: () => act.stop(), server: () => server });");
  const listen = src.indexOf('server.listen(PORT');
  assert.ok(actMade > 0, 'server.js creates act as expected'); assert.ok(wired > 0, 'server.js wires installShutdown, late-bound');
  assert.ok(actMade < wired && wired < listen, 'wired after act is created and before the server listens');
  assert.equal(src.split("installShutdown(").length - 1, 1, 'wired exactly once');
  assert.ok(src.includes("console.log('[shutdown] SIGTERM / SIGINT / SIGHUP stop every script daemon first, then the server (act/shutdown.js)');"), 'server.js says so at start (the promote checks the new server printed it)');
  assert.ok(/^\s*function stop\(\) \{ clearInterval\(mbTimer\);.*engine\.close\(\); \}/m.test(fs.readFileSync(path.join(ROOT, '..', 'act.js'), 'utf8')), "act.stop() still ends in engine.close() (the supervisor's synchronous SIGKILL)");
});
