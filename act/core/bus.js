// bus.js — v1.7.0 · the message bus: every check in order, then the audit line, then the action · changelog: act/CHANGELOG.md#actcorebusjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// ## Design
// the KERNEL judges targets before dispatch, by the entry's declared targetForm (core/targets.js) · F04 the identity snapshot belongs to the CALL (ask { ids } → dispatch(env, ids),
// children inherit it) — concurrent requests no longer share this.ids; F05 an audit FILE is written through durable.js (fsync per line:
// the "run" line is on disk before the run); F06 accepted ids are appended to <filesRoot>/.dedupe.jsonl and read back on start — a
// duplicate is still refused after a restart (compacted when it holds twice the live ids; a failed write refuses the message); the
// messages action may acknowledge (ctx.ackMessages, ACTBUS docs/functions-and-mailboxes.md §5)
// Send / Receive / Reply for every identity, action and node (ACTBUS docs/capability-architecture.md §1, §2, §9)
// 1.2.1 (self-review 30 Oct, S4): ctx.ctl() — the control labels this call was made under, so a script engine can start
// its run under them (read-only; an action cannot remove them: every child inherits env.ctl anyway).
// 1.2.0 (ACTBUS docs/proteus-k.md §8): an action of kind "script" (the PROTEUS-K interpreter) sends each child with the labels of the VALUES
// it passes (per-value, as CaMeL) and the labels of the conditions it runs under as ctl; every other kind keeps 1.1.0's
// conservative rule unchanged. ctl is inherited down the chain, written to the audit, and is taint only under strictControl.
// The envelope still adds the script's own input labels to every child — a script cannot drop what it was called with.
// Every message passes the same checks, in this order, and every outcome is written to the append-only audit log:
//   1 envelope well-formed      2 not a duplicate (id seen before)    3 trace budget (one event cannot fan out forever)
//   4 every identity in the authority chain exists                   5 rate (messages per minute, per root caller)
//   6 the action has a route (name service; slice 1 = local only)    7 EVERY identity in the chain holds the action
//   8 typed input               9 taint: model/web-labelled input never reaches a world action without an explicit rule
//   — then "run" is logged (fail closed: no log line, no run), the action runs with a timeout, and "ok"/"error" is logged.
// Child messages (an action calling another): same trace, one hop fewer, authority of the running action. At hops 0
// nothing more is sent — a loop A → B → A ends there. LABELS (slice 1, deliberately conservative): everything an action
// has received — its input and every reply it got — taints everything it sends and returns. The PROTEUS-K interpreter
// (slice 2) tracks labels per value, which is finer (as in CaMeL); native code cannot launder a label in slice 1.
// The clock is injected so a run can be replayed exactly: one clock, a log that replays.
'use strict';
const fs = require('fs'), path = require('path');
const env_ = require('./envelope');
const { appender } = require('./durable');   // 1.4.4 (F05)
const { productName: checkProduct } = require('./product');   // 1.5.0 (v0.53.6)
// slice 3 (1.3.4): the audit line of an email run names the recipient and subject and the body's sha256 and size — never the body
const sendInput = (i) => { const b = String((i && i.body) || ''); return { to: i && i.to, topic: i && i.topic, bodyBytes: Buffer.byteLength(b), bodySha256: require('crypto').createHash('sha256').update(b, 'utf8').digest('hex') }; };   // 1.4.1
const mailInput = (i) => { const text = String((i && i.text) || ''); return { to: i && i.to, subject: i && i.subject, textBytes: Buffer.byteLength(text), textSha256: require('crypto').createHash('sha256').update(text, 'utf8').digest('hex') }; };
const MINTED = new WeakSet();   // F-B 1.3.2: the child envelopes this bus made itself (ctx.send) — only those may carry a credential
const caps = require('./capabilities');
const targets = require('./targets');   // 1.4.5
const { checkInput } = require('./registry');

