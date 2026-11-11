// supervisor.js — v1.1.0 · starts, bounds and stops one script daemon per script identity · changelog: act/CHANGELOG.md#actdaemonsupervisorjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// runs PROTEUS-K scripts in separate daemons (pkd.js), one per script identity (slice 3: ACTBUS docs/capability-architecture.md §7 item 3)
// The core keeps every decision: a daemon's action calls go through the bus as the script's own identity (same grants, labels,
// audit), its state writes go to the core's state file, and its answer is just a message. The supervisor only manages processes:
//   · one daemon per identity, started when that identity's first run is due, stopped after idleMs without a run (default 10 min);
//   · at most `max` daemons (default 8): an idle one is stopped to make room; if all are busy the run is refused;
//   · limits the core enforces: a time limit per run (the daemon is KILLED if it overstays — the only way to stop a stuck process),
//     a memory cap per daemon (--max-old-space-size, default 256 MB), and Node's permission model (it may read only its own code; on
//     Node 22 the permission model does NOT cover the network — the daemon has no network code and no secrets, see H1);
//   · a daemon that dies mid-run fails that run ("daemon exited"); the next run starts a fresh one after a back-off of 1 s, 2 s, 4 s …
//     up to 60 s; `crashLimit` crashes or kills (default 5) within crashWindowMs (default 10 min) PAUSE that identity until the
//     process starts again — a new Supervisor (no restart storm);
//   · a message from a daemon about a run it is not running is dropped and audited.
// run(identity, job, ctx) → { value, labels, seen }   ·   throws Error (message 'CODE: …' for script errors, with .labels)
//   job = { src64, actions, input, inputLabels, ctl, fuel, state:{keys, absent}, timeoutMs }
//   ctx = { send(action, input, meta) → Promise<reply>, stateSet(key, value, labels) }   (stateSet may throw: the run then fails)
'use strict';
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const { productName: checkProduct } = require('../core/product');

const ACT_DIR = path.join(__dirname, '..');
// 1.0.4: a refusal of a run that was never attempted — the class the bus, the scheduler and the mailbox treat as "not a failure"
const TRANSIENT = Object.freeze(['DAEMON_FULL', 'DAEMON_EVICTING', 'DAEMON_OVERLAP', 'DAEMON_PAUSED', 'DAEMON_RESTARTING']);
const transient = (code, message) => { const e = new Error(message); e.code = code; e.transient = true; return e; };
const PKD = path.join(__dirname, 'pkd.js');

// 1.0.2: the permission model checks REAL paths, and resolving a symlinked path is itself refused — so the daemon is started by the
// real path of its file and allowed the real paths of its folders
const realPath = (d) => { try { return fs.realpathSync(d); } catch { return d; } };
function permissionFlags(allowRead) {
  const f = process.allowedNodeEnvironmentFlags;
  const dirs = [...new Set([].concat(allowRead).flatMap((d) => [d, realPath(d)]))].map((d) => '--allow-fs-read=' + d);
  if (f.has('--permission')) return ['--permission', ...dirs];
  if (f.has('--experimental-permission')) return ['--experimental-permission', ...dirs];
  return null;                                                   // reported as permission:false in every spawn audit line
}

class Supervisor {
  constructor({ max = 8, idleMs = 600000, timeoutMs = 300000, heapMb = 256, crashLimit = 5, crashWindowMs = 600000,
    audit = () => {}, daemonPath = PKD, allowRead = ACT_DIR, now = () => Date.now(), graceMs = 2000, productName } = {}) {
    Object.assign(this, { max, idleMs, timeoutMs, heapMb, crashLimit, crashWindowMs, audit, daemonPath, allowRead, now, graceMs });
    this.product = checkProduct(productName);   // 1.1.0 (v0.53.6): named in the DAEMON_PAUSED message
    this.d = new Map();                                          // identity → { child, ready, busy, idle, lastUsed }
    this.dying = new Set();                                      // 1.0.3 (second-reader review, round 2): stopped daemons whose process has not exited yet — they keep their slot
    this.crashes = new Map();                                    // identity → [times]
    this.paused = new Set();
    this.seq = 0;
    this.closed = false;
  }
  log(kind, identity, extra = {}) { try { this.audit({ kind: 'daemon-' + kind, identity, ...extra }); } catch { /* audit is best effort here */ } }
  refuseBusy(code, identity, message) {                              // 1.0.3 (second-reader review, round 1): a cap refusal — coded, audited, and NOT a crash (the breaker never sees it)
    this.log('busy', identity, { code, max: this.max, slots: this.d.size });
    return transient(code, message);
  }
  status() { return { daemons: [...this.d.entries()].map(([id, x]) => ({ identity: id, pid: x.child.pid, busy: !!x.busy })), dying: [...this.dying].map((x) => ({ identity: x.identity, pid: x.child.pid, why: x.dying })), paused: [...this.paused] }; }
  slots() { return this.d.size + this.dying.size; }               // 1.0.3 (second-reader review, round 2): what the cap counts — live daemons AND daemons still dying
  // 1.0.3 (second-reader review, round 2): the ONE way a daemon is stopped. Out of the identity map now (no run is handed to it), but its slot is held in
  // this.dying until its process exits; SIGTERM then SIGKILL after graceMs (or SIGKILL at once). Freed only by the child's 'exit'.
  retire(identity, x, why, signal = 'SIGTERM') {
    if (this.d.get(identity) === x) this.d.delete(identity);
    if (x.idle) { clearTimeout(x.idle); x.idle = null; }
    if (x.dying || x.exited) return;
    x.dying = why; this.dying.add(x);
    try { x.child.kill(signal); } catch { /* already gone: 'exit' frees the slot */ }
    if (signal !== 'SIGKILL') {
      x.grace = setTimeout(() => { if (x.exited) return; x.forced = true; this.log('kill', identity, { why, afterMs: this.graceMs }); try { x.child.kill('SIGKILL'); } catch { /* gone */ } }, this.graceMs);
      x.grace.unref();
    } else x.forced = true;
  }
  pidOf(identity) { const x = this.d.get(identity); return x ? x.child.pid : null; }

