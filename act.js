// act.js — v1.9.2 · the host adapter: the action route, the identities' grants and `create()` · changelog: act/CHANGELOG.md#actjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// ## Design
// (1) ACK, ACTBUS docs/functions-and-mailboxes.md §5 — when a KEY HOLDER calls `messages` itself WITH `hold: true` (review R1 L4: opted into), what it read is HELD
//   (claimed) until it acknowledges the ids (input `ack`) or 10 min pass (then delivered again; dead after 3); scripts unchanged.
//   (2) "operated by a person" (label rule A, owner decision, 5 Nov 2026): grant field `operatedByPerson: true` on an EUser — its `send` is NOT
//   escalated and carries the label person; refused at save AND at load if the EUser also holds any OTHER source of web or model text
//   (taintSources minus messages, and file-read ALWAYS — review R1 M2, re-review N2: a file without provenance reads as web). It may read messages: what it sends after
//   reading web text is labelled person — the admin's stated claim. Every other EUser and every script keeps the strict rule.
//   (6) third check C1/C2: a granted SCRIPT whose reply can carry web/model text (registry 1.2.3: it reaches a web/model/messages/file-read
//   action other than the one being called, or reads memory that may hold such text) counts as a source of web/model text — for the no-laundering rule and for operatedByPerson alike.
//   (5) F09: a fetch target may be written http://host (plain http must be granted explicitly; a bare host = https only).
//   (4) F05: logs/act.jsonl is written through act/core/durable.js — fsync per line, so "no line, no run" holds across a crash.
//   (3) F04 (second-reader review, 5 Nov 2026): the identity snapshot read for a request is passed WITH the call (bus.ask { ids }) — concurrent requests
// no longer share one bus.ids · the Admin web kill switch ("Pull the plug" → .web-egress-disabled, the file
//   websearch.js honours) now also stops the capability core's `fetch` action — checked on every call, refused with a clear error and
// audited like any failed action; the model backend (the local model server) is not web and is not affected · MAILBOXES (ACTBUS docs/functions-and-mailboxes.md §3): the core's mailboxes (act/mailbox.js, act-files/.mailbox/);
//   send/messages grants' targets are identity names; every run (POST /api/act and each trigger fire) has ONE trace, and when it
//   ends the messages it read are removed (ok) or delivered again (failed; dead after 3); stale claims are released every minute;
//   on-message triggers see the mailbox's pending count; the EUser panel shows its mailbox.
// slice 3 (ACTBUS docs/capability-architecture.md §7 item 3): scripts run in a SEPARATE daemon per identity (act/daemon; PK_DAEMON=0
//   turns it off); the email action + the core's outbox (act/mail; MAIL_ALLOW and the MAIL_* settings from the environment — no
//   settings = delivery OFF, mail stays queued); an email grant's targets must be plain addresses ON MAIL_ALLOW (refused at save AND at
//   load); triggers from act/actions/triggers.json (written by make-registry.js from triggers.spec.json — no file = nothing is
//   scheduled), fired as their runsAs EUser through the same bus; a trigger is switched OFF with `node act/trigger-off.js <id>` (the
//   kill switch; switching on needs the file); the EUser Admin panel lists its triggers and its mail. server.js is NOT changed.
// POST /api/act: EUsers run REGISTERED actions and SCRIPTS through the capability core
// 1.2.0 (PROTEUS-K v0, ACTBUS docs/proteus-k.md; 95 tests): scripts (kind script, .pk, sha256-pinned) are loaded through the
//   script engine (act/proteus); runsAs is enabled for scripts ONLY (a script runs as its own EUser identity); script state lives in
//   act-files/s-<identity>/ and every write is audited here (outcome state-set); rule (b) of ACTBUS docs/proteus-k.md §8 item 5: the 1.1.0 escalation below
//   applies to a script call only when the script declares input fields; grants may carry strictControl (true/false).
// POST /api/act: EUsers run REGISTERED actions through the capability core
// 1.1.0 (adversarial second-reader review, 28 Oct — 7 findings, all fixed, each with a test):
//   1 (high) a key holder could fetch web text and send it back UNLABELLED into a world action (the caller's own label is
//     "device"): now an EUser that can RECEIVE web or model text from the box (it holds fetch / model, or file-read with a
//     tainted-allowed file-append) has those labels added to every OTHER world action it calls → refused unless allowTainted.
//   2 (high) huge malformed requests flooded logs/act.jsonl around the rate limit: the action name is checked here first,
//     EVERY request (refused ones too) counts against the EUser's rate, an audit line is capped at 4 KB, and refusals made
//     here are logged at most 10 a minute per EUser (the next line counts the rest).
//   3 wrong-shaped stored grants ('null', a list) took every EUser down: now that record alone is refused.
//   4 the owner was kept by login ID (a rename moved ownership): the owner's uniqueId is stored and used.
//   5 a role change away from euser kept the grants (revived unlogged on the way back): cleared and logged (server.js).
//   6 refusals made here were not logged: they are now.   7 the caller chose the trace id: the trace is always fresh.
//
// The host adapter between an application and the capability core in act/core (design: the capability-architecture note in
// the ACTBUS repository's docs). /api/ask answers a QUESTION; /api/act runs a
// named action an admin installed (act/actions, every file pinned by its sha256 in act/actions/registry.json) and returns
// its result with its provenance (basis + labels).
//
//   route(req, res)   req.euser: the EUser the HOST has already authenticated (this file reads no key and serves no HTTP)
//                     req.body: { "action": "calc", "input": { "expr": "4837 * 2919" } }
//   → { ok, action, basis, labels, value, sha256, id, trace }  ·  or  { ok: false, code, error }  (status codes: act/core/edge.js)
//   (The reference host's server.js serves it as POST /api/act, authenticated by Authorization: Bearer <the EUser's key>.)
//
// WHO MAY DO WHAT is set per EUser on its Admin › Edit page, field "Actions" (users.act_grants, JSON):
//   { "owner": "<login ID of the accountable PERSON>",
//     "actions": { "calc": {}, "fetch": { "targets": ["www.bankofcanada.ca"] }, "file-append": {} },
//     "models": ["<model>"], "rate": 60 }
// Empty = no actions (the default for every record — nothing changes for anyone until an admin grants something).
// Every grant change is written to the same audit log as every action: logs/act.jsonl (append-only, one JSON line each).
//
// Rules carried by the core (ACTBUS docs/capability-architecture.md): the key decides the identity; every identity in the chain must hold the action;
// model- or web-labelled input never reaches a world action (fetch, file write) without an explicit allowTainted rule;
// hop limit, trace budget, duplicate ids run once, per-identity rate; a "run" line is logged BEFORE the action runs (no
// line, no run). Identity names are "u-<uniqueId>"; the audit also writes the login IDs ("who").
// Not in v0.51.0: runsAs for native actions (refused at load), other nodes, EUser-sent programs (slice 2b), a switch-off button.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const registry = require('./act/core/registry');
const caps = require('./act/core/capabilities');
const { Names } = require('./act/core/names');
const { Bus, ERR } = require('./act/core/bus');
const { STATUS, retryAfter } = require('./act/core/edge');
const { NAME } = require('./act/core/envelope');
const { createEngine } = require('./act/proteus/engine');
const { Outbox, parseAllow, checkGrants } = require('./act/mail/outbox');   // 1.3.0
const smtp = require('./act/mail/smtp');
const { Scheduler } = require('./act/scheduler');
const { Mailbox } = require('./act/mailbox');   // 1.4.0
const { appender } = require('./act/core/durable');   // 1.6.0 (F05)
const targets = require('./act/core/targets');   // 1.6.1 (v0.53.2)
const { productName: checkProduct } = require('./act/core/product');   // 1.7.0 (v0.53.6)

