// envelope.js — v1.2.1 · the one message format, and the labels it carries · changelog: act/CHANGELOG.md#actcoreenvelopejs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// the one message format for everything (ACTBUS docs/capability-architecture.md §1 item 2)
// 1.1.0 (ACTBUS docs/proteus-k.md §8): optional ctl — the labels of the CONDITIONS a message was sent under (PROTEUS-K rule b). Checked like
// labels; a child inherits its parent's ctl and may add to it, never remove. The bus treats ctl as taint only under strictControl.
// { id, from, to, action, input, replyTo, time, trace, hops, labels, authority }
//   id        unique message id (duplicates are suppressed by the bus)
//   from      the identity sending this message (the LAST entry of authority)
//   to        the node it is for ('local' on one box; a node name under SYNTHX)
//   action    the registered action to run
//   trace     id of the root event — every message caused by one event shares it
//   hops      remaining hop budget; each child message gets hops − 1; at 0 nothing more is sent (loops end)
//   labels    provenance of the input: person · device · computed · grounded · model · web
//   authority the identities of the chain, root first — what may happen is what EVERY one of them may do
'use strict';
const crypto = require('crypto');

const LABELS = Object.freeze(['person', 'device', 'computed', 'grounded', 'model', 'web']);
const TAINT = Object.freeze(['model', 'web']);            // text that may carry instructions it did not come from a person
const NAME = /^[a-z][a-z0-9-]{0,47}$/;                    // identity, action and node names
const MAX_HOPS = 16, DEFAULT_HOPS = 8;

const newId = () => crypto.randomUUID();

function fail(msg) { const e = new Error(msg); e.code = 'BAD_ENVELOPE'; throw e; }

function check(env) {
  if (!env || typeof env !== 'object') fail('envelope must be an object');
  for (const k of ['id', 'trace']) if (typeof env[k] !== 'string' || env[k].length < 1 || env[k].length > 80) fail(k + ' must be a string of 1–80 characters');
  for (const k of ['from', 'action', 'to']) if (typeof env[k] !== 'string' || !NAME.test(env[k])) fail(k + ' must be a name (a-z, 0-9, -; starts with a letter)');
  if (!Number.isInteger(env.hops) || env.hops < 0 || env.hops > MAX_HOPS) fail('hops must be a whole number 0–' + MAX_HOPS);
  if (!Array.isArray(env.labels) || env.labels.some((l) => !LABELS.includes(l))) fail('labels must be a list of: ' + LABELS.join(', '));
  if (env.ctl !== undefined && (!Array.isArray(env.ctl) || env.ctl.some((l) => !LABELS.includes(l)))) fail('ctl must be a list of: ' + LABELS.join(', '));
  if (!Array.isArray(env.authority) || env.authority.length < 1 || env.authority.length > MAX_HOPS + 1 || env.authority.some((a) => typeof a !== 'string' || !NAME.test(a))) fail('authority must be a non-empty list of identity names');
  if (env.authority[env.authority.length - 1] !== env.from) fail('from must be the last identity in authority');
  if (typeof env.time !== 'string') fail('time must be an ISO string');
  if (env.replyTo !== undefined && env.replyTo !== null && typeof env.replyTo !== 'string') fail('replyTo must be a message id');
  if (env.input === undefined) fail('input is required (use {} for none)');
  let size; try { size = JSON.stringify(env.input).length; } catch { fail('input must be plain JSON'); }
  if (size > 256 * 1024) fail('input larger than 256 KB');
  return env;
}

// CREDENTIALS (F-B, 1.2.0): positive claims ("read from the documents"). Unlike warnings they must never be over-counted, so nobody
// can declare one and no child inherits one; only an action registered as producing it attaches it (the bus).
const CREDENTIALS = Object.freeze(['grounded']);
const warnOnly = (ls) => [...ls].filter((l) => !CREDENTIALS.includes(l));
// A root message enters at the edge. Labels the caller declares can only ADD to the label its identity kind earns — and only warnings.
function root({ from, action, input = {}, labels = [], kindLabel, to = 'local', hops = DEFAULT_HOPS, id, trace, time }) {
  const all = [...new Set([kindLabel, ...warnOnly(labels)].filter(Boolean))];
  const mid = id === undefined ? newId() : id;   // 1.2.1 (v0.54.4, the sixth cold read's #6): only a missing id is made here; "" is checked, and refused
  return check({ id: mid, from, to, action, input, replyTo: null, time, trace: trace || mid, hops, labels: all, ctl: [], authority: [from] });
}

// A message caused by another. It keeps the trace, spends one hop, and can never drop the parent's WARNINGS; a credential comes
// only with the labels sent for this message's own input (1.2.0).
function child(parent, { action, input = {}, labels = [], ctl = [], from, authority, to = 'local', time }) {
  const lab = [...new Set([...warnOnly(parent.labels), ...labels])];
  const c = [...new Set([...(parent.ctl || []), ...ctl])];
  return check({ id: newId(), from, to, action, input, replyTo: parent.id, time, trace: parent.trace, hops: parent.hops - 1, labels: lab, ctl: c, authority });
}

const tainted = (labels) => labels.filter((l) => TAINT.includes(l));

module.exports = { LABELS, TAINT, CREDENTIALS, NAME, MAX_HOPS, DEFAULT_HOPS, check, root, child, tainted, newId };
