// mail-fields.test.js — v1.0.0 · tests: a refused message or mail records its to and topic only where each passes its rule (issue #12) · changelog: act/CHANGELOG.md#acttestmail-fieldstestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// Issue #12, the mailbox and the outbox: mailbox.js 1.3.0 wrote a refused message's `to` and `topic` into its msg-refused line before the
// NAME checks, and its reasons quoted them; outbox.js 1.1.0 wrote a refused mail's `to` before the address check, and its reason quoted it.
// JSON leaves U+2028/U+2029, NEL, C1 and bidi controls raw. Tests marked FAIL-FIRST fail on mailbox.js 1.3.0 / outbox.js 1.1.0; tests
// marked GUARD hold on both. Doors: (a) the send action through the bus (a topic), (b) the mailbox called directly, (c) the outbox called
// directly. Through the bus a `to` outside the rule never reaches the mailbox or the outbox (the bus's target and identity checks and
// email.js refuse it first): two GUARDs show that. The run line's `input` is caller text, a stated limit (README, Known
// gaps), so the bus's audit is checked with it removed.
// Run: node --test test/mail-fields.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { Mailbox } = require(path.join(ROOT, 'mailbox'));
const { Outbox } = require(path.join(ROOT, 'mail/outbox'));
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'mlf-' + t + '-'));

// issue #12's nine (line breaks, an escape, Unicode line separators, C1 and bidi controls), each inside an otherwise name-like value
const HOSTILE = ['c\nx', 'c\rx', 'c\u001bx', 'c\u2028x', 'c\u2029x', 'c\u0085x', 'c\u009bx', 'c\u202ex', 'c\u2067x'];
const ME = 'alex@example.org';
const show = (v) => JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const escForm = (v) => JSON.stringify(v).slice(1, -1);
function absent(v, texts, where) {
  for (const t of texts) assert.ok(!t.includes(v) && !t.includes(escForm(v)), show(v) + ' reached ' + where + ': ' + show(t.slice(0, 240)));
}
const text = (recs) => recs.map((r) => JSON.stringify(r));
const noInput = (l) => { const j = JSON.parse(l); delete j.input; return JSON.stringify(j); };
const refusedLines = (recs, kind) => recs.filter((r) => r.kind === kind);
const err = (fn) => { try { fn(); return null; } catch (e) { return String(e.message); } };

function busWith(ids, mb, ob) {
  const registry = require(path.join(ROOT, 'core/registry')), caps = require(path.join(ROOT, 'core/capabilities'));
  const { Names } = require(path.join(ROOT, 'core/names')), { Bus } = require(path.join(ROOT, 'core/bus'));
  const src = path.join(ROOT, 'actions'), dir = tmp('reg');
  const builtins = JSON.parse(fs.readFileSync(path.join(src, 'registry.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  for (const e of builtins) fs.copyFileSync(path.join(src, e.file), path.join(dir, e.file));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: builtins }));
  const loaded = registry.load(dir, 'registry.json', {});
  const audit = [];
  const bus = new Bus({ registry: loaded.actions, identities: caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} }, ...ids]), names: new Names('local'),
    filesRoot: tmp('f'), mailbox: mb, outbox: ob, audit: (l) => audit.push(String(l)) });
  return { bus, audit };
}
const person = (name, actions) => ({ name, kind: 'person', owner: 'alex', actions });

