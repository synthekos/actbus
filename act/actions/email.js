// email.js — v1.0.0 · queue one plain-text mail to an allowed recipient · changelog: act/CHANGELOG.md#actactionsemailjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// TENTACLE: queue one plain-text mail to an allowed recipient (slice 3: ACTBUS docs/capability-architecture.md §7 item 3)
// Input { to, subject, text }. One recipient; no CC/BCC, no attachments. This action never touches the network: it checks, then
// hands the mail to the core's outbox (ctx.queueMail), which checks again, adds the provenance footer and queues it; a delivery
// adapter in the core sends it later. The reply is { status: "queued", id, to }.
// Who may be mailed: the address must be in the targets that EVERY identity in the chain was granted for email (intersection)
// AND on the box-wide MAIL_ALLOW list (the outbox checks that). A world action: model- or web-labelled input is refused by the bus
// unless every identity in the chain holds allowTainted for email — and then the footer says so.
'use strict';
const ADDR = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;
const MAX_TEXT = 64 * 1024;

function run(input, ctx) {
  if (typeof ctx.queueMail !== 'function') throw new Error('email is not set up on this box (no outbox)');
  const to = String(input.to).trim().toLowerCase();
  if (!ADDR.test(to)) throw new Error('to must be ONE plain address (name@example.com) — got ' + JSON.stringify(String(input.to).slice(0, 80)));
  const subject = String(input.subject);
  if (/[\r\n]/.test(subject)) throw new Error('the subject may not contain line breaks');
  if (!subject.trim() || subject.length > 200) throw new Error('the subject must be 1–200 characters');
  const text = String(input.text);
  if (Buffer.byteLength(text) > MAX_TEXT) throw new Error('the text is larger than ' + MAX_TEXT + ' bytes');
  const targets = (ctx.grant.targets || []).map((t) => String(t).toLowerCase());
  if (!targets.includes(to)) throw new Error(to + ' is not among the recipients granted to ' + ctx.authority.join(' → ') + ' (granted: ' + (targets.join(', ') || 'none') + ')');
  return ctx.queueMail({ to, subject, text });
}

module.exports = { run };
