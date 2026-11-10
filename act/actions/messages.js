// messages.js — v1.1.1 · read the waiting messages on one topic from the caller's own mailbox · changelog: act/CHANGELOG.md#actactionsmessagesjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// TENTACLE: read the waiting messages on one topic from the running identity's own mailbox (ACTBUS docs/functions-and-mailboxes.md §3)
// Input { topic }. Returns a list (oldest first, at most 20) of { id, from, topic, body, at }. Only senders named in this grant's
// targets are accepted (checked again at read time). A message read here is CLAIMED for this run: removed when the run succeeds,
// delivered again if it fails (at most 3 times, then dead). Its labels (what the sender's input carried) come with the reply.
'use strict';
function run(input, ctx) {
  if (typeof ctx.readMessages !== 'function') throw new Error('messages are not set up on this box (no mailbox)');
  if (input.ack !== undefined) {
    if (typeof ctx.ackMessages !== 'function') throw new Error('acknowledgements are not set up on this box');
    ctx.ackMessages(input.ack);
  }
  return ctx.readMessages({ topic: String(input.topic) });
}
module.exports = { run };