  crash(identity, why) {
    const t = this.now(), w = (this.crashes.get(identity) || []).filter((x) => t - x < this.crashWindowMs);
    w.push(t); this.crashes.set(identity, w);
    this.log('crash', identity, { why, inWindow: w.length });
    if (w.length >= this.crashLimit && !this.paused.has(identity)) { this.paused.add(identity); this.log('paused', identity, { crashes: w.length }); }
  }
  backoffMs(identity) {
    const t = this.now(), w = (this.crashes.get(identity) || []).filter((x) => t - x < this.crashWindowMs);
    if (!w.length) return 0;
    const wait = Math.min(60000, 1000 * 2 ** (w.length - 1)), since = t - w[w.length - 1];
    return since < wait ? wait - since : 0;
  }

  spawn(identity) {
    const perm = permissionFlags(this.allowRead);
    const execArgv = ['--max-old-space-size=' + this.heapMb, ...(perm || [])];
    const child = fork(realPath(this.daemonPath), [], { execArgv, env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json' });   // H1: no inherited secrets
    const x = { child, identity, busy: null, idle: null, lastUsed: this.now() };
    x.ready = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('the script daemon did not start within 10 s')), 10000);
      child.once('message', (m) => { clearTimeout(to); if (m && m.t === 'ready') { this.log('start', identity, { pid: m.pid, permission: !!m.permission }); resolve(m); } else reject(new Error('the script daemon spoke before it was ready')); });
      child.once('exit', () => { clearTimeout(to); reject(new Error('the script daemon exited while starting')); });
    });
    child.on('exit', (code, signal) => {
      x.exited = true;
      if (x.grace) { clearTimeout(x.grace); x.grace = null; }
      if (this.d.get(identity) === x) this.d.delete(identity);
      const wasDying = this.dying.delete(x);                     // 1.0.3 (second-reader review, round 2): the slot is freed HERE, and only here
      if (x.idle) clearTimeout(x.idle);
      if (x.busy) { this.crash(identity, 'exited during a run (' + (signal || 'code ' + code) + ')'); x.busy.fail(new Error('the script daemon exited during the run (' + (signal || 'code ' + code) + ') — the run failed; the next run starts a fresh daemon')); }
      else this.log('stop', identity, { code, signal, how: wasDying ? (x.forced ? 'kill' : 'term') : 'exit', ...(wasDying ? { why: x.dying } : {}) });
    });
    child.on('message', (m) => this.onMessage(identity, x, m));
    child.unref(); if (child.channel && child.channel.unref) child.channel.unref();   // a daemon never keeps the core alive by itself
    child.on('error', () => { /* 'exit' follows */ });
    this.d.set(identity, x);
    return x;
  }

  onMessage(identity, x, m) {
    const run = x.busy;
    if (!m || typeof m !== 'object' || m.t === 'ready') return;
    if (!run || m.runId !== run.runId) { this.log('dropped', identity, { t: String(m.t).slice(0, 20), runId: m.runId }); return; }
    if (m.t === 'call') {
      Promise.resolve().then(() => run.ctx.send(m.action, m.input, { labels: Array.isArray(m.labels) ? m.labels : [], ctl: Array.isArray(m.ctl) ? m.ctl : [] }))
        .then((reply) => reply, (e) => ({ ok: false, code: 'ACTION_ERROR', error: String((e && e.message) || e), labels: [] }))
        .then((reply) => { if (x.busy === run && x.child.connected) x.child.send({ t: 'reply', callId: m.callId, reply }); });
    } else if (m.t === 'state-set') {
      try { run.ctx.stateSet(m.key, m.value, m.labels); } catch (e) { run.stateError = run.stateError || e; }
    } else if (m.t === 'done') {
      if (run.stateError) return run.fail(new Error('script state could not be written: ' + run.stateError.message));
      if (m.ok) return run.done({ value: m.value, labels: m.labels || [], seen: m.seen || [] });
      const e = new Error(m.script ? m.code + ': ' + m.message : m.message);
      e.labels = m.labels || []; e.script = !!m.script; if (m.possibilities) e.possibilities = m.possibilities;
      run.fail(e);
    } else this.log('dropped', identity, { t: String(m.t).slice(0, 20) });
  }

  room(identity) {                                             // 1.0.3: synchronous — the check and the spawn happen in one turn, so concurrent starts can't all pass it
    if (this.d.has(identity) || this.slots() < this.max) return;     // 1.0.3 (second-reader review, round 2): dying daemons still hold their slots
    const idle = [...this.d.entries()].filter(([, x]) => !x.busy && !x.claimed).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (!idle) throw this.refuseBusy('DAEMON_FULL', identity, 'all ' + this.max + ' script daemons are busy — try again shortly');
    this.log('evict', idle[0]); this.retire(idle[0], idle[1], 'evict');   // second-reader review, round 2: not awaited — the slot stays held until that process exits,
    throw this.refuseBusy('DAEMON_EVICTING', identity, 'all ' + this.max + ' script daemons are busy — an idle one is being stopped to make room; try again shortly');   // so THIS start is refused · 1.0.4: its own code — a slot frees within graceMs
  }

  async run(identity, job, ctx) {
    if (this.closed) throw new Error('the script supervisor is shut down');
    if (this.paused.has(identity)) throw transient('DAEMON_PAUSED', 'the script daemon for ' + identity + ' is paused after ' + this.crashLimit + ' crashes in ' + Math.round(this.crashWindowMs / 60000) + ' minutes — it stays paused until ' + this.product + ' starts again (check the audit log first)');
    let x = this.d.get(identity);
    if (!x) {
      const wait = this.backoffMs(identity);
      if (wait > 0) throw transient('DAEMON_RESTARTING', 'the script daemon for ' + identity + ' is restarting after a crash — next try in ' + Math.ceil(wait / 1000) + ' s');
      this.room(identity);
      x = this.spawn(identity);
    }
    if (x.busy || x.claimed) throw this.refuseBusy('DAEMON_OVERLAP', identity, 'the script daemon for ' + identity + ' is already running a script');   // the engine serialises runs per identity
    x.claimed = true;                                            // 1.0.3: a starting or about-to-run daemon is not idle — room() must not evict it
    try { await x.ready; } finally { x.claimed = false; }      // no await between here and x.busy = run (the Promise executor below runs at once)
    if (x.idle) { clearTimeout(x.idle); x.idle = null; }
    const runId = ++this.seq, timeoutMs = job.timeoutMs || this.timeoutMs;
    return new Promise((resolve, reject) => {
      let timer;
      const end = () => { clearTimeout(timer); x.busy = null; x.lastUsed = this.now(); if (this.d.get(identity) === x) { x.idle = setTimeout(() => { x.idle = null; this.log('idle-stop', identity); this.retire(identity, x, 'idle'); }, this.idleMs); x.idle.unref(); } };
      const run = { runId, ctx, done: (r) => { end(); resolve(r); }, fail: (e) => { end(); reject(e); } };
      x.busy = run;
      timer = setTimeout(() => {
        this.crash(identity, 'killed after ' + timeoutMs + ' ms');
        x.busy = null; this.retire(identity, x, 'timeout', 'SIGKILL');   // L1: never hand the next run to a dying daemon · second-reader review, round 2: its slot is held until it exits
        reject(new Error('TIMEOUT: the script ran longer than ' + timeoutMs + ' ms — its daemon was stopped'));
      }, timeoutMs);
      const { timeoutMs: _t, ...msg } = job;
      x.child.send({ t: 'run', runId, ...msg });
    });
  }

  close() {
    this.closed = true;
    for (const [, x] of this.d) { if (x.idle) clearTimeout(x.idle); try { x.child.kill('SIGKILL'); } catch { /* gone */ } }
    for (const x of this.dying) { if (x.grace) clearTimeout(x.grace); try { x.child.kill('SIGKILL'); } catch { /* gone */ } }
    this.d.clear(); this.dying.clear();
  }
}

module.exports = { Supervisor, permissionFlags, TRANSIENT };
