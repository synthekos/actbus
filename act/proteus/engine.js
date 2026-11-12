// engine.js — v1.5.1 · the PROTEUS-K engine: a checked script becomes a registry action · changelog: act/CHANGELOG.md#actproteusenginejs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// PROTEUS-K script engine: a checked script becomes a registry action (ACTBUS docs/proteus-k.md §7, §8)
// 1.1.0 (self-review 30 Oct): S1/S5 — the reply and any error now ADD the labels of the returned value and of everything
// the run computed (state, input included), not only what the bus saw arrive this run; S4 — the run starts under the
// call's ctl; S3 — the survey follows EVALUATION order, and a world call is steered if it is inside a condition or loop
// OR comes after anything the script read (a fail or an action error on that data could have stopped the script).
// createEngine({ stateRoot, audit, fuel }) → { prepare, impl } — passed to the registry: load(dir, file, { scriptEngine }).
//   prepare(bytes, entry, isAction) reads and checks the source (refused at load if anything is wrong) and returns what it
//     can reach: calls (action names), targets (literal URLs and file names written in the source), warnings.
//   impl(prepared, entry) → { run(input, ctx) } — the bus calls it like any action. The script's calls go through
//     ctx.send with each value's own labels and ctl (bus 1.2.0, kind script). Runs of one script are serialised (its state
//     has one writer). State: <stateRoot>/.pk-state/s-<identity>/state.json (state.js; 1.2.1).
// WARNING (ACTBUS docs/proteus-k.md §5): a world action that runs inside a condition or a loop, or AFTER the script has read model/web data
// or its remembered values / input, can be steered by that data (rule b: WHETHER it runs, never what it writes). The admin
// accepts it explicitly in the registry entry ("acceptWarnings": true) — the warning text says which action and why.
'use strict';
const { read, ReadError } = require('./reader');
const { check, run, ScriptError } = require('./eval');
const { fileState } = require('./state');
const fs = require('fs'), path = require('path');
const { Supervisor, TRANSIENT } = require('../daemon/supervisor');
const KNOWN = ['person', 'device', 'computed', 'grounded', 'model', 'web'], CRED = ['grounded'];   // envelope.js LABELS / CREDENTIALS
// F-B 1.2.1: on a box the state root may be the files root (live: both act-files/); identity names never start with a dot, so no
// identity's file folder can be .pk-state — an identity named s-<script> can no longer write that script's state.json
function stateDir(root) {
  if (!root) return root;
  const d = path.join(root, '.pk-state');
  try { fs.mkdirSync(d, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (fs.lstatSync(d).isSymbolicLink()) throw new Error('the script state folder is a symlink — refusing');
  return d;
}

const BRANCHING = new Set(['if', 'when', 'unless', 'and', 'or', 'for-each', 'define']);   // 1.4.0: + define
const READERS = new Set(['remembered', 'input']);

// walk: action calls, whether each sits inside a condition/loop, and literal targets (:url / :name strings)
function survey(forms) {
  const calls = [], targets = new Set();
  const walk = (n, branched) => {
    if (n.t !== 'list' || !n.items.length) return;
    // a list that is not a call (let bindings, a for-each header) — look inside it all the same
    if (n.items[0].t !== 'sym') { for (const x of n.items) walk(x, branched); return; }
    const h = n.items[0].v, a = n.items.slice(1);
    // as the evaluator runs it: the condition / first operand / loop header OUTSIDE, the branches and the body INSIDE
    const firstOutside = BRANCHING.has(h);
    for (let i = 0; i < a.length; i++) {
      if (a[i].t === 'kw' && (a[i].v === 'url' || a[i].v === 'name') && a[i + 1] && a[i + 1].t === 'str') targets.add(a[i].v + ':' + a[i + 1].v);
      walk(a[i], branched || (firstOutside && i > 0));
    }
    calls.push({ name: h, branched, line: n.items[0].line });      // after its arguments: evaluation order (1.1.0)
  };
  for (const f of forms) walk(f, false);
  return { calls, targets: [...targets].sort() };
}

// daemon: a Supervisor, true (a new one, audited like state writes), or false; default: false, or true when PK_DAEMON=1 (tests)
function createEngine({ stateRoot, audit, fuel, daemon, productName } = {}) {   // 1.5.0 (v0.53.6): productName → a Supervisor it makes
  const locks = new Map();                                   // identity → tail of its promise chain (one run at a time)
  if (daemon === undefined) daemon = process.env.PK_DAEMON === '1';
  const sup = daemon === true ? new Supervisor({ audit: audit || (() => {}), productName }) : (daemon || null);
  return {
    supervisor: sup,
    close() { if (sup) sup.close(); },
    prepare(bytes, entry, isAction) {
      let forms;
      try { forms = read(bytes); } catch (e) { throw new Error('script ' + entry.file + ': ' + e.message); }
      if (!forms.length) throw new Error('script ' + entry.file + ' is empty');
      let checked;
      try { checked = check(forms, isAction); } catch (e) { throw new Error('script ' + entry.file + ': ' + e.message); }
      const { calls, targets } = survey(forms);
      const actionCalls = [...new Set(checked.calls.map((c) => c.action))].sort();
      return { forms, src64: Buffer.from(bytes).toString('base64'), calls: actionCalls, targets, survey: calls, isAction, reads: calls.some((c) => READERS.has(c.name)) };
    },
    // warnings(p, isWorld, isSource): decided by the registry once reach is known (see the header)
    warnings(p, isWorld, isSource) {
      const src = (c) => isSource(c.name) || READERS.has(c.name);
      const sources = [...new Set(p.survey.filter(src).map((c) => (READERS.has(c.name) ? 'remembered/input' : c.name)))];
      if (!sources.length) return [];
      const out = []; let read = false;
      for (const c of p.survey) {                                   // evaluation order
        if (isWorld(c.name) && (c.branched || read)) out.push('world action ' + c.name + ' (line ' + c.line + ') runs ' +
          (c.branched ? 'inside a condition or loop' : 'after the script read data') + ', and the script reads ' + sources.join(', ') +
          ': that data can decide WHETHER it runs (rule b), never what it writes');
        if (src(c)) read = true;
      }
      return [...new Set(out)];
    },
    impl(p, entry) {
      // 1.3.1: why this run must stay in-process — its input carries a credential, or its reach (transitively) produces one; else null
      const credPath = (ctx) => {
        if (ctx.labels().some((l) => CRED.includes(l))) return 'its input carries a credential';
        const seen = new Set(), todo = [...p.calls];
        while (todo.length) {
          const a = todo.pop(); if (seen.has(a)) continue; seen.add(a);
          const r = typeof ctx.backend === 'function' ? ctx.backend('action', a) : null, e = r && r.handler;
          if (!e) continue;
          if (CRED.includes(e.produces)) return a + ' produces ' + e.produces;
          if (e.kind === 'script' && e.reach && Array.isArray(e.reach.actions)) todo.push(...e.reach.actions);
        }
        return null;
      };
      return {
        run: async (input, ctx) => {
          const prev = locks.get(ctx.identity) || Promise.resolve();
          let release; const mine = new Promise((r) => { release = r; });
          const tail = prev.then(() => mine);
          locks.set(ctx.identity, tail);
          await prev;
          // 1.5.1 (v0.54.3): a child call the bus refused transiently is kept HERE, in this process. The language
          // has no way to catch an error, so that refusal ended the script. Only when it was the script's FIRST action call can nothing
          // the script did have happened: then the caller gets its code (503, transient). After an earlier call it stays ACTION_ERROR (422),
          // whose message names the code — the script did start, and what it did stands. Only the bus's reply, seen here, counts.
          let childTransient = null, calls = 0;
          const watch = (r) => { calls += 1; if (calls === 1 && r && r.ok === false && r.transient === true && TRANSIENT.includes(r.code)) childTransient = r; return r; };
          const asTransient = (err) => { if (childTransient) { err.code = childTransient.code; err.transient = true; if (Number.isFinite(childTransient.retryAfterMs)) err.retryAfterMs = childTransient.retryAfterMs; } return err; };
          try {
            const state = fileState(stateDir(stateRoot), ctx.identity, audit);
            const credWhy = sup ? credPath(ctx) : null;               // 1.3.1 (H2): credentials are tracked per value only in-process
            if (credWhy) { try { if (audit) audit({ kind: 'daemon-skipped', identity: ctx.identity, why: credWhy }); } catch { /* still in-process */ } }
            if (sup && !credWhy) {                                     // slice 3: the daemon runs it; this process keeps every decision
              let r;
              const snap = state.snapshot();
              const clean = (ls) => (Array.isArray(ls) ? ls : []).filter((l) => KNOWN.includes(l) && !CRED.includes(l));   // H2: known labels, no credential
              const send = async (action, inp, meta) => {
                if (!p.calls.includes(action)) {                         // H2: outside the reach the admin approved (registry survey)
                  try { if (audit) audit({ kind: 'daemon-refused', identity: ctx.identity, action: String(action).slice(0, 48) }); } catch { /* the refusal stands */ }
                  return { ok: false, code: 'NOT_PERMITTED', error: 'the script asked for ' + String(action).slice(0, 48) + ', which it does not call in its source (approved reach: ' + (p.calls.join(', ') || 'none') + ')', labels: [] };
                }
                return watch(await ctx.send(action, inp, { labels: clean(meta && meta.labels), ctl: clean(meta && meta.ctl) }));
              };
              try {
                r = await sup.run(ctx.identity, { src64: p.src64, actions: p.calls, input: input || {}, inputLabels: ctx.labels(), ctl: ctx.ctl ? ctx.ctl() : [],
                  fuel, now: ctx.time, state: snap, timeoutMs: entry.timeoutMs }, { send, stateSet: (k, v, l) => state.set(k, v, clean(l)) });
              } catch (e) {
                if (e.script) ctx.addLabels(clean(e.labels));
                const out = new Error(e.message);
                if (e.transient === true && TRANSIENT.includes(e.code)) { out.code = e.code; out.transient = true; }   // 1.4.1: never attempted — not a failure
                throw asTransient(out);
              }
              r.labels = clean(r.labels); r.seen = clean(r.seen);
              ctx.addLabels(r.labels); ctx.addLabels(r.seen);
              if (ctx.replyCredentials) ctx.replyCredentials(r.labels);
              return r.value;
            }
            const r = await run(p.forms, { actions: p.isAction, input: input || {}, inputLabels: ctx.labels(), state, fuel, now: ctx.time,
              ctl: ctx.ctl ? ctx.ctl() : [], callAction: async (action, inp, meta) => watch(await ctx.send(action, inp, meta)) });
            ctx.addLabels(r.labels); ctx.addLabels(r.seen);          // S1: the reply carries what it returns, and all it saw (warnings)
            if (ctx.replyCredentials) ctx.replyCredentials(r.labels); // F-B 1.2.0: and the credentials of the value it returns, only
            return r.value;
          } catch (e) {
            if (e instanceof ScriptError) { ctx.addLabels(e.labels); throw asTransient(new Error(e.code + ': ' + e.message)); }   // S5
            throw e;
          } finally {
            release();
            if (locks.get(ctx.identity) === tail) locks.delete(ctx.identity);
          }
        },
      };
    },
    survey,
  };
}

module.exports = { createEngine, survey };