const TRANSIENT_CODES = new Set(['DAEMON_FULL', 'DAEMON_EVICTING', 'DAEMON_OVERLAP', 'DAEMON_PAUSED', 'DAEMON_RESTARTING']);   // 1.4.6 (= supervisor TRANSIENT) · 1.7.0: DEDUPE_FULL is not here: only a root is refused it, by refuse(), and nothing thrown carries it
const ERR = Object.freeze({
  BAD_ENVELOPE: 'BAD_ENVELOPE', DUPLICATE: 'DUPLICATE', BUDGET: 'BUDGET', UNKNOWN_IDENTITY: 'UNKNOWN_IDENTITY', RATE: 'RATE',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION', NO_ROUTE: 'NO_ROUTE', NOT_PERMITTED: 'NOT_PERMITTED', BAD_INPUT: 'BAD_INPUT',
  TAINTED: 'TAINTED', HOP_LIMIT: 'HOP_LIMIT', TIMEOUT: 'TIMEOUT', ACTION_ERROR: 'ACTION_ERROR', AUDIT: 'AUDIT', NO_TARGET: 'NO_TARGET',
  DAEMON_FULL: 'DAEMON_FULL', DAEMON_EVICTING: 'DAEMON_EVICTING', DAEMON_OVERLAP: 'DAEMON_OVERLAP', DAEMON_PAUSED: 'DAEMON_PAUSED', DAEMON_RESTARTING: 'DAEMON_RESTARTING', DEDUPE_FULL: 'DEDUPE_FULL',   // 1.4.6: transient
});

class Bus {
  // registry: Map(name → entry with impl) · identities: Map · names: Names · auditFile: path (or audit: fn(line))
  // clock: () => ms · node: this node's name · traceBudget: max messages per trace · fetch: http fetch · filesRoot: folder · outbox: mail/outbox.js (or none: email refuses) · mailbox: mailbox.js (or none)
  // productName: the host's name, given to every action as ctx.product (core/product.js; default ACTBUS)
  constructor({ registry, identities, names, auditFile, audit, clock = Date.now, node = 'local', traceBudget = 64, fetch, filesRoot, outbox, mailbox, dedupeMs = 86400000, dedupeCap = 50000, productName }) {
    this.product = checkProduct(productName);
    this.registry = registry; this.ids = identities; this.names = names; this.clock = clock; this.node = node;
    this.traceBudget = traceBudget; this.fetchImpl = fetch || globalThis.fetch; this.filesRoot = filesRoot || null; this.outbox = outbox || null; this.mailbox = mailbox || null;
    this.auditFile = auditFile || null; this.auditFn = audit || null; this.dedupeMs = dedupeMs; this.dedupeCap = dedupeCap;
    this.seen = new Map(); this.traces = new Map(); this.rates = new Map();
    this.appendAudit = this.auditFile ? appender(this.auditFile) : null;   // 1.4.4 (F05)
    // 1.4.4 (F06): the ids accepted in the last dedupeMs come back after a restart
    this.dedupeFile = this.filesRoot ? path.join(this.filesRoot, '.dedupe.jsonl') : null; this.dedupeLines = 0;
    if (this.dedupeFile) {
      let text = ''; try { text = fs.readFileSync(this.dedupeFile, 'utf8'); } catch (_) {}
      const now = this.clock();
      for (const l of text.split('\n')) { if (!l) continue; let j; try { j = JSON.parse(l); } catch (_) { continue; }
        if (!j || typeof j.f !== 'string' || typeof j.i !== 'string' || typeof j.t !== 'number' || now - j.t >= this.dedupeMs) continue;
        let m = this.seen.get(j.f); if (!m) { m = new Map(); this.seen.set(j.f, m); } m.delete(j.i); m.set(j.i, j.t); this.dedupeLines += 1; }
      // 1.6.0 (v0.54.3, the fifth cold read's #1): every id inside the window is kept, whatever dedupeCap — an identity that comes back
      // with more than the cap is refused DEDUPE_FULL until enough age out (1.5.0 cut each set to the cap here, whatever the ids' age)
    }
    // Every local action is the hash-checked registry entry — nothing else may be attached locally under its name (fix 1.1.0).
    for (const [name, entry] of registry) {
      const there = (names.table.get('action:' + name) || []).find((e) => e.node === node);
      if (there && there.handler !== entry) throw new Error('action ' + name + ' is already attached on this node by something other than the registry');
      if (!there) names.attach('action', name, node, entry);
    }
  }

