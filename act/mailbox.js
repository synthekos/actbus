// mailbox.js — v1.2.1 · mailboxes: identities send each other messages; a waiting message can start a script · changelog: act/CHANGELOG.md#actmailboxjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// the core's MAILBOXES: identities send each other messages; a message-triggered script reads them (ACTBUS docs/functions-and-mailboxes.md §3)
// The core owns every mailbox (act-files/.mailbox/<identity>/<id>.json, temp file + rename). Scripts never touch a file: the `send` and
// `messages` actions ask the bus, which checks BOTH sides (owner decision, 4 Nov 2026): the sender's grant for send names the recipient, and the
// recipient's grant for messages names the sender — checked when the message is sent AND again when it is read.
// Delivery (owner decision, 4 Nov 2026): a message read by a run is CLAIMED for that run (its trace); it is removed only when the run succeeds; if the
// run fails (or never reports back within claimMs) it is delivered again — at most maxAttempts (3) times, then it is DEAD (kept, listed,
// never delivered again). A script may therefore see a message twice: every message has a unique id.
// Labels travel with the message: what the sender's input carried (warnings only — a credential is never passed between identities).
// Limits: body = text ≤ 16 KB (send structured data with to-json, read it with parse-json) · ≤ 100 waiting per recipient (a full
// mailbox refuses: back-pressure) · ≤ 60 sends per identity per hour · ≤ 20 messages per read. The audit holds the body's sha256, not the body.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const LABELS = ['person', 'device', 'computed', 'grounded', 'model', 'web'], CRED = ['grounded'];

