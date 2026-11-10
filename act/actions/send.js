// send.js — v1.0.0 · send one message to another identity's mailbox · changelog: act/CHANGELOG.md#actactionssendjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// TENTACLE: send one message to another identity's mailbox (ACTBUS docs/functions-and-mailboxes.md §3) — the core checks and writes it
// Input { to, topic, body }: to = an identity name (an EUser is u-<id>), topic = a name, body = text (to-json for structured data).
// BOTH sides must allow (owner decision, 4 Nov 2026): the sender's grant for send names the recipient (targets, intersected along the chain) and the
// recipient's grant for messages names the sender. The core (ctx.sendMessage, only for this action) adds who sent it, the chain, the
// trace and the labels — an action cannot forge them. The reply is { status: "sent", id, to, topic }.
'use strict';
function run(input, ctx) {
  if (typeof ctx.sendMessage !== 'function') throw new Error('messages are not set up on this box (no mailbox)');
  const to = String(input.to), topic = String(input.topic);
  const targets = (ctx.grant.targets || []).map(String);
  if (!targets.includes(to)) throw new Error(to + ' is not among the recipients granted to ' + ctx.authority.join(' → ') + ' for send (granted: ' + (targets.join(', ') || 'none') + ')');
  return ctx.sendMessage({ to, topic, body: String(input.body) });
}
module.exports = { run };