  now() { return new Date(this.clock()).toISOString(); }
  audit(rec) {
    const line = JSON.stringify({ t: this.now(), node: this.node, ...rec });
    if (this.auditFn) this.auditFn(line);
    if (this.appendAudit) this.appendAudit(line);   // 1.4.4 (F05): on disk (fsync) before this returns
  }
  // 1.4.4 (F06): one accepted id → one line; rewritten (temp + rename) from the live ids when the file holds twice as many lines
  persistSeen(from, id, t) {
    if (!this.dedupeFile) return;
    fs.appendFileSync(this.dedupeFile, JSON.stringify({ f: from, i: id, t }) + '\n', { mode: 0o600 });
    this.dedupeLines += 1;
    let live = 0; for (const m of this.seen.values()) live += m.size;
    if (this.dedupeLines > 2 * live + 64) {
      const out = []; for (const [f, m] of this.seen) for (const [i, at] of m) if (t - at < this.dedupeMs) out.push(JSON.stringify({ f, i, t: at }));
      const tmpf = this.dedupeFile + '.tmp-' + process.pid;
      fs.writeFileSync(tmpf, out.join('\n') + (out.length ? '\n' : ''), { mode: 0o600 }); fs.renameSync(tmpf, this.dedupeFile);
      this.dedupeLines = out.length;
    }
  }
  // 1.6.0: is this identity at dedupeCap inside the window (ids older than the window dropped first, by age only)? → { n, h, retryAfterMs } or null
  dedupeFull(identity, now) {
    const mine = this.seen.get(identity); if (!mine) return null;
    while (mine.size && now - mine.values().next().value >= this.dedupeMs) mine.delete(mine.keys().next().value);
    if (mine.size < this.dedupeCap) return null;
    return { n: mine.size, h: Math.round(this.dedupeMs / 3600000 * 100) / 100, retryAfterMs: Math.max(1, mine.values().next().value + this.dedupeMs - now) };
  }
  remember(map, key, val, cap = 10000) { map.set(key, val); if (map.size > cap) map.delete(map.keys().next().value); }

  // A root message from the edge: the identity's kind earns its base label; the caller may only add labels.
  // 1.4.4 (F04): `ids` = the identity snapshot for THIS call (read fresh by the host); default = the bus's own (tests, fixed setups)
  ask(from, action, input = {}, { labels = [], hops, id, trace, ids = this.ids } = {}) {
    const who = ids.get(from);
    if (!who) return Promise.resolve(this.refuse(null, ERR.UNKNOWN_IDENTITY, 'unknown identity ' + JSON.stringify(from), { from, action }));
    let env;
    try { env = env_.root({ from, action, input, labels, kindLabel: caps.KIND_LABEL[who.kind], hops, id, trace, time: this.now() }); }
    catch (e) { return Promise.resolve(this.refuse(null, ERR.BAD_ENVELOPE, e.message, { from, action })); }
    return this.dispatch(env, ids);
  }

  refuse(env, code, reason, extra = {}) {
    const rec = { id: env && env.id, trace: env && env.trace, replyTo: env && env.replyTo, from: env ? env.from : extra.from, authority: env && env.authority,
      ...(env && env.ctl && env.ctl.length ? { ctl: env.ctl } : {}),
      action: env ? env.action : extra.action, hops: env && env.hops, labels: env && env.labels, outcome: 'refused', code, reason,
      ...(extra.transient === true ? { transient: true } : {}), ...(Number.isFinite(extra.retryAfterMs) ? { retryAfterMs: extra.retryAfterMs } : {}) };   // 1.6.0
    try { this.audit(rec); } catch { /* the refusal stands even if the log is unwritable */ }
    return { ok: false, id: rec.id, trace: rec.trace, action: rec.action, code, ...(rec.transient ? { transient: true } : {}), ...(rec.retryAfterMs !== undefined ? { retryAfterMs: rec.retryAfterMs } : {}), error: reason };
  }