const ACTIONS_DIR = path.join(__dirname, 'act', 'actions');
const GRANTS_MAX = 8000;
const GRANT_KEYS = ['owner', 'ownerId', 'actions', 'models', 'rate', 'operatedByPerson'];   // 1.6.0: operatedByPerson   // ownerId is written by the box (1.1.0), recomputed on every save
const ACTION_GRANT_KEYS = ['targets', 'allowTainted', 'strictControl'];

const idName = (u) => { const n = 'u-' + String((u && u.uniqueId) || '').toLowerCase(); return NAME.test(n) ? n : null; };
const isPerson = (u) => !!u && (u.role === 'user' || u.role === 'admin') && (u.auth || 'login') === 'login';

// The admin's text → { ok, value: normalised JSON string | null, errors: [] }. findOwner(loginId) → the user row or null.
async function parseGrants(text, { actionNames, findOwner, mailAllow = [], relayRisk = () => [] }) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return { ok: true, value: null, errors: [] };
  const errors = [];
  if (raw.length > GRANTS_MAX) return { ok: false, value: null, errors: ['Actions: longer than ' + GRANTS_MAX + ' characters'] };
  let g;
  try { g = JSON.parse(raw); } catch (e) { return { ok: false, value: null, errors: ['Actions: not valid JSON (' + e.message + ')'] }; }
  if (!g || typeof g !== 'object' || Array.isArray(g)) return { ok: false, value: null, errors: ['Actions: must be a JSON object { "owner": …, "actions": { … } }'] };
  for (const k of Object.keys(g)) if (!GRANT_KEYS.includes(k)) errors.push('Actions: unknown field "' + k + '" (allowed: ' + GRANT_KEYS.join(', ') + ')');
  if (typeof g.owner !== 'string' || !g.owner.trim()) errors.push('Actions: "owner" is required — the login ID of the person accountable for this EUser');
  else {
    const o = await findOwner(g.owner.trim());
    if (!o) errors.push('Actions: owner "' + g.owner + '" is not a record on this box');
    else if (!isPerson(o)) errors.push('Actions: owner "' + g.owner + '" is not a person (a signed-in user or admin) — machines, kiosks and portals cannot own actions');
  }
  if (!g.actions || typeof g.actions !== 'object' || Array.isArray(g.actions)) errors.push('Actions: "actions" must be an object, e.g. { "calc": {} }');
  else {
    if (Object.keys(g.actions).length > 50) errors.push('Actions: more than 50 actions');
    for (const [a, gr] of Object.entries(g.actions)) {
      if (!actionNames.includes(a)) { errors.push('Actions: "' + a + '" is not a registered action (registered: ' + actionNames.join(', ') + ')'); continue; }
      if (!gr || typeof gr !== 'object' || Array.isArray(gr)) { errors.push('Actions: the grant for "' + a + '" must be an object ({} for no options)'); continue; }
      for (const k of Object.keys(gr)) if (!ACTION_GRANT_KEYS.includes(k)) errors.push('Actions: "' + a + '" has an unknown option "' + k + '" (allowed: ' + ACTION_GRANT_KEYS.join(', ') + ')');
      if (gr.targets !== undefined) {
        if (!Array.isArray(gr.targets) || gr.targets.length > 50) errors.push('Actions: "' + a + '".targets must be a list of at most 50');
        // 1.3.0: email targets are addresses, each on this box's MAIL_ALLOW (grants only shrink)
        // 1.4.0: send targets = whom it may send to; messages targets = who may send to it — identity names (both sides must allow)
        else if (a === 'send' || a === 'messages') { for (const t of gr.targets) if (typeof t !== 'string' || !NAME.test(t)) errors.push('Actions: "' + a + '" target ' + JSON.stringify(t) + ' must be an identity name (a-z, 0-9, -; starts with a letter), e.g. u-abc123'); }
        else if (a === 'email') { for (const t of gr.targets) { if (typeof t !== 'string' || t !== t.toLowerCase() || !smtp.ADDR.test(t)) errors.push('Actions: "email" target ' + JSON.stringify(t) + ' must be ONE lower-case plain address (name@example.com)'); else if (!mailAllow.includes(t)) errors.push('Actions: "email" target ' + t + ' is not on this box\'s mail allow-list (MAIL_ALLOW in create()\'s env)'); } }
        else for (const t of gr.targets) if (typeof t !== 'string' || !/^(http:\/\/)?[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/.test(t)) errors.push('Actions: "' + a + '" target ' + JSON.stringify(t) + ' must be a lower-case host name, optionally :port (https); write http://host for plain http');   // 1.6.0 (F09)
      }
      if (gr.allowTainted !== undefined && typeof gr.allowTainted !== 'boolean') errors.push('Actions: "' + a + '".allowTainted must be true or false');
      if (gr.strictControl !== undefined && typeof gr.strictControl !== 'boolean') errors.push('Actions: "' + a + '".strictControl must be true or false');
    }
  }
  if (g.models !== undefined && (!Array.isArray(g.models) || g.models.length > 20 || g.models.some((m) => typeof m !== 'string' || !m || m.length > 100))) errors.push('Actions: "models" must be a list of model names');
  if (g.rate !== undefined && !(Number.isInteger(g.rate) && g.rate >= 1 && g.rate <= 10000)) errors.push('Actions: "rate" must be a whole number 1–10000 (messages per minute)');
  // 1.6.0 (label rule A): a person-operated EUser may not also hold an action that brings web or model text — a program could relay it
  if (g.operatedByPerson !== undefined && typeof g.operatedByPerson !== 'boolean') errors.push('Actions: "operatedByPerson" must be true or false');
  else if (g.operatedByPerson === true && g.actions && typeof g.actions === 'object' && !Array.isArray(g.actions)) { const bad = relayRisk(g.actions);
    if (bad.length) errors.push('Actions: "operatedByPerson": true is not allowed together with ' + bad.join(', ') + ' (it brings web or model text into this machine itself, which a program could pass on as the person\'s)'); }
  if (errors.length) return { ok: false, value: null, errors };
  const owner = await findOwner(g.owner.trim());
  const norm = { owner: g.owner.trim(), ownerId: owner.uniqueId, actions: g.actions };   // 1.1.0: the PERSON, not the name
  if (g.models !== undefined) norm.models = g.models;
  if (g.rate !== undefined) norm.rate = g.rate;
  if (g.operatedByPerson === true) norm.operatedByPerson = true;   // 1.6.0
  return { ok: true, value: JSON.stringify(norm, null, 1), errors: [] };
}