test('FAIL-FIRST (a) the send action: a topic that is not a name is refused; it is in no reply, reason, mailbox line or bus line (input aside)', async () => {
  const mbl = [], mb = new Mailbox({ dir: tmp('mb'), audit: (r) => mbl.push(r) });
  const { bus, audit } = busWith([person('a', { send: { targets: ['b'] } }), person('b', { messages: { targets: ['a'] } })], mb);
  for (const v of HOSTILE) {
    const r = await bus.ask('a', 'send', { to: 'b', topic: v, body: 'hello' });
    assert.equal(r.ok, false, show(v) + ' was sent: ' + show(JSON.stringify(r)));
    absent(v, [JSON.stringify(r), r.error || ''], 'the reply or its reason');
  }
  assert.equal(refusedLines(mbl, 'msg-refused').length, HOSTILE.length, 'each refusal is in the mailbox audit');
  for (const v of HOSTILE) absent(v, [...text(mbl), ...audit.map(noInput)], 'an audit line');
});
test('GUARD (a) the send action: a to that is not a name never reaches the mailbox, even where an admin granted it — the bus refuses it first', async () => {
  const mbl = [], mb = new Mailbox({ dir: tmp('mb'), audit: (r) => mbl.push(r) });
  const { bus } = busWith([person('a', { send: { targets: HOSTILE } })], mb);
  for (const v of HOSTILE) {
    const r = await bus.ask('a', 'send', { to: v, topic: 'job', body: 'hello' });
    assert.equal(r.ok, false, show(v) + ' was sent');
  }
  assert.equal(mbl.length, 0, 'the mailbox wrote no line: ' + show(JSON.stringify(mbl)));
});
test('FAIL-FIRST (b) the mailbox called directly: a to that is not a name is refused; its line has to: null, its reason does not quote it', () => {
  const mbl = [], mb = new Mailbox({ dir: tmp('mb'), audit: (r) => mbl.push(r) });
  for (const v of HOSTILE) {
    const e = err(() => mb.send({ from: 'a', to: v, topic: 'job', body: 'hello', labels: [], trace: 't-1' }));
    assert.ok(e && /not an identity name/.test(e), show(v) + ': ' + show(e));
    absent(v, [e], 'the reason');
    const line = mbl[mbl.length - 1];
    assert.equal(line.kind, 'msg-refused'); assert.equal(line.to, null, show(v) + ': to is ' + show(line.to)); assert.equal(line.topic, 'job');
  }
  for (const v of HOSTILE) absent(v, text(mbl), 'a mailbox line');
});
test('FAIL-FIRST (b) the mailbox called directly: a topic that is not a name is refused; its line has topic: null, its reason does not quote it', () => {
  const mbl = [], mb = new Mailbox({ dir: tmp('mb'), audit: (r) => mbl.push(r) });
  for (const v of HOSTILE) {
    const e = err(() => mb.send({ from: 'a', to: 'b', topic: v, body: 'hello', labels: [], trace: 't-1' }));
    assert.ok(e && /a topic is a name/.test(e), show(v) + ': ' + show(e));
    absent(v, [e], 'the reason');
    const line = mbl[mbl.length - 1];
    assert.equal(line.kind, 'msg-refused'); assert.equal(line.topic, null, show(v) + ': topic is ' + show(line.topic)); assert.equal(line.to, 'b');
  }
  for (const v of HOSTILE) absent(v, text(mbl), 'a mailbox line');
});
test('FAIL-FIRST (c) the outbox called directly: a to that is not a plain address is refused; its line has to: null, its reason does not quote it', () => {
  const obl = [], ob = new Outbox({ dir: tmp('ob'), allow: [ME], audit: (r) => obl.push(r) });
  const vals = [...HOSTILE.map((v) => v + '@example.org'), '\u2028' + ME, ME + '\ufeff', '\u202e' + ME];
  for (const v of vals) {
    const e = err(() => ob.enqueue({ to: v, subject: 'hello', text: 'x', labels: [], identity: 'alex', authority: ['alex'], trace: 't-1', targets: [ME] }));
    assert.ok(e && /not a plain email address/.test(e), show(v) + ': ' + show(e));
    absent(v, [e], 'the reason');
    const line = obl[obl.length - 1];
    assert.equal(line.kind, 'mail-refused'); assert.equal(line.to, null, show(v) + ': to is ' + show(line.to));
  }
  for (const v of vals) absent(v, text(obl), 'an outbox line');
  assert.equal(ob.records().length, 0, 'nothing was queued');
});
test('GUARD (a) the email action: an address outside the rule never reaches the outbox — the bus refuses it before the run', async () => {
  const obl = [], ob = new Outbox({ dir: tmp('ob'), allow: [ME], audit: (r) => obl.push(r) });
  const { bus, audit } = busWith([person('a', { email: { targets: [ME] } })], null, ob);
  for (const v of HOSTILE.map((x) => x + '@example.org')) {
    const r = await bus.ask('a', 'email', { to: v, subject: 'hello', text: 'x' });
    assert.equal(r.ok, false, show(v) + ' was queued');
  }
  assert.equal(obl.length, 0, 'the outbox wrote no line: ' + show(JSON.stringify(obl)));
  assert.ok(!audit.some((l) => JSON.parse(l).outcome === 'run'), 'nothing ran');
});
test('GUARD (b) the mailbox: a refusal whose to and topic ARE names still records both; a good message is sent', () => {
  const mbl = [], mb = new Mailbox({ dir: tmp('mb'), audit: (r) => mbl.push(r) });
  const e = err(() => mb.send({ from: 'a', to: 'a', topic: 'job', body: 'hello', labels: [], trace: 't-1' }));
  assert.ok(e && /does not send to itself/.test(e), String(e));
  const line = mbl[mbl.length - 1];
  assert.equal(line.kind, 'msg-refused'); assert.equal(line.to, 'a'); assert.equal(line.topic, 'job');
  mb.send({ from: 'a', to: 'b', topic: 'job', body: 'hello', labels: [], trace: 't-2' });
  assert.equal(mbl[mbl.length - 1].kind, 'msg-sent');
});
test('GUARD (c) the outbox: a refusal for a plain address still records it; a granted address on the allow-list is queued', () => {
  const obl = [], ob = new Outbox({ dir: tmp('ob'), allow: [ME], audit: (r) => obl.push(r) });
  const e = err(() => ob.enqueue({ to: 'other@example.com', subject: 'hello', text: 'x', labels: [], identity: 'alex', authority: ['alex'], trace: 't-1', targets: [ME] }));
  assert.ok(e && /allow-list/.test(e), String(e));
  assert.equal(obl[obl.length - 1].kind, 'mail-refused'); assert.equal(obl[obl.length - 1].to, 'other@example.com');
  ob.enqueue({ to: ME, subject: 'hello', text: 'x', labels: [], identity: 'alex', authority: ['alex'], trace: 't-2', targets: [ME] });
  assert.equal(obl[obl.length - 1].kind, 'mail-queued');
});
