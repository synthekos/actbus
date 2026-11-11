// registry.js — v1.2.4 · the action registry: every action is a file pinned by its sha256 · changelog: act/CHANGELOG.md#actcoreregistryjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// ## Design
// the action registry: every action is a file pinned by its sha256 (ACTBUS docs/capability-architecture.md §1 item 3)
// 1.2.0 (ACTBUS docs/proteus-k.md §7): kind "script" — a PROTEUS-K source file (.pk), pinned by its sha256 like any action, prepared by the
// script engine the caller passes in (load(dir, file, { scriptEngine })). A script must run AS its own identity (runsAs).
// At load the registry computes what each script can REACH; it refuses a script that calls an unknown or refused action,
// that is part of a call cycle between scripts, whose declared "world" differs from what it reaches, or whose warnings
// (a world action decided by web/model data) the admin has not accepted ("acceptWarnings": true). Nothing else changes.
// registry.json (admin-written):
//   { "actions": [ { "name": "calc", "version": "1.0.0", "kind": "native", "file": "calc.js", "sha256": "<64 hex>",
//                    "produces": "computed", "world": false, "runsAs": null, "needs": [], "input": { "expr": "string" },
//                    "timeoutMs": 2000 } ] }
//   kind      native (computes) · tentacle (reaches the outside world) · model (calls a language model)
//   produces  the label its output earns: computed · web · model · grounded · device
//   world     true = it changes or reaches something outside the box → the taint rule applies to its input
//   runsAs    an identity this action runs AS (a service identity: an EUser offering a job to others) — the caller's
//             authority chain is extended with it, so a caller can never do through it what the caller may not do itself
//   needs     Node built-in modules the file may require — a DECLARATION for the admin's review, enforced only for
//             require(): code can still reach modules another way (e.g. process.getBuiltinModule). The admin reviews the
//             source before pinning it; real confinement is WASM (slice 4).
//   input     field → type: string · number · integer · boolean · object · array; a trailing "?" means optional
// The loader reads each file ONCE, checks its sha256, and compiles THOSE bytes (no second read from disk), so a file
// swapped after the check cannot run. A hash mismatch refuses that action and is reported; the rest still load.
// HONEST LIMIT: an in-process JavaScript action is not sandboxed — the hash proves it is the file the admin approved,
// not that the file is safe, and `needs` limits require() only. That is why only the admin installs actions and reviews
// their source; real confinement is WASM (slice 4).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const { FORM_NAMES } = require('./targets');   // 1.2.4 (v0.53.2)
const { NAME } = require('./envelope');

const KINDS = ['native', 'tentacle', 'model', 'script'];
const PRODUCES = ['computed', 'web', 'model', 'grounded', 'device'];
const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
const CORE_LIBS = { rational: './rational' };               // core libraries an action may name in needs
const BUILTINS = ['fs', 'path', 'crypto', 'url', 'util', ...Object.keys(CORE_LIBS)];   // the most an action may ask for
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function compile(src, filename, needs) {
  const allowed = new Set(needs);
  const req = (m) => {
    const bare = String(m).replace(/^node:/, '');
    if (!allowed.has(bare)) throw new Error('action ' + path.basename(filename) + ' may not require "' + m + '" (needs: ' + [...allowed].join(', ') + ')');
    return CORE_LIBS[bare] ? require(CORE_LIBS[bare]) : require(bare);
  };
  const mod = { exports: {} };
  const wrapper = vm.runInThisContext('(function (exports, require, module, __filename, __dirname) {' + src + '\n})', { filename });
  wrapper.call(mod.exports, mod.exports, req, mod, filename, path.dirname(filename));
  if (!mod.exports || typeof mod.exports.run !== 'function') throw new Error('action ' + path.basename(filename) + ' must export run(input, ctx)');
  return mod.exports;
}