  async dispatch(env, ids = this.ids) {   // 1.4.4 (F04): the identities belong to THIS dispatch, not to the shared bus
    // F-B 1.3.3: what the checks read must be what the run uses — a hand-built envelope (getters, Array subclasses) is copied as plain data
    if (!MINTED.has(env)) { try { env = structuredClone(env); } catch { return this.refuse(null, ERR.BAD_ENVELOPE, 'an envelope must be plain data', { action: '?' }); } }
    try { env_.check(env); } catch (e) { return this.refuse(null, ERR.BAD_ENVELOPE, e.message, { from: env && env.from, action: env && env.action }); }
    // F-B 1.3.2: roots come from the edge (envelope.root strips credentials); a child the bus made is in MINTED. Anything else carrying a
    // credential was built by hand — whatever its replyTo — and is refused
    if (!MINTED.has(env) && env.labels.some((l) => env_.CREDENTIALS.includes(l))) return this.refuse(env, ERR.BAD_ENVELOPE, 'a message the bus did not make may not carry the credential ' + env.labels.filter((l) => env_.CREDENTIALS.includes(l)).join('+'));
    // Duplicates are per SENDING identity and by time (fix 1.1.0): one identity's ids can neither block nor flush another's.
    // Guarantee (1.6.0): a root message's id is remembered for dedupeMs (default 24 h); a child the bus made is not (1.7.0). Nothing is ever dropped by count: an identity that holds
    // dedupeCap ids (default 50 000) inside the window is refused DEDUPE_FULL (transient) until its oldest leaves it. 1.5.0 dropped the oldest.
    const now = this.clock();
    // 1.7.0 (v0.54.4, the sixth cold read's #7): a child the bus made (ctx.send) has a fresh random id (envelope.child) that nobody can
    // send again, so it is not remembered and fills no identity's set: one caller cannot fill a shared script's identity for the others.
    // `mine` is a throwaway map for it, so the checks below read the same for every message
    const kept = !MINTED.has(env);
    let mine = kept ? this.seen.get(env.from) : new Map(); if (!mine) { mine = new Map(); this.seen.set(env.from, mine); }
    const prev = mine.get(env.id);
    if (prev !== undefined && now - prev < this.dedupeMs) return this.refuse(env, ERR.DUPLICATE, 'message ' + env.id + ' was already received from ' + env.from);
    while (mine.size && now - mine.values().next().value >= this.dedupeMs) mine.delete(mine.keys().next().value);   // only by age
    mine.delete(env.id);
    const full = kept ? this.dedupeFull(env.from, now) : null;
    if (full) return this.refuse(env, ERR.DEDUPE_FULL, env.from + ' has ' + full.n + ' ids inside the ' + full.h + ' h window — none can be forgotten yet; try again later', { transient: true, retryAfterMs: full.retryAfterMs });
    mine.set(env.id, now);
    try { if (kept) this.persistSeen(env.from, env.id, now); }   // 1.4.4 (F06): fail closed — an id that cannot be remembered is not run
    catch (e) { mine.delete(env.id); return this.refuse(env, ERR.AUDIT, 'the duplicate-id record is unwritable — nothing was run (' + e.message + ')'); }
    const n = (this.traces.get(env.trace) || 0) + 1; this.remember(this.traces, env.trace, n);
    if (n > this.traceBudget) return this.refuse(env, ERR.BUDGET, 'trace ' + env.trace + ' exceeded its budget of ' + this.traceBudget + ' messages');
    const unknown = env.authority.filter((a) => !ids.has(a));
    if (unknown.length) return this.refuse(env, ERR.UNKNOWN_IDENTITY, 'unknown identity in the chain: ' + unknown.join(', '));
    // 1.7.0 (v0.54.4): the caller who caused the work pays for it — a child the bus made counts against the ROOT caller's rate
    // (authority[0]), not the identity it is sent as, so a script identity has no rate of its own for its callers to share. A time
    // trigger's root is its runsAs identity, so a trigger's calls count against that identity: the trigger pays for its own work
    const payer = kept ? env.from : env.authority[0];
    const t = this.clock(), win = (this.rates.get(payer) || []).filter((x) => t - x < 60000);
    if (win.length >= ids.get(payer).rate) return this.refuse(env, ERR.RATE, payer + ' exceeded ' + ids.get(payer).rate + ' messages per minute' + (kept ? '' : ' (a call made for it by ' + env.from + ')'));
    win.push(t); this.rates.set(payer, win);

    const route = this.names.resolve('action', env.action);
    if (!route) return this.refuse(env, ERR.UNKNOWN_ACTION, 'no action named ' + env.action);
    if (route.node !== this.node) return this.refuse(env, ERR.NO_ROUTE, env.action + ' is served by node ' + route.node + ' — slice 1 routes locally only');
    const entry = route.handler;
    // runsAs: a service identity — the chain grows by it FIRST, and every check below is made on the grown chain, so
    // the service must itself hold the action, its targets and its taint rule (fix 1.1.0: they were not checked).
    let authority = env.authority;
    if (entry.runsAs && authority[authority.length - 1] !== entry.runsAs) {
      if (!ids.has(entry.runsAs)) return this.refuse(env, ERR.UNKNOWN_IDENTITY, entry.runsAs + ' (runsAs of ' + env.action + ') is not an identity');
      if (authority.length > env_.MAX_HOPS) return this.refuse(env, ERR.HOP_LIMIT, 'authority chain too long');
      authority = [...authority, entry.runsAs];
    }
    const grant = caps.effective(ids, authority, env.action);
    if (!grant) return this.refuse(env, ERR.NOT_PERMITTED, 'not permitted: ' + caps.missing(ids, authority, env.action).join(', ') + ' may not run ' + env.action);
    const badIn = checkInput(entry.input, env.input);
    if (badIn) return this.refuse(env, ERR.BAD_INPUT, badIn);
    const ctlTaint = grant.strictControl ? env_.tainted(env.ctl || []) : [];
    if (entry.world && ctlTaint.length && !env_.tainted(env.labels).length && !grant.allowTainted) return this.refuse(env, ERR.TAINTED, 'sent under a condition labelled ' + ctlTaint.join('+') + ' (control labels): strictControl is set for ' + env.action + ' in this chain, so it may not run without an explicit rule (allowTainted)');
    const taint = env_.tainted(env.labels);
    if (entry.world && taint.length && !grant.allowTainted) return this.refuse(env, ERR.TAINTED, 'input labelled ' + taint.join('+') + ' may not reach the world action ' + env.action + ' without an explicit rule (allowTainted) for every identity in the chain');
    // 1.4.5: the allow-list, judged by the KERNEL from the entry's DECLARED targetForm (never from its name) — not granted → NO_TARGET,
    // malformed for that form → BAD_INPUT; either way a refused line and no "run" (a script's own calls come back through here as children)
    const tj = entry.targetForm ? targets.check(entry.targetForm, env.input, grant, authority, env.action) : null;
    if (tj) return this.refuse(env, tj.code === 'BAD_INPUT' ? ERR.BAD_INPUT : ERR.NO_TARGET, tj.reason);
    const actAs = authority[authority.length - 1];
    const received = new Set(env.labels);
    const isCred = (l) => env_.CREDENTIALS.includes(l);
    let replyCred = null;                                   // F-B 1.3.0: set by a script engine — the credentials of the value it returns
    const self = this;
    const ctx = Object.freeze({
      action: env.action, identity: actAs, authority: Object.freeze([...authority]), grant, trace: env.trace, node: this.node, time: env.time,
      labels: () => [...received],
      ctl: () => [...(env.ctl || [])],
      // an action may ADD provenance it knows of (file-read returns the labels stored with the file); never remove
      addLabels: (list) => { for (const l of list || []) if (env_.LABELS.includes(l) && !isCred(l)) received.add(l); },   // F-B 1.3.0: warnings only
      replyCredentials: (list) => { replyCred = (list || []).filter(isCred); },
      models: () => caps.modelsFor(ids, authority),
      fetch: this.fetchImpl, filesRoot: this.filesRoot, product: this.product,
      // slice 3: only the email action may queue mail; identity, chain, trace, labels and recipients come from HERE, not from it
      queueMail: env.action === 'email' && this.outbox ? (m) => self.outbox.enqueue({ to: m && m.to, subject: m && m.subject, text: m && m.text,
        labels: [...received].filter((l) => !isCred(l)), identity: actAs, authority: [...authority], trace: env.trace, msgId: env.id, targets: grant.targets || [] }) : undefined,
      // 1.4.0: mailboxes — only send may send, only messages may read; both sides must allow (owner decision, 4 Nov 2026)
      sendMessage: env.action === 'send' && this.mailbox ? (m) => {
        const to = String(m && m.to), rid = ids.get(to), acc = rid && rid.actions && rid.actions.messages;
        if (!rid) throw new Error(to.slice(0, 60) + ' is not an identity on this box');
        if (!acc || !Array.isArray(acc.targets) || !acc.targets.includes(actAs)) throw new Error(to + ' does not accept messages from ' + actAs + ' (its grant for messages does not name it)');
        return self.mailbox.send({ from: actAs, authority: [...authority], to, topic: m.topic, body: m.body, labels: [...received, ...(env.ctl || [])].filter((l) => !isCred(l)), trace: env.trace, msgId: env.id });   // 1.4.2 (R2-M4): + condition labels
      } : undefined,
      readMessages: env.action === 'messages' && this.mailbox ? (m) => {
        const accepted = (grant.targets || []).map(String);
        const me = ids.get(actAs), mine = me && me.actions && me.actions.messages, own = (mine && Array.isArray(mine.targets) ? mine.targets : []).map(String);
        const got = self.mailbox.read(actAs, m && m.topic, env.trace, (from) => accepted.includes(from), (from) => own.includes(from));   // 1.4.2 (M3)
        for (const r of got) for (const l of r.labels || []) if (env_.LABELS.includes(l) && !isCred(l)) received.add(l);   // labels travel with the message
        return got.map(({ id, from, topic, body, at, labels }) => ({ id, from, topic, body, at: new Date(at).toISOString(),
          labels: [...new Set((labels || []).filter((l) => env_.LABELS.includes(l) && !isCred(l)))].sort() }));   // 1.4.3 (A7)
      } : undefined,
      // 1.4.4 (v0.53.0, ACTBUS docs/functions-and-mailboxes.md §5): the messages action, and only it, may acknowledge — only in the RUNNING identity's own mailbox, only
      // from senders this run may see (its grant, intersected along the chain)
      ackMessages: env.action === 'messages' && this.mailbox ? (list) => {
        const accepted = (grant.targets || []).map(String);
        return self.mailbox.ack(actAs, list, (from) => accepted.includes(from));
      } : undefined,
      backend: (kind, name) => self.names.resolve(kind, name),
      // ask another action on behalf of the running identity
      send: async (action, input = {}, { labels = [], ctl = [] } = {}) => {
        if (env.hops <= 0) return self.refuse({ ...env, id: env.id + '>child', action }, ERR.HOP_LIMIT, 'hop limit reached in trace ' + env.trace + ' — no further message is sent');
        let c;
        // kind script: the interpreter's per-value labels and ctl; any other kind: everything received, ctl inherited only (1.1.0)
        const perValue = entry.kind === 'script';
        try { c = env_.child(env, { action, input, labels: perValue ? labels : [...received, ...labels].filter((l) => !isCred(l)), ctl: perValue ? ctl : [], from: actAs, authority, time: self.now() }); }
        catch (e) { return self.refuse(null, ERR.BAD_ENVELOPE, e.message, { from: actAs, action }); }
        MINTED.add(c);
        const r = await self.dispatch(c, ids);   // 1.4.4 (F04): a child sees the SAME snapshot as its parent
        if (r && Array.isArray(r.labels)) for (const l of r.labels) if (!isCred(l)) received.add(l);   // F-B 1.3.0: a child's credential stays with its value
        return r;
      },
    });

    const base = { id: env.id, trace: env.trace, replyTo: env.replyTo, from: env.from, authority, action: env.action, version: entry.version, sha256: entry.sha256.slice(0, 12), hops: env.hops, labels: env.labels, ...(env.ctl && env.ctl.length ? { ctl: env.ctl } : {}) };
    try { this.audit({ ...base, outcome: 'run', input: JSON.stringify(env.action === 'email' ? mailInput(env.input) : env.action === 'send' ? sendInput(env.input) : env.input).slice(0, 300) }); }
    catch (e) { return { ok: false, id: env.id, trace: env.trace, action: env.action, code: ERR.AUDIT, error: 'audit log unwritable — nothing was run (' + e.message + ')' }; }

    const t0 = this.clock();
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => entry.impl.run(env.input, ctx)),
        new Promise((_, rej) => { timer = setTimeout(() => { const e = new Error(env.action + ' did not finish within ' + entry.timeoutMs + ' ms'); e.code = ERR.TIMEOUT; rej(e); }, entry.timeoutMs); }),
      ]);
      clearTimeout(timer);
      // F-B 1.3.1 (literal rule): no reply carries its INPUT's credential — an action's output is new data. A script's reply carries only
      // the credentials of the value it returned; any other action only the label it is registered to produce
      for (const l of [...received]) if (isCred(l)) received.delete(l);
      if (entry.kind === 'script') for (const l of replyCred || []) received.add(l);
      received.add(entry.produces);
      const labels = [...received];
      let out; try { out = JSON.parse(JSON.stringify(value === undefined ? null : value)); } catch { throw new Error(env.action + ' returned something that is not plain JSON'); }
      this.audit({ ...base, outcome: 'ok', labelsOut: labels, ms: this.clock() - t0 });
      return { ok: true, id: env.id, trace: env.trace, action: env.action, basis: entry.produces, labels, value: out, sha256: entry.sha256.slice(0, 12) };
    } catch (e) {
      clearTimeout(timer);
      const transient = !!(entry.kind === 'script' && e && e.transient === true && TRANSIENT_CODES.has(e.code));   // 1.4.6: the run was never attempted
      // 1.7.0 (v0.54.4, the sixth cold read's #3): believed only from the script engine, which sets it for the supervisor's own refusals
      // (engine 1.4.1). A native action ran, so its thrown error is never transient, whatever it carries
      const code = e.code === ERR.TIMEOUT ? ERR.TIMEOUT : transient ? e.code : ERR.ACTION_ERROR;
      const msg = String(e && e.message || e).slice(0, 300);
      // an error message may carry text the action received, so it carries the labels too (fix 1.1.0)
      const labels = [...received, entry.produces].filter((l, i, a) => a.indexOf(l) === i && !isCred(l));   // F-B 1.3.0: an error is no credential
      try { this.audit({ ...base, outcome: 'error', code, ...(transient ? { transient: true } : {}), reason: msg, labelsOut: labels, ms: this.clock() - t0 }); } catch { /* reported below */ }
      return { ok: false, id: env.id, trace: env.trace, action: env.action, code, ...(transient ? { transient: true } : {}), error: msg, labels };
    }
  }
}

module.exports = { Bus, ERR, TRANSIENT_CODES };
