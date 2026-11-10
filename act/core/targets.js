// targets.js — v1.1.1 · an action's targets, judged by the form its registry entry declares · changelog: act/CHANGELOG.md#actcoretargetsjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// targets are judged by a DECLARED form — the registry entry says
// `targetForm` (fetch-host | email-address | identity | sender); the bus never guesses from an action's name. Malformed input for a
// form is refused too (BAD_INPUT, the action's own wording), so every denial is a kernel refusal with no "run" line. unenforced(): a
// grant listing targets for an action that declares no form — the kernel would not enforce them — is refused at load and at save.
// the allow-list moves into the kernel; judged by action name (fetch/email).
// The forms must stay identical to fetch.js 1.2.0, email.js 1.0.0 and send.js — act/test/core.test.js checks the layers agree.
// The actions KEEP their own checks as a second layer (a bug here can only refuse more, never allow more than the action allows).
'use strict';
const ADDR = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;   // = email.js 1.0.0
// 1.1.1 (second-reader review, round 2): any CALLER text echoed in a reason is capped at 80 characters with control characters removed — the input may
// be web-tainted and the reason lands in the audit line and in the error returned to the caller (the audit already has the input sha)
const safe = (x) => String(x).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '').slice(0, 80);
const bad = (reason) => ({ code: 'BAD_INPUT', reason });
const no = (reason) => ({ code: 'NO_TARGET', reason });
const listOf = (grant) => ((grant && grant.targets) || []).map((x) => String(x).toLowerCase());

const FORMS = {
  'fetch-host': (input, grant, chain) => {   // = fetch.js 1.2.0: host · host:port · http://host[:port]
    let u; try { u = new URL(String(input && input.url)); } catch { return bad('not a valid URL'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return bad('only http and https are allowed');
    if (u.username || u.password) return bad('URLs with credentials are refused');
    const host = u.hostname.toLowerCase(), hp = u.port ? host + ':' + u.port : host;
    const want = u.protocol === 'http:' ? 'http://' + hp : hp, targets = listOf(grant);
    if (targets.includes(want)) return null;
    return no((u.protocol === 'http:' ? 'plain http to ' : u.port ? 'host and port ' : 'host ') + want + ' is not on the allow-list for ' + chain + ' (allowed: ' + (targets.join(', ') || 'none') + ')');
  },
  'email-address': (input, grant, chain) => {   // = email.js 1.0.0
    const to = String(input && input.to).trim().toLowerCase();
    if (!ADDR.test(to)) return bad('to must be ONE plain address (name@example.com) — got ' + JSON.stringify(safe(input && input.to)));
    const targets = listOf(grant);
    if (targets.includes(to)) return null;
    return no(safe(to) + ' is not among the recipients granted to ' + chain + ' (granted: ' + (targets.join(', ') || 'none') + ')');
  },
  identity: (input, grant, chain, action) => {   // = send.js: `to` names an identity, exactly
    const to = String(input && input.to), targets = ((grant && grant.targets) || []).map(String);
    if (targets.includes(to)) return null;
    return no(safe(to) + ' is not among the recipients granted to ' + chain + ' for ' + action + ' (granted: ' + (targets.join(', ') || 'none') + ')');
  },
  sender: () => null,   // messages: the targets are the senders it ACCEPTS — judged by the bus at read time, not from the input
};
const FORM_NAMES = Object.freeze(Object.keys(FORMS));

// → null | { code: 'NO_TARGET' | 'BAD_INPUT', reason }
function check(form, input, grant, authority, action) {
  const f = FORMS[form]; if (!f) return null;
  return f(input, grant, (authority || []).join(' → '), action);
}
// grant.actions + a lookup name → registry entry (or undefined) → the action names whose targets the kernel would NOT enforce
function unenforced(actions, entryOf) {
  return Object.entries(actions || {}).filter(([a, g]) => g && Array.isArray(g.targets) && !((entryOf(a) || {}).targetForm)).map(([a]) => a);
}
module.exports = { check, unenforced, FORMS, FORM_NAMES };