function checkEntry(e) {
  const bad = (m) => { throw new Error('registry entry ' + JSON.stringify(e && e.name) + ': ' + m); };
  if (!e || typeof e !== 'object') bad('must be an object');
  if (!NAME.test(e.name || '')) bad('name must be a-z, 0-9, - (starts with a letter)');
  if (!/^\d+\.\d+\.\d+$/.test(e.version || '')) bad('version must be x.y.z');
  if (!KINDS.includes(e.kind)) bad('kind must be ' + KINDS.join(' | '));
  if (!PRODUCES.includes(e.produces)) bad('produces must be ' + PRODUCES.join(' | '));
  if (typeof e.world !== 'boolean') bad('world must be true or false');
  if (!/^[a-f0-9]{64}$/.test(e.sha256 || '')) bad('sha256 must be 64 hex characters');
  if (e.kind === 'script') {
    if (typeof e.file !== 'string' || !/^[A-Za-z0-9._-]+\.pk$/.test(e.file)) bad('a script file must be a plain .pk file name in the actions folder');
    if (!e.runsAs) bad('a script must run as its own identity (runsAs)');
    if ((e.needs || []).length) bad('a script needs no modules (needs must be empty)');
    if (e.produces !== 'computed') bad('a script produces computed (its reply also carries everything it received)');
    if (e.acceptWarnings !== undefined && typeof e.acceptWarnings !== 'boolean') bad('acceptWarnings must be true or false');
  } else if (typeof e.file !== 'string' || !/^[A-Za-z0-9._-]+\.js$/.test(e.file)) bad('file must be a plain .js file name in the actions folder');
  if (e.runsAs !== undefined && e.runsAs !== null && !NAME.test(e.runsAs)) bad('runsAs must be an identity name or null');
  // 1.2.4 (v0.53.2): the form in which the KERNEL judges this action's targets (core/targets.js); a script has none (its calls are judged)
  if (e.targetForm !== undefined && !FORM_NAMES.includes(e.targetForm)) bad('targetForm must be ' + FORM_NAMES.join(' | '));
  if (e.targetForm !== undefined && e.kind === 'script') bad('a script has no targetForm (the actions it calls are judged)');
  const needs = e.needs || []; if (!Array.isArray(needs) || needs.some((n) => !BUILTINS.includes(n))) bad('needs may only list: ' + BUILTINS.join(', '));
  const input = e.input || {}; if (typeof input !== 'object') bad('input must be an object');
  for (const [k, t] of Object.entries(input)) if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(k) || !TYPES.includes(String(t).replace(/\?$/, ''))) bad('input field ' + k + ': type must be ' + TYPES.join(' | ') + ' (optionally ending in ?)');
  const maxMs = e.kind === 'script' ? 600000 : 120000;
  if (e.timeoutMs !== undefined && !(Number.isInteger(e.timeoutMs) && e.timeoutMs >= 10 && e.timeoutMs <= maxMs)) bad('timeoutMs must be 10–' + maxMs);
}

// Returns { actions: Map(name → entry with .impl), refused: [{ name, reason }] }.
function load(dir, manifestFile = 'registry.json', { scriptEngine } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, manifestFile), 'utf8'));
  if (!manifest || !Array.isArray(manifest.actions)) throw new Error(manifestFile + ' must be { "actions": [ … ] }');
  const actions = new Map(), refused = [], scripts = [];
  for (const e of manifest.actions) {
    try {
      checkEntry(e);
      if (actions.has(e.name) || scripts.some((x) => x.e.name === e.name)) throw new Error('duplicate action name');
      const file = path.join(dir, e.file);
      const st = fs.lstatSync(file);
      if (!st.isFile()) throw new Error(e.file + ' is not a plain file (symlinks are refused)');
      const bytes = fs.readFileSync(file);
      const got = sha256(bytes);
      if (got !== e.sha256) throw new Error('sha256 mismatch: registry ' + e.sha256.slice(0, 12) + ' · file ' + got.slice(0, 12) + ' — the file is not the one the admin approved');
      if (e.kind === 'script') { scripts.push({ e, bytes }); continue; }          // prepared below, once every action is known
      const impl = compile(bytes.toString('utf8'), file, e.needs || []);
      actions.set(e.name, Object.freeze({ ...e, runsAs: e.runsAs || null, needs: e.needs || [], input: e.input || {}, timeoutMs: e.timeoutMs || 10000, impl }));
    } catch (err) { refused.push({ name: e && e.name, reason: err.message }); }
  }
  if (scripts.length) loadScripts(scripts, actions, refused, scriptEngine);
  return { actions, refused };
}