// 1.9.0 (v0.53.8): what create() refuses, before anything is created — an option name it does not know (one that was renamed is told its new
// name, from RENAMED_OPTIONS: the old name is data, the message is the one 1.8.0 gave), and a model list with no model server address:
// if models is given, modelUrl is required. An unknown name is echoed only stripped to word characters and cut at 40 (caller text, as targets.js)
const CREATE_OPTIONS = ['prisma', 'models', 'modelUrl', 'productName', 'appDir', 'fetchImpl', 'log', 'actionsDir', 'env', 'daemon', 'mailTls', 'triggersFile', 'clock'];
const RENAMED_OPTIONS = { ollamaUrl: { to: 'modelUrl', removedIn: '0.53.7' } };
function checkOptionNames(opts) {
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) throw new Error('create(): the options must be an object');
  for (const k of Object.keys(opts)) {
    if (Object.hasOwn(RENAMED_OPTIONS, k)) throw new Error('create(): ' + k + ' was removed in ' + RENAMED_OPTIONS[k].removedIn + ' — pass ' + RENAMED_OPTIONS[k].to);
    if (!CREATE_OPTIONS.includes(k)) throw new Error('create(): unknown option "' + String(k).replace(/[^\w$]/g, '').slice(0, 40) + '" — the options are ' + CREATE_OPTIONS.join(', '));
  }
}

// 1.9.0 (v0.53.8): the model action's handler, built from the host's model server address. create() builds it; it is exported so
// the suite reaches its guard directly (with rule 3 in place, create() never builds it without one). A blank address is no address.
function modelAdapter({ modelUrl, fetchImpl }) {
  return async function modelGenerate({ model, prompt, system }) {
    // 1.8.0 (v0.53.7): no model server address → a plain refusal, not a TypeError from undefined
    if (typeof modelUrl !== 'string' || !modelUrl.trim()) throw new Error('the model action has no model server address: the host did not pass modelUrl to create()');
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 115000);
    try {
      const r = await (fetchImpl || globalThis.fetch)(modelUrl.replace(/\/$/, '') + '/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
        body: JSON.stringify({ model, prompt, system, stream: false, options: { temperature: 0.2 } }) });
      if (!r.ok) throw new Error('the model server answered ' + r.status);
      const j = await r.json();
      return String(j.response || '');
    } finally { clearTimeout(to); }
  };
}

