// outbox.js — v1.1.0 · the mail outbox: queue, allow-list and delivery; scripts never touch the network · changelog: act/CHANGELOG.md#actmailoutboxjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// the core's mail outbox (slice 3: ACTBUS docs/capability-architecture.md §7 item 3) — scripts never touch the network
// The email action runs its checks and calls enqueue(); the outbox runs the box-wide checks again (MAIL_ALLOW, the grant's
// recipients, the rate caps), adds the provenance footer and writes ONE record file (<dir>/<id>.json, temp file + rename).
// A delivery adapter (smtp.js fromEnv) sends queued records; with no adapter delivery is OFF and records stay queued (test mode).
//   · both lists must allow a recipient: MAIL_ALLOW (the live .env) AND the identity's grant (targets) — grants only shrink;
//     checkGrants() refuses, at start, an identity whose email grant names an address outside MAIL_ALLOW;
//   · rate caps per identity, counted at QUEUE time from the record files (so they survive a restart): perHour (6), perDay (50);
//   · a 4xx or a network failure is retried at most 3 times (1 / 5 / 15 min); a 5xx or a security refusal is never retried;
//   · the audit gets recipients, subject, size, labels and the sha256 of the body — never the body, never a credential.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ADDR } = require('./smtp');
const { DEFAULT, productName: checkProduct } = require('../core/product');

const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const HOUR = 3600000, DAY = 24 * HOUR;
const NOTE = {
  model: 'Contains text written by a language model (label: model).',
  web: 'Contains text read from the web (label: web).',
};

function parseAllow(s) {
  const list = String(s || '').split(/[\s,;]+/).filter(Boolean).map((a) => a.toLowerCase());
  const bad = list.filter((a) => !ADDR.test(a));
  if (bad.length) throw new Error('MAIL_ALLOW holds something that is not a plain address: ' + bad.join(', '));
  return [...new Set(list)];
}

// identities (capabilities.fromList Map) whose email grant names an address outside MAIL_ALLOW → refused at start, not at send time
function checkGrants(ids, allow) {
  const ok = new Set(allow.map((a) => a.toLowerCase())), bad = [];
  for (const [name, id] of ids) {
    const g = id.actions && id.actions.email;
    if (g && Array.isArray(g.targets)) for (const t of g.targets) if (!ok.has(String(t).toLowerCase())) bad.push(name + ' → ' + t);
  }
  if (bad.length) throw new Error('email grants name addresses that are not on MAIL_ALLOW: ' + bad.join(', '));
}

function footer({ identity, authority, trace, labels, product = DEFAULT }) {   // 1.1.0 (v0.53.6): product = the host's name
  const lines = ['', '', '-- ', 'Sent by ' + product + ' for ' + identity + ' (authority: ' + (authority || [identity]).join(' → ') + ') · trace ' + trace];
  for (const l of ['model', 'web']) if (labels.includes(l)) lines.push(NOTE[l]);
  lines.push('Labels: ' + ([...labels].sort().join(', ') || 'none'));
  return lines.join('\n');
}