// Scripts: read + checked by the engine; reach computed over script → script calls; cycles, world and warnings decided here.
function loadScripts(scripts, actions, refused, engine) {
  const refuse = (name, reason) => refused.push({ name, reason });
  if (!engine) { for (const s of scripts) refuse(s.e.name, 'no script engine is attached on this node'); return; }
  const names = new Set([...actions.keys(), ...scripts.map((s) => s.e.name)]);
  const prep = new Map();
  for (const s of scripts) {
    try { prep.set(s.e.name, { e: s.e, p: engine.prepare(s.bytes, s.e, (n) => names.has(n)) }); }
    catch (err) { refuse(s.e.name, err.message); }
  }
  // a call to a script that failed to prepare is a call to an unknown action
  let changed = true;
  while (changed) {
    changed = false;
    for (const [n, x] of prep) {
      const gone = x.p.calls.find((c) => !actions.has(c) && !prep.has(c));
      if (gone) { prep.delete(n); refuse(n, 'calls ' + gone + ', which is not loaded'); changed = true; }
    }
  }
  // cycles between scripts (a script reaching itself) are refused at load, every script in the cycle
  const state = new Map(), inCycle = new Set();
  const visit = (n, stack) => {
    if (state.get(n) === 2) return; if (state.get(n) === 1) { stack.slice(stack.indexOf(n)).forEach((m) => inCycle.add(m)); return; }
    state.set(n, 1); stack.push(n);
    for (const c of prep.get(n).p.calls) if (prep.has(c)) visit(c, stack);
    stack.pop(); state.set(n, 2);
  };
  for (const n of prep.keys()) visit(n, []);
  for (const n of inCycle) { prep.delete(n); refuse(n, 'part of a call cycle between scripts (a script may not reach itself)'); }
  // reach: every action a script can cause, through other scripts
  const reach = (n, seen = new Set()) => {
    for (const c of prep.get(n).p.calls) { if (seen.has(c)) continue; seen.add(c); if (prep.has(c)) reach(c, seen); }
    return seen;
  };
  for (const [n, { e, p }] of prep) {
    try {
      const r = [...reach(n)].sort();
      const same = r.filter((c) => prep.has(c) && prep.get(c).e.runsAs === e.runsAs);   // 1.2.2 (R4)
      if (same.length) throw new Error('reaches the script' + (same.length > 1 ? 's ' : ' ') + same.join(', ') + ' that run' + (same.length > 1 ? '' : 's') + ' as the same identity (' + e.runsAs + ') — one run at a time per identity, so it would wait for itself');
      const worlds = r.filter((c) => actions.has(c) && actions.get(c).world);
      const world = worlds.length > 0;
      if (world !== e.world) throw new Error('declares world: ' + e.world + ' but it ' + (world ? 'reaches the world actions ' + worlds.join(', ') : 'reaches no world action'));
      // world / source through other scripts too: a called script counts as what it reaches
      const via = (c, test) => (actions.has(c) ? test(actions.get(c)) : prep.has(c) && [...reach(c)].some((x) => actions.has(x) && test(actions.get(x))));
      const warnings = engine.warnings(p, (c) => via(c, (a) => a.world), (c) => via(c, (a) => a.produces === 'web' || a.produces === 'model' || a.name === 'messages'));   // 1.2.1
      if (warnings.length && e.acceptWarnings !== true) throw new Error('needs the admin to accept (acceptWarnings: true): ' + warnings.join(' | '));
      const impl = engine.impl(p, e);
      actions.set(n, Object.freeze({ ...e, needs: [], input: e.input || {}, timeoutMs: e.timeoutMs || 300000, impl,
        reach: Object.freeze({ actions: r, targets: p.targets, warnings }) }));
    } catch (err) { refuse(n, err.message); }
  }
  // 1.2.3 (C1/C2): can a script's REPLY carry web/model text back to its caller?
  //   taintVia  = the web/model/messages/file-read actions it reaches (through other scripts too)
  //   stateTaint = it (or a script it reaches) reads script memory AND that memory could hold such text: some loaded script running as the
  //                same identity reaches a source, or takes input (a caller could hand it web text to remember). Over-counts on purpose.
  const loaded = [...prep.keys()].filter((n) => actions.has(n) && actions.get(n).kind === 'script');
  const isSrc = (c) => actions.has(c) && actions.get(c).kind !== 'script' && (actions.get(c).produces === 'web' || actions.get(c).produces === 'model' || c === 'messages' || c === 'file-read');
  const via = new Map(loaded.map((n) => [n, actions.get(n).reach.actions.filter(isSrc)]));
  const fed = new Set();   // runsAs identities whose memory may hold web/model text
  for (const n of loaded) { const e = actions.get(n); if (via.get(n).length || Object.keys(e.input || {}).length) fed.add(e.runsAs); }
  const readsState = (m) => /\(\s*remembered\b/.test(Buffer.from(prep.get(m).p.src64 || '', 'base64').toString('utf8'));
  for (const n of loaded) {
    const e = actions.get(n), mine = [n, ...e.reach.actions.filter((c) => prep.has(c) && actions.has(c))];
    const stateTaint = mine.some((m) => readsState(m) && fed.has(actions.get(m).runsAs));
    actions.set(n, Object.freeze({ ...e, reach: Object.freeze({ ...e.reach, taintVia: via.get(n), stateTaint }) }));
  }
}

// Typed input check: unknown fields refused, required fields present, types exact.
function checkInput(spec, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  for (const k of Object.keys(input)) if (!Object.hasOwn(spec, k)) return 'unknown input field: ' + k;   // fix 1.1.0: not `in` (constructor, __proto__)
  for (const [k, t0] of Object.entries(spec)) {
    const opt = t0.endsWith('?'), t = t0.replace(/\?$/, ''), v = input[k];
    if (v === undefined) { if (opt) continue; return 'missing input field: ' + k; }
    const ok = t === 'integer' ? Number.isInteger(v) : t === 'array' ? Array.isArray(v) : t === 'object' ? (v && typeof v === 'object' && !Array.isArray(v)) : t === 'number' ? (typeof v === 'number' && Number.isFinite(v)) : typeof v === t;
    if (!ok) return 'input field ' + k + ' must be ' + t;
  }
  return null;
}

module.exports = { load, checkInput, sha256, KINDS, PRODUCES };
