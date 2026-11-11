// pkd.js — v1.0.1 · the script daemon: a separate process that holds only the interpreter · changelog: act/CHANGELOG.md#actdaemonpkdjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// the PROTEUS-K daemon (slice 3: ACTBUS docs/capability-architecture.md §7 item 3): a SEPARATE OS process that holds ONLY the interpreter.
// It has no database, no files and no network code
// of its own (Node 22's permission model does not deny the network itself): the supervisor starts it under Node's permission model (it may read
// only its own code) with a memory cap. Everything it does is a MESSAGE to the core over the parent–child channel:
//   core → pkd   { t:'run', runId, src64, actions, input, inputLabels, ctl, fuel, state:{keys, absent} }
//                { t:'reply', callId, reply }                      — the answer to one of its action calls
//   pkd → core   { t:'ready', pid, permission }
//                { t:'call', runId, callId, action, input, labels, ctl }   — the core runs it through the SAME bus checks
//                { t:'state-set', runId, key, value, labels }      — the core owns the state file and writes it
//                { t:'done', runId, ok, value, labels, seen } | { t:'done', runId, ok:false, script, code, message, labels, possibilities }
// The core decides; the daemon only asks. A crash, a runaway loop or a memory blow-up here ends THIS process; the core marks the
// run failed and starts a fresh daemon for the next run.
'use strict';
const { read } = require('../proteus/reader');
const { run, ScriptError, LIMITS } = require('../proteus/eval');

const send = (m) => { if (process.connected) process.send(m); };
const pending = new Map();                               // callId → resolve
let seq = 0;

// the script's state, as eval.js expects it (synchronous get/set): a copy of the core's file, every write forwarded at once (in
// order) — the same limits as state.js, so a too-big value fails the script exactly as it does in the core
function stateProxy(runId, snap) {
  const keys = new Map(Object.entries((snap && snap.keys) || {}));
  const absent = new Set((snap && snap.absent) || []);
  return {
    get: (key) => keys.get(key),
    set: (key, value, labels) => {
      if (!keys.has(key) && keys.size >= LIMITS.STATE_KEYS) throw new Error('more than ' + LIMITS.STATE_KEYS + ' remembered keys');
      if (JSON.stringify(value).length > LIMITS.STATE_BYTES) throw new Error('a remembered value larger than ' + LIMITS.STATE_BYTES + ' bytes');
      const lab = [...new Set(labels)].sort();
      keys.set(key, { value, labels: lab });
      for (const l of lab) absent.add(l);
      send({ t: 'state-set', runId, key, value, labels: lab });
    },
    absentLabels: () => [...absent].sort(),
  };
}

async function onRun(m) {
  let forms;
  try { forms = read(Buffer.from(String(m.src64 || ''), 'base64')); }
  catch (e) { send({ t: 'done', runId: m.runId, ok: false, script: true, code: 'CHECK', message: e.message, labels: [] }); return; }
  try {
    const r = await run(forms, {
      actions: new Set(m.actions || []), input: m.input || {}, inputLabels: m.inputLabels || [], ctl: m.ctl || [], fuel: m.fuel, now: typeof m.now === 'string' ? m.now : undefined,
      state: stateProxy(m.runId, m.state),
      callAction: (action, input, meta) => new Promise((resolve) => {
        const callId = ++seq; pending.set(callId, resolve);
        send({ t: 'call', runId: m.runId, callId, action, input, labels: meta.labels, ctl: meta.ctl });
      }),
    });
    send({ t: 'done', runId: m.runId, ok: true, value: r.value, labels: r.labels, seen: r.seen });
  } catch (e) {
    if (e instanceof ScriptError) send({ t: 'done', runId: m.runId, ok: false, script: true, code: e.code, message: e.message, labels: e.labels, possibilities: e.possibilities });
    else send({ t: 'done', runId: m.runId, ok: false, script: false, message: String((e && e.message) || e) });
  }
}

process.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'run') onRun(m);
  else if (m.t === 'reply') { const r = pending.get(m.callId); if (r) { pending.delete(m.callId); r(m.reply); } }
});
process.on('disconnect', () => process.exit(0));        // the core went away: so do we
send({ t: 'ready', pid: process.pid, permission: !!process.permission });