class Mailbox {
  constructor({ dir, clock = Date.now, audit = () => {}, perRecipient = 100, perHour = 60, maxBody = 16384, perRead = 20, claimMs = 600000, maxAttempts = 3, deadMs = 7 * 86400000, maxDead = 100 }) {
    if (!dir) throw new Error('mailbox: a folder is required');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    Object.assign(this, { dir, clock, audit, perRecipient, perHour, maxBody, perRead, claimMs, maxAttempts, deadMs, maxDead });
    this.ended = new Map();                                  // 1.1.1: trace → when its run finished (kept claimMs; read() refuses it)
    this.badSeen = new Set();
    this.claims = new Map();                                 // 1.1.0 (M1): trace → the mailboxes it claimed from (a restart forgets: releaseStale retries them)
    this.sent = new Map();                                   // identity → [send times] (rate; in memory — a restart forgets, the cap is a brake)
  }
  log(kind, extra, strict) { try { this.audit({ kind: 'msg-' + kind, time: new Date(this.clock()).toISOString(), ...extra }); } catch (e) { if (strict) throw e; } }
  where(to) { if (!NAME.test(String(to))) throw new Error('not an identity name: ' + String(to).slice(0, 60)); return path.join(this.dir, to); }
  box(to) { const d = this.where(to); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return d; }   // only a WRITE creates a folder (L5)
  write(to, rec) { const f = path.join(this.box(to), rec.id + '.json'), t = f + '.tmp-' + process.pid + '-' + crypto.randomBytes(3).toString('hex'); fs.writeFileSync(t, JSON.stringify(rec), { mode: 0o600 }); fs.renameSync(t, f); }
  records(to) {
    const d = this.where(to);
    let names = []; try { names = fs.readdirSync(d); } catch { return []; }
    const out = [];
    for (const f of names.filter((x) => /^g-[a-z0-9-]+\.json$/.test(x)).sort()) {
      try { const r = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
        if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || typeof r.status !== 'string') throw new Error('not a message record');   // 1.1.1
        out.push(r); }
      catch (e) {   // 1.1.0 (M2): moved out of the way ONCE (one line), never read again
        let moved = false; try { const q = path.join(this.dir, '.corrupt'); fs.mkdirSync(q, { recursive: true, mode: 0o700 }); fs.renameSync(path.join(d, f), path.join(q, to + '--' + f)); moved = true; } catch (_) {}
        if (moved || !this.badSeen.has(to + '/' + f)) this.log('corrupt', { to, file: f, why: String(e.message).slice(0, 100), moved });
        if (!moved) this.badSeen.add(to + '/' + f);
      }
    }
    return out;
  }
  // sending — the bus has already checked both sides; this checks the limits and writes the message (audit line FIRST: no line, no message)
  send({ from, authority, to, topic, body, labels = [], trace, msgId }) {
    const refuse = (why) => { this.log('refused', { from, to: String(to).slice(0, 60), topic: String(topic).slice(0, 60), why }); throw new Error(why); };
    if (!NAME.test(String(to))) refuse('not an identity name: ' + String(to).slice(0, 60));
    if (!NAME.test(String(topic))) refuse('a topic is a name (a-z, 0-9, -), got ' + JSON.stringify(String(topic).slice(0, 60)));
    if (typeof body !== 'string') refuse('the body is text (use to-json for structured data)');
    if (Buffer.byteLength(body) > this.maxBody) refuse('the body is larger than ' + this.maxBody + ' bytes');
    if (to === from) refuse('an identity does not send to itself (use remember)');
    const now = this.clock(), w = (this.sent.get(from) || []).filter((t) => now - t < 3600000);
    if (w.length >= this.perHour) refuse(from + ' has sent ' + this.perHour + ' messages this hour');
    if (this.records(to).filter((r) => r.status !== 'dead').length >= this.perRecipient) refuse(to + '\'s mailbox is full (' + this.perRecipient + ' waiting) — try later');
    const id = 'g-' + now.toString(36) + '-' + crypto.randomBytes(5).toString('hex');
    const rec = { v: 1, id, from, authority: authority || [from], to, topic, body, labels: [...new Set(labels.filter((l) => LABELS.includes(l) && !CRED.includes(l)))].sort(),
      trace, msgId, at: now, attempts: 0, status: 'new' };
    this.log('sent', { id, from, to, topic, bytes: Buffer.byteLength(body), sha256: sha256(body), labels: rec.labels, trace }, true);
    this.write(to, rec);
    w.push(now); this.sent.set(from, w);
    return { id, status: 'sent', to, topic };
  }
  // a claim older than claimMs is a run that never reported back: it counts as a failed attempt
  releaseStale() {
    let names = []; try { names = fs.readdirSync(this.dir).filter((x) => NAME.test(x)); } catch { return; }
    const now = this.clock();
    for (const [t, at] of this.ended) if (now - at > this.claimMs) this.ended.delete(t);
    for (const to of names) {
      const recs = this.records(to);
      for (const r of recs) if (r.status === 'claimed' && now - r.claimedAt > this.claimMs) this.fail(r, 'its run did not report back within ' + Math.round(this.claimMs / 1000) + ' s');
      // 1.1.0 (M1): a dead message is kept deadMs (7 days) for inspection, and at most maxDead per recipient (the oldest go first)
      for (const r of recs) if (r.status === 'dead' && !r.diedAt) { r.diedAt = now; try { this.write(to, r); } catch (_) {} }   // 1.1.1: dead under 1.0.0
      const dead = recs.filter((r) => r.status === 'dead').sort((a, b) => (a.diedAt || a.at) - (b.diedAt || b.at));
      dead.forEach((r, i) => { if (now - (r.diedAt || r.at) > this.deadMs || i < dead.length - this.maxDead) this.remove(to, r, 'expired'); });
    }
  }
  remove(to, r, kind) { try { fs.unlinkSync(path.join(this.where(to), r.id + '.json')); this.log(kind, { id: r.id, to, from: r.from, topic: r.topic }); } catch (e) { this.log('error', { id: r.id, why: 'could not remove: ' + String(e.message).slice(0, 100) }); } }
  fail(r, why) {
    r.attempts += 1; delete r.claimTrace; delete r.claimedAt;
    r.status = r.attempts >= this.maxAttempts ? 'dead' : 'new';
    if (r.status === 'dead') r.diedAt = this.clock();
    try { this.write(r.to, r); } catch (e) { this.log('error', { id: r.id, why: String(e.message).slice(0, 100) }); return; }
    this.log(r.status === 'dead' ? 'dead' : 'retry', { id: r.id, to: r.to, from: r.from, topic: r.topic, attempts: r.attempts, why });
  }
  // how many are waiting (for the scheduler's on-message triggers)
  pending(to, topic) { return this.records(to).filter((r) => r.status === 'new' && (!topic || r.topic === topic)).length; }
  // reading — claims up to perRead waiting messages for this run. own(from) = the RECIPIENT's current rule: a sender it no longer accepts
  // → dead. accept(from) = what THIS run may see (its grant intersected along the chain — maybe narrower): not accepted → left waiting.
  read(to, topic, trace, accept = () => true, own = accept) {
    if (!NAME.test(String(topic))) throw new Error('a topic is a name (a-z, 0-9, -)');
    if (trace && this.ended.has(trace)) throw new Error('this run has already ended — it cannot read messages any more');   // 1.1.1
    const out = [], now = this.clock();
    for (const r of this.records(to).filter((x) => x.status === 'new' && x.topic === topic).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))) {
      if (out.length >= this.perRead) break;
      if (!own(r.from)) { r.status = 'dead'; r.diedAt = now; r.why = r.from + ' is no longer accepted by ' + to; this.write(to, r); this.log('dead', { id: r.id, to, from: r.from, topic, why: r.why }); continue; }
      if (!accept(r.from)) continue;                         // 1.1.0 (M3): not for this run — still waiting for its recipient
      this.log('read', { id: r.id, to, from: r.from, topic, trace, attempt: r.attempts + 1 }, true);   // 1.1.0 (L2): no line, no claim
      r.status = 'claimed'; r.claimTrace = trace; r.claimedAt = now; delete r.heldTrace;   // 1.2.1: a new claim is not the old hold
      this.write(to, r);
      if (!this.claims.has(trace)) this.claims.set(trace, new Set()); this.claims.get(trace).add(to);
      out.push(r);
    }
    return out;
  }
  // the run that read them has ended: ok → removed, not ok → delivered again (or dead after maxAttempts)
  finish(trace, ok, to) {
    if (!trace) return 0;
    const names = to ? [to] : [...(this.claims.get(trace) || [])];   // 1.1.0 (M1): only the mailboxes this run read from
    this.claims.delete(trace); this.ended.set(trace, this.clock());
    let n = 0;
    for (const t of names) for (const r of this.records(t)) {
      if (r.status !== 'claimed' || r.claimTrace !== trace) continue;
      n += 1;
      if (ok) {
        try { this.log('done', { id: r.id, to: t, from: r.from, topic: r.topic, trace, sha256: sha256(r.body) }, true); } catch (e) { continue; }   // L2: no line → kept (a stale claim → delivered again)
        try { fs.unlinkSync(path.join(this.where(t), r.id + '.json')); } catch (e) { this.log('error', { id: r.id, why: 'could not remove: ' + String(e.message).slice(0, 100) }); }
      } else this.fail(r, 'its run failed');
    }
    return n;
  }
  // 1.2.0: a KEY HOLDER's run has ended — what it read stays claimed (claimTrace, claimedAt kept) until ack() or releaseStale()
  hold(trace) {
    if (!trace) return 0;
    const names = [...(this.claims.get(trace) || [])];
    this.claims.delete(trace); this.ended.set(trace, this.clock());
    let n = 0;
    for (const t of names) for (const r of this.records(t)) if (r.status === 'claimed' && r.claimTrace === trace) {
      n += 1; r.keyHeld = true; r.heldTrace = trace;                  // 1.2.1 (L3): only what was held may be acknowledged
      try { this.write(t, r); } catch (e) { this.log('error', { id: r.id, why: String(e.message).slice(0, 100) }); }
      this.log('held', { id: r.id, to: t, from: r.from, topic: r.topic, trace, until: new Date(r.claimedAt + this.claimMs).toISOString() });
    }
    return n;
  }
  // 1.2.0: the reader acknowledges ids it has: each one still in ITS mailbox (claimed by any run, or waiting again after a lost ack),
  // from a sender accept(from) allows, is removed — 'done' line FIRST (no line, kept). Returns how many were removed.
  ack(to, ids, accept = () => true) {
    if (!Array.isArray(ids)) throw new Error('ack is a list of message ids');
    if (ids.length > this.perRead * 5) throw new Error('at most ' + (this.perRead * 5) + ' ids per ack');
    const want = new Set();
    for (const x of ids) { if (typeof x !== 'string' || !/^g-[a-z0-9-]{1,40}$/.test(x)) throw new Error('not a message id: ' + JSON.stringify(String(x).slice(0, 60))); want.add(x); }
    if (!want.size) return 0;
    let n = 0;
    for (const r of this.records(to)) {
      if (!want.has(r.id) || r.status === 'dead' || !accept(r.from)) continue;
      // 1.2.1 (L3): held for a key holder, and now either waiting again (its hold ran out) or still held by THAT hold — never one a script claimed
      if (!r.keyHeld || !(r.status === 'new' || (r.status === 'claimed' && r.claimTrace === r.heldTrace))) continue;
      try { this.log('done', { id: r.id, to, from: r.from, topic: r.topic, trace: r.claimTrace, by: 'ack', sha256: sha256(r.body) }, true); } catch (e) { continue; }
      try { fs.unlinkSync(path.join(this.where(to), r.id + '.json')); n += 1; } catch (e) { this.log('error', { id: r.id, why: 'could not remove: ' + String(e.message).slice(0, 100) }); }
    }
    return n;
  }
  list(to) { return this.records(to).map(({ id, from, topic, at, attempts, status, labels }) => ({ id, from, topic, at, attempts, status, labels })); }
}

module.exports = { Mailbox };