function create(opts = {}) {
  checkOptionNames(opts);
  const { prisma, models, modelUrl, productName, appDir = __dirname, fetchImpl, log = console, actionsDir = ACTIONS_DIR, env = process.env, daemon, mailTls, triggersFile, clock } = opts;
  // 1.7.0 (v0.53.6): productName — the host's name on the wire (core/product.js; default ACTBUS); modelUrl — the model server's URL.
  const product = checkProduct(productName);
  if (models !== undefined && (typeof modelUrl !== 'string' || !modelUrl.trim())) throw new Error('create(): models is given, so modelUrl is required — pass the model server\'s URL as modelUrl');
  const LOG = path.join(appDir, 'logs', 'act.jsonl');
  const FILES_ROOT = path.join(appDir, 'act-files');
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.mkdirSync(FILES_ROOT, { recursive: true, mode: 0o700 });

  // 1.2.0: the script engine — state in act-files/s-<identity>/ (the file action's folders are act-files/u-<id>/), each state write
  // audited (writeLine is defined below; the engine only calls it when a script runs, after create() has returned)
  // 1.3.0: scripts run in a separate daemon per identity unless PK_DAEMON=0; its start/stop/crash/pause lines go to the same log
  const pick = (rec, keys) => Object.fromEntries(keys.filter((k) => rec[k] !== undefined).map((k) => [k, rec[k]]));
  const engine = createEngine({ stateRoot: FILES_ROOT, daemon: daemon !== undefined ? daemon : env.PK_DAEMON !== '0', productName: product,
    audit: (rec) => writeLine({ t: new Date().toISOString(), node: 'local', outcome: rec.kind, ...pick(rec, ['identity', 'key', 'labels', 'size', 'pid', 'permission', 'why', 'code', 'signal', 'inWindow', 'crashes', 't', 'runId']) }) });
  // 1.3.0: mail settings come from the environment (the live .env, written by the owner); a problem turns mail OFF, never the server
  const mailProblems = [];
  let mailAllow = [], adapter = null;
  try { mailAllow = parseAllow(env.MAIL_ALLOW); } catch (e) { mailProblems.push(e.message + ' — every mail is refused until it is fixed'); }
  try { adapter = smtp.fromEnv(env, { tlsOptions: mailTls, productName: product }); } catch (e) { mailProblems.push('mail delivery is off: ' + e.message); }
  for (const p of mailProblems) log.error('[act] ' + p);
  // The registry: refused files are reported and left out; runsAs (service identities) is enabled for SCRIPTS only (1.2.0) —
  // 1.9.1 (v0.54.2): that refusal is the registry's own (registry.check), so make-registry.js refuses the same set as this load.
  const loaded = registry.load(actionsDir, 'registry.json', { scriptEngine: engine });
  const refused = loaded.refused.slice();
  for (const r of refused) log.error('[act] action refused: ' + r.name + ' — ' + r.reason);
  const actionList = [...loaded.actions.values()];
  const actionNames = actionList.map((e) => e.name);

  // Models: the name service routes a model name to this node when the model server has it (the box's model list), else no route.
  const modelGenerate = modelAdapter({ modelUrl, fetchImpl });
  class SynthNames extends Names {
    resolve(kind, name) {
      if (kind === 'model') return models && models.isInstalled(name) ? { node: this.self, handler: modelGenerate } : null;
      return super.resolve(kind, name);
    }
  }
  let who = new Map();                     // identity name → login ID, for the audit's "who"
  // 1.1.0: one audit line is at most 4 KB — long fields are cut, and the line says so
  const cap = (j) => { let s = JSON.stringify(j); if (s.length <= 4096) return s;
    for (const k of Object.keys(j)) if (typeof j[k] === 'string' && j[k].length > 200) j[k] = j[k].slice(0, 200) + '…';
    j.truncated = true; s = JSON.stringify(j); return s.length <= 4096 ? s : JSON.stringify({ t: j.t, node: j.node, outcome: j.outcome, code: j.code, who: j.who, truncated: true }); };
  const appendLog = appender(LOG);                                  // 1.6.0 (F05): every audit line is on disk (fsync) before it returns
  const writeLine = (obj) => appendLog(cap(obj));
  // 1.3.0: the outbox (act-files/.outbox/ — a dot folder, so no identity can own it); its lines go to logs/act.jsonl
  const outbox = new Outbox({ dir: path.join(FILES_ROOT, '.outbox'), allow: mailAllow, adapter, clock: clock || Date.now, productName: product,
    audit: (rec) => { const { kind, time, ...rest } = rec; writeLine({ t: time || new Date().toISOString(), node: 'local', outcome: kind, ...rest }); } });
  outbox.start(30000);
  // 1.4.0: the mailboxes (act-files/.mailbox/ — a dot folder, so no identity can own it); its lines go to logs/act.jsonl ('sent' is
  // written BEFORE the message: no line, no message)
  const mailbox = new Mailbox({ dir: path.join(FILES_ROOT, '.mailbox'), clock: clock || Date.now,
    audit: (rec) => { const { kind, time, ...rest } = rec; writeLine({ t: time || new Date().toISOString(), node: 'local', outcome: kind, ...rest }); } });
  const finish = (trace, r) => { try { mailbox.finish(trace, !!(r && r.ok)); } catch (e) { log.error('[act] mailbox', e.message); } };
  const hold = (trace) => { try { mailbox.hold(trace); } catch (e) { log.error('[act] mailbox', e.message); } };   // 1.6.0 (ACK)
  const release = () => { try { mailbox.releaseStale(); } catch (e) { log.error('[act] mailbox', e.message); } };
  release();                                                         // claims left by a crash or restart
  const mbTimer = setInterval(release, 60000); mbTimer.unref();
  // 1.5.0: the ONE door to the web for actions — closed while the Admin kill switch is on (the same file websearch.js reads)
  const KILL = path.join(appDir, '.web-egress-disabled');
  const webOff = () => fs.existsSync(KILL);
  const webFetch = (url, opt) => { if (webOff()) return Promise.reject(new Error('web access is switched off on this box (Admin › Pull the plug) — nothing was fetched')); return (fetchImpl || globalThis.fetch)(url, opt); };
  const bus = new Bus({
    registry: loaded.actions, identities: new Map(), names: new SynthNames('local'), node: 'local', filesRoot: FILES_ROOT, fetch: webFetch, outbox, mailbox, productName: product,
    // fail closed: if this throws, the bus refuses to run the action
    audit: (line) => { const j = JSON.parse(line); j.who = (j.authority || [j.from]).filter(Boolean).map((n) => who.get(n) || n); appendLog(cap(j)); },   // 1.6.0 (F05)
  });

  // Every request reads the grants fresh from the database: an admin's change applies to the next call.
  const UNENFORCED = (names) => 'targets are listed for ' + names.join(', ') + ', but the kernel does not judge targets for ' + (names.length > 1 ? 'these actions' : 'this action') + ' (no targetForm in the registry) — remove the targets, or register a form';
  async function loadIdentities() {
    const rows = await prisma.user.findMany({ where: { actGrants: { not: null } } });
    const list = [], names = new Map(), problems = {}, owners = new Map();
    for (const u of rows) {
      if (!u || !u.actGrants || u.role !== 'euser') continue;
      const me = idName(u); if (!me) continue;
      let g; try { g = JSON.parse(u.actGrants); } catch (_) { problems[me] = 'this EUser\'s Actions setting is not valid JSON — fix it on its Admin page'; continue; }
      // 1.1.0: valid JSON of the wrong shape ('null', a list, a number) is this record's problem only
      if (!g || typeof g !== 'object' || Array.isArray(g) || !g.actions || typeof g.actions !== 'object' || Array.isArray(g.actions)) { problems[me] = 'this EUser\'s Actions setting is not an object with "actions" — save it again on its Admin page'; continue; }
      // 1.1.0: the owner is the PERSON saved with the grant (uniqueId), so a rename keeps it and a reused name cannot inherit it
      if (typeof g.ownerId !== 'string' || !g.ownerId) { problems[me] = 'this EUser\'s Actions setting has no owner id — save it again on its Admin page'; continue; }
      // 1.3.0: an email grant naming an address that is not (or no longer) on MAIL_ALLOW refuses this EUser — fail closed
      if (g.actions.email && Array.isArray(g.actions.email.targets)) { try { checkGrants(new Map([[me, { actions: { email: g.actions.email } }]]), mailAllow); } catch (e) { problems[me] = e.message + ' — fix MAIL_ALLOW or this EUser\'s Actions'; continue; } }
      // 1.6.1 (v0.53.2, second-reader review, round 1): targets the KERNEL would not enforce (the action declares no targetForm) refuse this EUser — fail closed
      const unenf = targets.unenforced(g.actions, (a) => loaded.actions.get(a));
      if (unenf.length) { problems[me] = UNENFORCED(unenf); continue; }
      let o = owners.get(g.ownerId);
      if (o === undefined) { o = await prisma.user.findUnique({ where: { uniqueId: g.ownerId } }); owners.set(g.ownerId, o || null); }
      if (!isPerson(o)) { problems[me] = 'the owner of this EUser\'s Actions setting ("' + g.owner + '") is no longer a person on this box'; continue; }
      const on = idName(o); if (!on) continue;
      if (!names.has(on)) { list.push({ name: on, kind: 'person', owner: on, actions: {} }); names.set(on, o.loginId); }
      // 1.6.0: the person flag is re-checked at LOAD (an action's registration may have changed since the save) — fail closed
      const tainting = g.operatedByPerson === true ? relayRisk(g.actions) : [];   // review R1 M2: the SAME rule as at save (taintSources)
      if (tainting.length) { problems[me] = 'this EUser is marked operatedByPerson but also holds ' + tainting.join(', ') + ' (web or model text) — fix it on its Admin page'; continue; }
      list.push({ name: me, kind: 'euser', owner: on, actions: g.actions || {}, models: g.models || [], rate: g.rate || 120, operatedByPerson: g.operatedByPerson === true });
      names.set(me, u.loginId);
    }
    let ids;
    try { ids = caps.fromList(list); } catch (e) {
      // one bad record must not take the others down: keep every identity that is valid on its own
      ids = new Map();
      for (const i of list) { try { const m = caps.fromList(list.filter((x) => x.name === i.name || x.name === i.owner)); if (m.has(i.name)) ids.set(i.name, m.get(i.name)); } catch (er) { problems[i.name] = er.message; } }
    }
    return { ids, names, problems };
  }

  // 1.1.0: who could RECEIVE model or web text from this box? Those labels then travel with every OTHER world action it
  // calls — a key holder cannot launder a page it fetched by sending it back unlabelled (the program holding the key may be
  // a simple relay, and injected text would travel through it). Calling the source action itself (fetch → fetch) adds nothing.
  const TAINTS = ['model', 'web'];
  function taintSources(grants, calling) {   // → { labels: [...], from: [action names that bring them] }
    const out = new Set(), from = [];
    for (const a of Object.keys(grants || {})) {
      if (a === calling) continue;
      const e = loaded.actions.get(a); if (!e) continue;
      if (TAINTS.includes(e.produces)) { out.add(e.produces); from.push(a); }
      // file-read returns what was stored; tainted text can only have been stored where file-append accepts it
      else if (a === 'file-read' && grants['file-append'] && grants['file-append'].allowTainted === true) { TAINTS.forEach((t) => out.add(t)); from.push(a); }
      // 1.4.1 (H1): a message may carry web or model text (its labels travel to this reader, who could pass the text on unlabelled)
      else if (a === 'messages') { TAINTS.forEach((t) => out.add(t)); from.push(a); }
      // third check C1/C2: a SCRIPT's reply may carry web/model text another run REMEMBERED (state is per runsAs identity, invisible to the
      // load-time reach analysis) — so every granted script is a source, like messages (warnings over-count; live has no scripts installed)
      // registry 1.2.3: a script is a source when it reads memory that may hold web/model text, or reaches a source OTHER than the action
      // being called (as for the actions themselves: calling the source action itself adds nothing)
      else if (e.kind === 'script' && (!e.reach || !Array.isArray(e.reach.taintVia) || e.reach.stateTaint || e.reach.taintVia.some((x) => x !== calling))) { TAINTS.forEach((t) => out.add(t)); from.push(a); }
    }
    return { labels: [...out], from };
  }
  // review R1 M2: what a person-operated EUser may NOT also hold — every source taintSources knows of (fetch, model, file-read over a tainted
  // file-append …) EXCEPT messages: reading messages and answering them is what a person-operated phone is for. That is the stated trust
  // claim — what it sends is labelled person even after it has READ web/model text, because an admin says a person writes it.
  // re-review N2: file-read ALWAYS counts here — file.js reads a file with no labels sidecar (or an old one written under a wider grant) as web
  const relayRisk = (acts) => [...new Set([...taintSources(acts, 'send').from.filter((a) => a !== 'messages'), ...(acts && acts['file-read'] ? ['file-read'] : [])])];
  // 1.1.0: EVERY request counts against the EUser's rate before anything else is done or logged (refusals included)
  const hits = new Map();
  function overRate(me, rate) { const now = Date.now(); const w = (hits.get(me) || []).filter((x) => now - x < 60000); const over = w.length >= rate; if (!over) w.push(now); hits.set(me, w); return over; }
  // refusals made here are logged, at most 10 a minute per EUser; the next logged line says how many were not (a flood of
  // refused requests cannot fill the disk, whatever rate an admin granted)
  const refLog = new Map();
  const refuseHere = (res, status, code, error, me, loginId, action) => {
    const now = Date.now(); const k = me || 'none'; let c = refLog.get(k);
    if (!c || now - c.t0 >= 60000) c = { t0: now, n: 0, skipped: c ? c.skipped : 0 };
    c.n++; refLog.set(k, c);
    if (c.n <= 10) {
      try { writeLine({ t: new Date().toISOString(), node: 'local', outcome: 'refused', where: 'route', code, reason: error, from: me, who: [loginId], action: typeof action === 'string' ? action.slice(0, 64) : undefined, notLogged: c.skipped || undefined }); c.skipped = 0; } catch (_) {}
    } else c.skipped++;
    return res.status(status).json({ ok: false, code, error });
  };

  async function route(req, res) {
    const u = req.euser;
    const me = idName(u);
    let L;
    try { L = await loadIdentities(); } catch (e) { log.error('[act] identities', e.message); return refuseHere(res, 500, 'IDENTITIES', 'the identities could not be read — nothing was run', me, u && u.loginId); }
    const mine = me && L.ids.get(me);
    if (overRate(me || 'none', mine ? mine.rate : 30)) return res.status(429).json({ ok: false, code: ERR.RATE, error: 'too many requests per minute for this EUser' });   // not logged: that is the flood
    if (!mine) return refuseHere(res, 403, ERR.NOT_PERMITTED, L.problems[me] || 'no actions are granted to this EUser (Admin › Edit › Actions)', me, u && u.loginId);
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.action !== 'string') return refuseHere(res, 400, ERR.BAD_ENVELOPE, 'body must be JSON: { "action": "…", "input": { … } }', me, u.loginId);
    if (!NAME.test(b.action)) return refuseHere(res, 400, ERR.BAD_ENVELOPE, 'action must be a name (a-z, 0-9, -; at most 48 characters)', me, u.loginId, b.action);
    if (b.labels !== undefined && (!Array.isArray(b.labels) || b.labels.length > 6)) return refuseHere(res, 400, ERR.BAD_ENVELOPE, 'labels must be a list of at most 6', me, u.loginId, b.action);
    for (const [k, v] of L.names) who.set(k, v);                     // 1.6.0 (F04): no shared snapshot; names only grow (audit display)
    const entry = loaded.actions.get(b.action);
    // 1.2.0, rule (b) (ACTBUS docs/proteus-k.md §8 item 5): a script that declares NO input cannot carry anything back in — its call is not escalated
    const scriptNoInput = !!entry && entry.kind === 'script' && Object.keys(entry.input || {}).length === 0;
    // 1.4.1 (H1): send is escalated like a world action — a message is how text would leave this EUser for another identity
    const sends = !!entry && (b.action === 'send' || entry.kind === 'script');   // 1.4.2 send · 1.4.3 (R4): any script (scriptNoInput below still exempts one that declares no input)
    // 1.6.0 (rule A): a person-operated EUser's own send is not escalated; it carries `person` (the trust claim, stated by an admin)
    const personSend = b.action === 'send' && mine.operatedByPerson === true;
    const src = entry && (entry.world || sends) && !scriptNoInput && !personSend ? taintSources(mine.actions, b.action) : { labels: [], from: [] };
    const extra = personSend ? ['person'] : src.labels;
    let r; const trace = crypto.randomUUID();                         // 1.4.0: what this run reads is claimed for this trace
    try { r = await bus.ask(me, b.action, b.input === undefined ? {} : b.input, { labels: [...(Array.isArray(b.labels) ? b.labels : []), ...extra], id: typeof b.id === 'string' ? b.id : undefined, trace, ids: L.ids }); }
    catch (e) { log.error('[act]', e.message); return res.status(500).json({ ok: false, code: 'INTERNAL', error: 'the action could not be run' }); }
    finally { if (b.action === 'messages' && r && r.ok && b.input && b.input.hold === true) hold(trace); else finish(trace, r); }   // 1.6.0 (ACK, opted into with hold: true — review R1 L4)
    if (!r.ok && r.code === ERR.TAINTED && extra.length) r.error += ' — this EUser can also receive ' + extra.join(' and ') + ' text from this box (' + src.from.join(', ') + '), so its world actions carry those labels';
    if (!r.ok && r.transient === true && typeof res.set === 'function') res.set('Retry-After', retryAfter(r));   // 1.6.2: the run never started · 1.9.2: when it clears, if known (else 5 s)
    return res.status(r.ok ? 200 : (STATUS[r.code] || 400)).json(r);
  }

  // 1.3.0 (slice 3): triggers — act/actions/triggers.json, written by make-registry.js from triggers.spec.json (the admin's approval).
  // No file = nothing is scheduled. A fire is a message from the trigger's runsAs EUser through the SAME bus checks (grants read fresh).
  // The kill switch: `node act/trigger-off.js <id>` drops act-files/.scheduler/off/<id>; the next tick switches it off (kept across
  // restarts; ON again only when that trigger's entry in the file changes).
  let scheduler = null, schedTimer = null; const schedProblems = [];
  const TRIG = triggersFile || path.join(actionsDir, 'triggers.json'), OFFDIR = path.join(FILES_ROOT, '.scheduler', 'off');
  if (fs.existsSync(TRIG)) {
    try {
      const spec = JSON.parse(fs.readFileSync(TRIG, 'utf8'));
      const schedBus = { ask: async (from, action, input, meta) => { const L = await loadIdentities(); for (const [k, v] of L.names) who.set(k, v); const trace = crypto.randomUUID(); let r;   // 1.4.0 · 1.6.0 (F04)
        try { r = await bus.ask(from, action, input, { ...meta, trace, ids: L.ids }); return r; } finally { finish(trace, r); } } };
      scheduler = new Scheduler({ bus: schedBus, spec, stateDir: path.join(FILES_ROOT, '.scheduler'), clock: clock || Date.now,
        pending: (id, topic) => mailbox.pending(id, topic),   // 1.4.0: on-message triggers
        audit: (rec) => { const { kind, ...rest } = rec; writeLine({ t: new Date().toISOString(), node: 'local', outcome: kind, ...rest }); } });
      for (const x of scheduler.refused) schedProblems.push('trigger ' + x.id + ' refused: ' + x.reason);
    } catch (e) { scheduler = null; schedProblems.push('the scheduler is OFF: ' + e.message); }
    for (const p of schedProblems) log.error('[act] ' + p);
  }
  function applyOff() {
    let names = []; try { names = fs.readdirSync(OFFDIR); } catch (_) { return; }
    for (const n of names) {
      if (!scheduler.switchOff(n, 'trigger-off.js')) writeLine({ t: new Date().toISOString(), node: 'local', outcome: 'trigger-off-unknown', id: String(n).slice(0, 64) });
      try { fs.unlinkSync(path.join(OFFDIR, n)); } catch (_) {}
    }
  }
  function schedTick() { release(); if (!scheduler) return Promise.resolve([]); applyOff(); return scheduler.tick(); }
  if (scheduler) { schedTimer = setInterval(() => { Promise.resolve().then(schedTick).catch((e) => log.error('[act] scheduler', e.message)); }, 15000); schedTimer.unref(); }
  function stop() { clearInterval(mbTimer); if (schedTimer) clearInterval(schedTimer); schedTimer = null; outbox.stop(); engine.close(); }

  async function saveGrants(target, text, adminLoginId) {
    if (!target || target.role !== 'euser') return { ok: false, errors: ['Actions are only for EUser (machine) records'] };
    const p = await parseGrants(text, { actionNames, mailAllow, relayRisk, findOwner: (id) => prisma.user.findUnique({ where: { loginId: id } }) });
    if (!p.ok) return p;
    // 1.6.1 (v0.53.2): the same fail-closed rule as at load — never save targets the kernel would not enforce
    { const unenf = p.value ? targets.unenforced((JSON.parse(p.value) || {}).actions, (a) => loaded.actions.get(a)) : []; if (unenf.length) return { ok: false, errors: [UNENFORCED(unenf)] }; }
    // the change is logged FIRST (fail closed, like every action): no log line, no change
    writeLine({ t: new Date().toISOString(), node: 'local', outcome: 'grants', by: adminLoginId, for: target.loginId, identity: idName(target), grants: p.value ? JSON.parse(p.value) : null });
    await prisma.user.update({ where: { uniqueId: target.uniqueId }, data: { actGrants: p.value } });
    return p;
  }

  // 1.1.0: a record that stops being an EUser loses its grants — logged first, like every grants change
  async function clearForRoleChange(before, newRole, adminLoginId) {
    if (!before || before.role !== 'euser' || newRole === 'euser' || !before.actGrants) return false;
    writeLine({ t: new Date().toISOString(), node: 'local', outcome: 'grants', by: adminLoginId, for: before.loginId, identity: idName(before), grants: null, reason: 'role changed from euser to ' + newRole });
    await prisma.user.update({ where: { uniqueId: before.uniqueId }, data: { actGrants: null } });
    return true;
  }

  function recent(u, n = 15) {
    const me = idName(u); if (!me) return [];
    let text = '';
    try { const st = fs.statSync(LOG); const fd = fs.openSync(LOG, 'r'); const len = Math.min(st.size, 256 * 1024); const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); text = buf.toString('utf8'); } catch (_) { return []; }
    return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } })
      .filter((j) => j && (j.identity === me || (Array.isArray(j.authority) ? j.authority.includes(me) : j.from === me)) && j.outcome !== 'run').slice(-n).reverse();
  }

  // 1.3.0: this EUser's triggers and mail, and the box's mail/scheduler state (read-only; switch-off: node act/trigger-off.js <id>)
  const when = (t) => t.msg ? 'on a message, topic ' + t.msg : t.every ? 'every ' + t.every + ' s' : 'at ' + t.at + ' ' + t.tz + (t.days ? ' ' + t.days : '');
  const utc = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
  function slice3Html(u, esc) {
    const me = idName(u);
    const trig = scheduler ? scheduler.status().filter((t) => t.runsAs === me) : [];
    let mails = []; try { mails = outbox.list().filter((m) => m.identity === me).slice(-10).reverse(); } catch (_) {}
    let ml = []; try { ml = me ? mailbox.list(me).slice(-20).reverse() : []; } catch (_) {}   // 1.4.0
    const mlr = ml.map((m) => `<tr><td class="muted">${esc(utc(m.at))}</td><td><code>${esc(m.from)}</code></td><td><code>${esc(m.topic)}</code></td><td>${m.status === 'dead' ? '<strong>dead</strong>' : esc(m.status)}${m.attempts ? ' · ' + m.attempts + ' failed run' + (m.attempts > 1 ? 's' : '') : ''}</td><td class="muted"><code>${esc(m.id)}</code></td><td class="muted">${esc((m.labels || []).join(', '))}</td></tr>`).join('');
    const box = `<p class="muted" style="font-size:.8rem">Mail on this box: delivery ${adapter ? 'ON (' + esc(adapter.name) + ', from ' + esc(adapter.from) + ')' : 'OFF — mail stays queued'} · MAIL_ALLOW: ${mailAllow.length} address(es) · scripts run ${engine.supervisor ? 'in separate daemons' : 'in the server process'} · scheduler: ${scheduler ? scheduler.status().length + ' trigger(s)' : 'no triggers file'} · web for actions: ${webOff() ? '<strong>OFF</strong> (Admin kill switch)' : 'on'}</p>`;
    const probs = [...mailProblems, ...schedProblems].map((p) => `<p class="sub" style="color:#ff5d73">${esc(p)}</p>`).join('');
    const tr = trig.map((t) => `<tr><td><code>${esc(t.id)}</code></td><td><code>${esc(t.script)}</code></td><td>${esc(when(t))}</td><td>${t.on ? 'on' : '<strong>OFF</strong>'}${t.running ? ' · running' : ''}</td><td class="muted">${esc(utc(t.last))}</td><td class="muted">${esc(utc(t.next))}</td></tr>`).join('');
    const mr = mails.map((m) => `<tr><td class="muted">${esc(utc(m.createdAt))}</td><td>${esc(m.to)}</td><td>${esc(String(m.subject).slice(0, 80))}</td><td>${esc(m.status)}${m.attempts ? ' · ' + m.attempts + ' tr' + (m.attempts > 1 ? 'ies' : 'y') : ''}</td><td class="muted">${esc((m.labels || []).join(', '))}</td></tr>`).join('');
    return `<div class="section-title" style="margin-top:14px">Triggers (runs as this EUser)</div>${box}${probs}`
      + (tr ? `<table style="width:100%;font-size:.8rem"><tr class="muted"><td>trigger</td><td>script</td><td>when</td><td>state</td><td>last</td><td>next</td></tr>${tr}</table><p class="muted" style="font-size:.75rem">Switch a trigger off on the box: <code>node act/trigger-off.js &lt;trigger&gt;</code> — on again only by changing its entry in act/actions/triggers.spec.json and re-running make-registry.js.</p>` : '<p class="muted" style="font-size:.85rem">No triggers run as this EUser.</p>')
      + `<div class="section-title" style="margin-top:14px">Mail (sent as this EUser, newest first)</div>`
      + (mr ? `<table style="width:100%;font-size:.8rem"><tr class="muted"><td>queued</td><td>to</td><td>subject</td><td>status</td><td>labels</td></tr>${mr}</table>` : '<p class="muted" style="font-size:.85rem">None.</p>')
      + `<div class="section-title" style="margin-top:14px">Mailbox (messages to this EUser, newest first)</div>`
      + (mlr ? `<table style="width:100%;font-size:.8rem"><tr class="muted"><td>sent</td><td>from</td><td>topic</td><td>state</td><td>id</td><td>labels</td></tr>${mlr}</table><p class="muted" style="font-size:.75rem">A message is removed when the run that read it succeeds (a key holder reading it itself with hold: true: when it acknowledges the id — else delivered again after 10 min); dead = 3 failed runs, or its sender is no longer accepted (kept for inspection, never delivered again).</p>` : '<p class="muted" style="font-size:.85rem">Empty.</p>');
  }

  const EXAMPLE = '{\n "owner": "<your login ID>",\n "actions": { "calc": {}, "units": {}, "date-diff": {} },\n "rate": 60\n}';
  function panelHtml(u, esc, opts = {}) {
    if (!u || u.role !== 'euser') return '';
    const cur = opts.text !== undefined ? opts.text : (u.actGrants || '');
    const rows = actionList.map((e) => `<tr><td><code>${esc(e.name)}</code></td><td>${esc(e.version)}</td><td>${esc(e.kind)}</td><td>${esc(e.produces)}</td><td>${e.world ? 'yes' : 'no'}</td><td><code>${esc(Object.entries(e.input).map(([k, t]) => k + ':' + t).join(' '))}</code></td><td class="muted">${esc(e.sha256.slice(0, 12))}</td></tr>`).join('');
    const ref = refused.length ? `<p class="sub" style="color:#ff5d73">Not loaded: ${refused.map((r) => esc(r.name + ' — ' + r.reason)).join('; ')}</p>` : '';
    // 1.2.0: what each script can reach, its literal targets and the warnings the admin accepted
    const scripts = actionList.filter((e) => e.kind === 'script').map((e) => `<li><code>${esc(e.name)}</code> runs as <code>${esc(e.runsAs)}</code> · reaches ${esc(e.reach.actions.join(', ') || 'nothing')}${e.reach.targets.length ? ' · targets ' + esc(e.reach.targets.join(', ')) : ''}${e.reach.warnings.length ? '<br><span class="muted">accepted: ' + esc(e.reach.warnings.join(' | ')) + '</span>' : ''}</li>`).join('');
    const log = recent(u).map((j) => `<tr><td class="muted">${esc(String(j.t || '').replace('T', ' ').slice(0, 19))}</td><td>${esc(j.outcome === 'grants' ? 'grants changed by ' + (j.by || '?') : j.action || '')}</td><td>${esc(j.outcome || '')}${j.code ? ' · ' + esc(j.code) : ''}</td><td class="muted">${esc(String(j.reason || (j.labelsOut ? 'labels ' + j.labelsOut.join('+') : '')).slice(0, 140))}</td></tr>`).join('');
    const s3 = slice3Html(u, esc);   // 1.3.0
    const errs = (opts.errors && opts.errors.length) ? `<div class="banner err"><strong>Not saved.</strong><ul style="margin:6px 0 0 18px">${opts.errors.map((e) => '<li>' + esc(e) + '</li>').join('')}</ul></div>` : '';
    return `<div class="panel" id="act">
      <h2>Actions (EUser) &mdash; <code>POST /api/act</code></h2>
      <p class="sub" style="margin-bottom:12px">Which registered actions this machine may run with its key, and on what. Empty = none (the default). Each action is a file an admin installed, pinned by its hash; the model never chooses one. Every call and every change here is written to <code>logs/act.jsonl</code>.</p>
      ${errs}
      <form method="post" action="/admin/euser/${encodeURIComponent(u.uniqueId)}/act">
        <label>Actions (JSON)<textarea name="actGrants" rows="9" spellcheck="false" style="font-family:ui-monospace,Menlo,monospace" placeholder="${esc(EXAMPLE)}">${esc(cur)}</textarea></label>
        <button>Save actions</button>
      </form>
      <p class="muted" style="font-size:.8rem;margin-top:8px"><code>owner</code> = the login ID of the person accountable for this machine (kept as that PERSON: if their login ID changes later, the grant stays with them; the text shows the name it was saved with). <code>targets</code> (fetch) = the only hosts it may reach (<code>host</code> = default port, <code>host:port</code> for another). <code>allowTainted: true</code> = it may pass model or web text into that world action — an explicit rule; leave it out unless you mean it. <code>strictControl: true</code> = refuse that world action when it would run under a model- or web-dependent condition. <code>models</code> = models the <code>model</code> action may use. <code>rate</code> = messages per minute (default 120). <code>operatedByPerson: true</code> = a PERSON operates this machine (e.g. a phone): what it sends is labelled <code>person</code>, not web/model — your claim, so only where it is true; not allowed with an action that brings web or model text into the machine itself (fetch, model, file-read). It MAY read messages: what it then sends is labelled person even if the message it read was web — that is exactly your claim that a person, not a program, writes what it sends.</p>
      <div class="section-title" style="margin-top:14px">Registered actions on this box</div>
      <table style="width:100%;font-size:.85rem"><tr class="muted"><td>action</td><td>version</td><td>kind</td><td>result is</td><td>reaches outside</td><td>input</td><td>sha256</td></tr>${rows}</table>
      ${ref}
      ${scripts ? `<div class="section-title" style="margin-top:14px">Scripts (PROTEUS-K)</div><ul style="font-size:.85rem;margin:4px 0 0 18px">${scripts}</ul>` : ''}
      <p class="muted" style="font-size:.8rem;margin-top:8px">This EUser's identity name: <code>${esc(idName(u) || '')}</code> — a script's <code>runsAs</code> names the EUser it runs as.</p>
      ${s3}
      <div class="section-title" style="margin-top:14px">Recent (this machine, newest first)</div>
      ${log ? `<table style="width:100%;font-size:.8rem">${log}</table>` : '<p class="muted" style="font-size:.85rem">Nothing yet.</p>'}
    </div>`;
  }

  return { route, saveGrants, clearForRoleChange, panelHtml, loadIdentities, actionNames, refused, bus, LOG, FILES_ROOT,
    engine, outbox, mailbox, scheduler, schedTick, webOff, mailProblems, schedProblems, stop };   // 1.3.0
}

module.exports = { create, modelAdapter, parseGrants, idName, isPerson, GRANTS_MAX };