class Outbox {
  constructor({ dir, allow = [], clock = Date.now, audit = () => {}, perHour = 6, perDay = 50, adapter = null, retryMs = [60000, 300000, 900000], productName }) {
    if (!dir) throw new Error('outbox: a folder is required');
    this.product = checkProduct(productName);
    fs.mkdirSync(dir, { recursive: true });
    Object.assign(this, { dir, allow: new Set(allow.map((a) => a.toLowerCase())), clock, audit, perHour, perDay, adapter, retryMs });
    this.busy = null; this.timer = null;
  }
  log(kind, extra, strict) { try { this.audit({ kind: 'mail-' + kind, time: new Date(this.clock()).toISOString(), ...extra }); } catch (e) { if (strict) throw e; } }
  file(id) { return path.join(this.dir, id + '.json'); }
  write(rec) { const f = this.file(rec.id), t = f + '.tmp-' + process.pid; fs.writeFileSync(t, JSON.stringify(rec, null, 1)); fs.renameSync(t, f); }
  records() {
    const out = [];
    for (const f of fs.readdirSync(this.dir).filter((x) => /^m-[a-z0-9-]+\.json$/.test(x)).sort()) {
      try { out.push(JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'))); }
      catch (e) { this.log('corrupt', { file: f, why: String(e.message).slice(0, 120) }); }
    }
    return out;
  }
  list() { return this.records().map(({ id, status, to, subject, identity, createdAt, attempts, labels }) => ({ id, status, to, subject, identity, createdAt, attempts, labels })); }

  // → { id, status: 'queued', to }   ·   throws Error (the email action's reply carries the message)
  enqueue({ to, subject, text, labels = [], identity, authority, trace, msgId, targets }) {
    const refuse = (why) => { this.log('refused', { identity, to: String(to).slice(0, 80), why }); throw new Error(why); };
    const addr = String(to || '').toLowerCase();
    if (!ADDR.test(addr)) refuse('not a plain email address: ' + String(to).slice(0, 80));
    if (!this.allow.has(addr)) refuse(addr + ' is not on this box\'s mail allow-list (MAIL_ALLOW)');
    if (!(targets || []).map((t) => String(t).toLowerCase()).includes(addr)) refuse(addr + ' is not among the recipients granted to ' + (authority || [identity]).join(' → '));
    const now = this.clock(), mine = this.records().filter((r) => r.identity === identity);
    if (mine.filter((r) => now - r.createdAt < HOUR).length >= this.perHour) refuse(identity + ' has reached ' + this.perHour + ' mails this hour');
    if (mine.filter((r) => now - r.createdAt < DAY).length >= this.perDay) refuse(identity + ' has reached ' + this.perDay + ' mails today');
    const body = String(text) + footer({ identity, authority, trace, labels, product: this.product });
    const id = 'm-' + now.toString(36) + '-' + crypto.randomBytes(4).toString('hex');
    const rec = { id, status: 'queued', to: addr, subject: String(subject), text: body, labels: [...labels].sort(), identity, authority, trace, msgId,
      createdAt: now, attempts: 0, nextAt: now, history: [] };
    this.log('queued', { id, identity, to: addr, subject: rec.subject.slice(0, 120), bytes: Buffer.byteLength(body), sha256: sha256(body), labels: rec.labels, trace }, true);   // 1.0.1: first
    this.write(rec);
    return { id, status: 'queued', to: addr };
  }

  // one pass over due records (never two at once) → { off } | { tried }
  deliver() {
    if (!this.adapter) return Promise.resolve({ off: true });
    if (this.busy) return this.busy;
    this.busy = (async () => {
      let tried = 0;
      const all = this.records();
      for (const rec of all.filter((r) => r.status === 'sending' && this.clock() - (r.sendingAt || 0) > 600000)) {   // M2: a crash mid-send
        rec.status = 'failed'; rec.history.push({ at: this.clock(), code: 0, stage: 'interrupted', reply: 'interrupted while sending — not resent (it may have gone out)' });
        try { this.write(rec); } catch { /* stays sending; never resent */ }
        this.log('failed', { id: rec.id, identity: rec.identity, to: rec.to, why: 'interrupted while sending' });
      }
      for (const rec of all.filter((r) => r.status === 'queued' && r.nextAt <= this.clock()).sort((a, b) => a.createdAt - b.createdAt)) {
        if (!this.allow.has(rec.to)) {                               // M1: the allow-list is checked again at delivery
          rec.status = 'failed'; rec.history.push({ at: this.clock(), code: 0, stage: 'check', reply: rec.to + ' is no longer on MAIL_ALLOW — not sent' });
          try { this.write(rec); } catch { continue; }
          this.log('failed', { id: rec.id, identity: rec.identity, to: rec.to, why: 'no longer on MAIL_ALLOW' }); continue;
        }
        rec.attempts += 1; rec.status = 'sending'; rec.sendingAt = this.clock();
        try { this.write(rec); } catch (e) { this.log('error', { id: rec.id, why: 'could not mark the record sending — not sent: ' + String(e.message).slice(0, 120) }); break; }   // M2
        tried += 1;
        let r; try { r = await this.adapter.send(rec); } catch (e) { r = { ok: false, code: 0, reply: String(e && e.message || e), temporary: true }; }
        rec.status = 'queued'; delete rec.sendingAt;
        const at = this.clock(), reply = String(r.reply || '').slice(0, 200);
        rec.history.push({ at, code: r.code, stage: r.stage, reply });
        if (r.ok) { rec.status = 'sent'; rec.sentAt = at; }
        else if (r.temporary && rec.attempts <= this.retryMs.length) rec.nextAt = at + this.retryMs[rec.attempts - 1];
        else rec.status = 'failed';
        try { this.write(rec); } catch (e) { this.log('error', { id: rec.id, why: 'result not saved (record stays "sending" and will be failed, never resent): ' + String(e.message).slice(0, 120) }); }
        this.log(r.ok ? 'sent' : rec.status === 'failed' ? 'failed' : 'retry', { id: rec.id, identity: rec.identity, to: rec.to, sha256: sha256(rec.text), attempt: rec.attempts, code: r.code, stage: r.stage, reply, ...(rec.status === 'queued' ? { nextAt: new Date(rec.nextAt).toISOString() } : {}) });
      }
      return { tried };
    })().finally(() => { this.busy = null; });
    return this.busy;
  }
  start(everyMs = 30000) { if (!this.timer && this.adapter) { this.timer = setInterval(() => { this.deliver().catch((e) => this.log('error', { why: String(e.message).slice(0, 200) })); }, everyMs); this.timer.unref(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

module.exports = { Outbox, parseAllow, checkGrants, footer };
