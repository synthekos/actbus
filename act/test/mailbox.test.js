// mailbox.test.js — v1.0.1 · tests: mailboxes and on-message triggers · changelog: act/CHANGELOG.md#acttestmailboxtestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// act/mailbox.js 1.0.0 + bus 1.4.0 + scheduler 1.1.0 (ACTBUS docs/functions-and-mailboxes.md §3; owner decision, 4 Nov 2026: mailboxes +
// on-message triggers; BOTH sides must allow; a message is removed only when the reading run succeeds, ≤ 3 deliveries then dead).
// Every test FAILS on v0.51.0 (no act/mailbox.js; bus 1.3.4 has no sendMessage/readMessages; scheduler 1.0.1 has no on-message).
// Run: cd act && node --test test/mailbox.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { Mailbox } = require(path.join(ROOT, 'mailbox'));

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function mk(opt = {}) {
  const clk = { t: Date.UTC(2026, 10, 4, 19, 0) }, lines = [];
  const mb = new Mailbox({ dir: tmp('mb-'), clock: () => clk.t, audit: (l) => lines.push(l), ...opt });
  return { mb, clk, lines };
}
const S = (mb, o = {}) => mb.send({ from: 'a', to: 'b', topic: 'job', body: 'hello', labels: [], trace: 't-send', ...o });

test('send → pending → read claims → finish(ok) REMOVES it; the audit holds the sha256, never the body', () => {
  const { mb, lines } = mk();
  const r = S(mb, { body: 'SECRET-BODY-981' });
  assert.equal(r.status, 'sent'); assert.match(r.id, /^g-[a-z0-9]+-[a-f0-9]{10}$/);
  assert.equal(mb.pending('b', 'job'), 1); assert.equal(mb.pending('b', 'other'), 0); assert.equal(mb.pending('b'), 1);
  const got = mb.read('b', 'job', 'run-1');
  assert.equal(got.length, 1); assert.equal(got[0].body, 'SECRET-BODY-981'); assert.equal(got[0].from, 'a');
  assert.equal(mb.pending('b', 'job'), 0, 'a claimed message is not waiting');
  assert.equal(mb.read('b', 'job', 'run-2').length, 0, 'a claimed message is not read by another run');
  assert.equal(mb.finish('run-1', true), 1);
  assert.deepEqual(mb.list('b'), []);
  assert.ok(!JSON.stringify(lines).includes('SECRET-BODY-981'), 'the body is in the audit');
  assert.deepEqual(lines.map((l) => l.kind), ['msg-sent', 'msg-read', 'msg-done']);
  assert.match(lines[0].sha256, /^[a-f0-9]{64}$/);
});

test('finish(failed) delivers it AGAIN; after 3 failed runs it is DEAD (kept, listed, never delivered)', () => {
  const { mb, lines } = mk();
  S(mb);
  for (let i = 1; i <= 3; i++) {
    const got = mb.read('b', 'job', 'run-' + i); assert.equal(got.length, 1, 'delivery ' + i);
    mb.finish('run-' + i, false);
  }
  assert.equal(mb.read('b', 'job', 'run-4').length, 0);
  assert.equal(mb.pending('b', 'job'), 0);
  const [m] = mb.list('b'); assert.equal(m.status, 'dead'); assert.equal(m.attempts, 3);
  assert.deepEqual(lines.filter((l) => /retry|dead/.test(l.kind)).map((l) => l.kind), ['msg-retry', 'msg-retry', 'msg-dead']);
});

test('finish only touches the messages claimed by THAT trace', () => {
  const { mb } = mk();
  S(mb, { topic: 'x' }); S(mb, { topic: 'y' });
  mb.read('b', 'x', 'run-x'); mb.read('b', 'y', 'run-y');
  assert.equal(mb.finish('run-x', true), 1);
  assert.equal(mb.finish('nobody', true), 0); assert.equal(mb.finish(undefined, true), 0);
  assert.deepEqual(mb.list('b').map((m) => [m.topic, m.status]), [['y', 'claimed']]);
});

test('a claim older than claimMs (a run that never reported back) counts as a failed attempt', () => {
  const { mb, clk } = mk({ claimMs: 600000 });
  S(mb); mb.read('b', 'job', 'lost-run');
  mb.releaseStale(); assert.equal(mb.pending('b', 'job'), 0, 'not yet stale');
  clk.t += 600001; mb.releaseStale();
  assert.equal(mb.pending('b', 'job'), 1); assert.equal(mb.list('b')[0].attempts, 1);
  assert.equal(mb.finish('lost-run', true), 0, 'the lost run can no longer remove it');
});

test('read re-checks the recipient\'s CURRENT rule: a sender no longer accepted → dead, not delivered', () => {
  const { mb } = mk();
  S(mb); S(mb, { from: 'c' });
  const got = mb.read('b', 'job', 'r', (from) => from === 'c');
  assert.deepEqual(got.map((m) => m.from), ['c']);
  assert.deepEqual(mb.list('b').map((m) => [m.from, m.status]).sort(), [['a', 'dead'], ['c', 'claimed']]);
});

test('limits: body text ≤ maxBody, names only, no self-send, ≤ perHour sends, a full mailbox refuses, ≤ perRead per read', () => {
  const { mb, clk } = mk({ maxBody: 10, perHour: 3, perRecipient: 2, perRead: 1 });
  assert.throws(() => S(mb, { body: 'x'.repeat(11) }), /larger than 10 bytes/);
  assert.throws(() => S(mb, { body: { a: 1 } }), /the body is text/);
  assert.throws(() => S(mb, { to: 'B' }), /not an identity name/);
  assert.throws(() => S(mb, { to: '../etc' }), /not an identity name/);
  assert.throws(() => S(mb, { topic: 'Job!' }), /a topic is a name/);
  assert.throws(() => S(mb, { to: 'a' }), /does not send to itself/);
  S(mb); S(mb);
  assert.throws(() => S(mb), /mailbox is full/);
  assert.equal(mb.read('b', 'job', 'r1').length, 1, 'perRead');
  S(mb, { to: 'c' });                                              // 3rd send this hour (a refused send does not count)
  assert.throws(() => S(mb, { to: 'c' }), /has sent 3 messages this hour/);
  clk.t += 3600001; S(mb, { to: 'c' });
});

test('labels: warnings travel with the message, a credential (grounded) NEVER does; unknown labels are dropped', () => {
  const { mb } = mk();
  S(mb, { labels: ['web', 'grounded', 'model', 'nonsense', 'web'] });
  assert.deepEqual(mb.read('b', 'job', 'r')[0].labels, ['model', 'web']);
});

test('fail closed: if the "sent" audit line cannot be written, no message is written', () => {
  const mb = new Mailbox({ dir: tmp('mb-'), audit: (l) => { if (l.kind === 'msg-sent') throw new Error('disk full'); } });
  assert.throws(() => S(mb), /disk full/);
  assert.equal(mb.pending('b'), 0);
});

test('a corrupt message file is skipped and audited, the others still read', () => {
  const { mb, lines } = mk();
  S(mb); fs.writeFileSync(path.join(mb.dir, 'b', 'g-0-broken.json'), '{nope');
  assert.equal(mb.read('b', 'job', 'r').length, 1);
  assert.ok(lines.some((l) => l.kind === 'msg-corrupt'));
});

// ---- through the REAL bus: both sides must allow; labels travel; the reply is what the reader sees ----
function busWith(ids, mb) {
  const registry = require(path.join(ROOT, 'core/registry')), caps = require(path.join(ROOT, 'core/capabilities'));
  const { Names } = require(path.join(ROOT, 'core/names')), { Bus } = require(path.join(ROOT, 'core/bus'));
  // 0.53.2 (second-reader review: a blocker): load the BUILT-IN actions only, from a temp copy — never the box's installed registry. An admin-installed
  // script in registry.json (staging: scout, 5 Nov 15:50) is refused here (no script engine attached) and made these 3 tests fail on any box with one.
  const src = path.join(ROOT, 'actions'), dir = tmp('mbreg-');
  const builtins = JSON.parse(fs.readFileSync(path.join(src, 'registry.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  for (const e of builtins) fs.copyFileSync(path.join(src, e.file), path.join(dir, e.file));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: builtins }));
  const loaded = registry.load(dir, 'registry.json', {});
  assert.deepEqual(loaded.refused, []);
  assert.ok(loaded.actions.has('send') && loaded.actions.has('messages'), 'send and messages must be built in');
  return new Bus({ registry: loaded.actions, identities: caps.fromList([ALEX, ...ids]), names: new Names('local'), filesRoot: tmp('mbf-'), mailbox: mb, audit: () => {} });
}
const ALEX = { name: 'alex', kind: 'person', owner: 'alex', actions: {} };
const person = (name, actions) => ({ name, kind: 'person', owner: 'alex', actions });

test('bus: a sends to b only when a\'s send grant names b AND b\'s messages grant names a; b reads it with a\'s labels', async () => {
  const { mb } = mk();
  const bus = busWith([
    person('a', { send: { targets: ['b', 'c', 'd'] } }),
    person('b', { messages: { targets: ['a'] } }),
    person('c', { messages: { targets: ['someone-else'] } }),
    person('d', { calc: {} }),
    person('e', { send: { targets: ['x'] } }),
  ], mb);
  const ok = await bus.ask('a', 'send', { to: 'b', topic: 'job', body: 'do it' }, { labels: ['web'] });
  assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.value.status, 'sent');
  const r1 = await bus.ask('a', 'send', { to: 'c', topic: 'job', body: 'x' }); assert.equal(r1.ok, false); assert.match(r1.error, /c does not accept messages from a/);
  const r2 = await bus.ask('a', 'send', { to: 'd', topic: 'job', body: 'x' }); assert.equal(r2.ok, false); assert.match(r2.error, /does not accept messages from a/);
  const r3 = await bus.ask('e', 'send', { to: 'b', topic: 'job', body: 'x' }); assert.equal(r3.ok, false); assert.match(r3.error, /b is not among the recipients granted/);
  const r4 = await bus.ask('a', 'send', { to: 'nobody', topic: 'job', body: 'x' }); assert.equal(r4.ok, false);
  const rd = await bus.ask('b', 'messages', { topic: 'job' }, { trace: 'tr-b' });
  assert.equal(rd.ok, true, JSON.stringify(rd));
  assert.deepEqual(rd.value.map((m) => [m.from, m.topic, m.body]), [['a', 'job', 'do it']]);
  assert.match(rd.value[0].at, /^2026-11-04T19:00/);
  assert.ok(rd.labels.includes('web'), 'the web label travelled with the message: ' + rd.labels);
  assert.ok(!rd.labels.includes('grounded'));
  assert.equal(mb.finish('tr-b', true), 1, 'claimed for the trace the reader\'s run was given');
  const r5 = await bus.ask('a', 'messages', { topic: 'job' }); assert.equal(r5.ok, false, 'a holds no messages grant');
});

test('bus: the reader\'s rule is checked again at READ time (a sender removed after sending is not delivered)', async () => {
  const { mb } = mk();
  const ids = [person('a', { send: { targets: ['b'] } }), person('b', { messages: { targets: ['a'] } })];
  const bus = busWith(ids, mb);
  assert.equal((await bus.ask('a', 'send', { to: 'b', topic: 'job', body: 'x' })).ok, true);
  const caps = require(path.join(ROOT, 'core/capabilities'));
  bus.ids = caps.fromList([ALEX, ids[0], person('b', { messages: { targets: ['z'] } })]);
  const rd = await bus.ask('b', 'messages', { topic: 'job' });
  assert.equal(rd.ok, true); assert.deepEqual(rd.value, []);
  assert.equal(mb.list('b')[0].status, 'dead');
});

test('bus: without a mailbox, send and messages refuse (nothing is half set up)', async () => {
  const bus = busWith([person('a', { send: { targets: ['b'] } }), person('b', { messages: { targets: ['a'] } })], null);
  const r = await bus.ask('a', 'send', { to: 'b', topic: 'job', body: 'x' });
  assert.equal(r.ok, false); assert.match(r.error, /not set up on this box/);
});

// ---- the scheduler: { on: "message", topic } fires when its identity has waiting messages on that topic ----
test('scheduler: an on-message trigger fires only while messages are waiting; shape is checked', async () => {
  const { Scheduler } = require(path.join(ROOT, 'scheduler'));
  let waiting = 0; const fired = [];
  const bus = { ask: async (from, action) => { fired.push([from, action]); waiting = 0; return { ok: true }; } };
  const s = new Scheduler({ bus, spec: { triggers: [{ id: 'on-job', script: 'worker', runsAs: 'w', on: 'message', topic: 'job' }] },
    stateDir: tmp('sch-'), pending: (id, topic) => (id === 'w' && topic === 'job' ? waiting : 0) });
  assert.deepEqual(s.refused, []);
  await s.tick(); assert.equal(fired.length, 0, 'nothing waiting');
  waiting = 2; await s.tick(); assert.deepEqual(fired, [['w', 'worker']]);
  await s.tick(); assert.equal(fired.length, 1, 'drained');
  assert.equal(s.status()[0].msg, 'job'); assert.equal(s.status()[0].on, true, '"on" still means switched on');
  for (const bad of [{ on: 'message' }, { topic: 'job' }, { on: 'cron', topic: 'job' }, { on: 'message', topic: 'Bad!' }, { on: 'message', topic: 'job', every: 60 }]) {
    const x = new Scheduler({ bus, spec: { triggers: [{ id: 'b', script: 'worker', runsAs: 'w', ...bad }] }, stateDir: tmp('sch-') });
    assert.equal(x.refused.length, 1, JSON.stringify(bad));
  }
});

// ---- review R2 (041126) — each FAILS on mailbox.js 1.0.0 / bus 1.4.1 ----
test('R2 M1: a dead message is removed after 7 days, at most maxDead are kept (oldest first) — each removal audited', () => {
  const { mb, clk, lines } = mk({ maxDead: 2, maxAttempts: 1, perHour: 99 });
  for (let i = 0; i < 4; i++) { S(mb, { topic: 't' + i }); mb.read('b', 't' + i, 'r' + i); mb.finish('r' + i, false); clk.t += 1000; }
  assert.equal(mb.list('b').filter((m) => m.status === 'dead').length, 4);
  mb.releaseStale();
  assert.deepEqual(mb.list('b').map((m) => m.topic), ['t2', 't3'], 'the two oldest dead removed');
  clk.t += 7 * 86400000 + 1; mb.releaseStale();
  assert.deepEqual(mb.list('b'), []);
  assert.equal(lines.filter((l) => l.kind === 'msg-expired').length, 4);
});

test('R2 M1: finish() touches only the mailboxes its run read from (an unrelated trace reads nothing)', () => {
  const { mb, lines } = mk();
  S(mb); fs.mkdirSync(path.join(mb.dir, 'c')); fs.writeFileSync(path.join(mb.dir, 'c', 'g-0-x.json'), '{bad');
  assert.equal(mb.finish('unrelated-trace', true), 0);
  assert.ok(!lines.some((l) => l.kind === 'msg-corrupt'), 'finish scanned a mailbox it never read from');
  mb.read('b', 'job', 'run-b'); assert.equal(mb.finish('run-b', true), 1);
  assert.ok(!lines.some((l) => l.kind === 'msg-corrupt'));
});

test('R2 M2: a damaged message file is moved to .corrupt/ ONCE (one audit line), not reported on every look', () => {
  const { mb, lines } = mk();
  S(mb); fs.writeFileSync(path.join(mb.dir, 'b', 'g-0-broken.json'), '');
  mb.pending('b'); mb.pending('b'); mb.read('b', 'job', 'r');
  assert.equal(lines.filter((l) => l.kind === 'msg-corrupt').length, 1);
  assert.ok(fs.existsSync(path.join(mb.dir, '.corrupt', 'b--g-0-broken.json')));
  mb.releaseStale();
});

test('R2 M3: only the RECIPIENT\'s own rule marks a message dead; a narrower rule for this run only leaves it waiting', () => {
  const { mb } = mk();
  S(mb); S(mb, { from: 'c' });
  const got = mb.read('b', 'job', 'narrow-run', (from) => from === 'c', () => true);
  assert.deepEqual(got.map((m) => m.from), ['c']);
  assert.deepEqual(mb.list('b').map((m) => [m.from, m.status]).sort(), [['a', 'new'], ['c', 'claimed']], 'a\'s message must still be waiting');
});

test('R2 L2: the read and done lines are written FIRST — if they cannot be, nothing is claimed / removed', () => {
  let failOn = '';
  const mb = new Mailbox({ dir: tmp('mb-'), audit: (l) => { if (l.kind === failOn) throw new Error('disk full'); } });
  S(mb);
  failOn = 'msg-read'; assert.throws(() => mb.read('b', 'job', 'r1'), /disk full/);
  assert.equal(mb.pending('b', 'job'), 1, 'claimed without its line');
  failOn = ''; mb.read('b', 'job', 'r2');
  failOn = 'msg-done'; mb.finish('r2', true);
  assert.equal(mb.list('b').length, 1, 'removed without its line');
});

test('R2 L5: looking at an unknown mailbox creates nothing', () => {
  const { mb } = mk();
  assert.equal(mb.pending('ghost'), 0); assert.deepEqual(mb.list('ghost'), []);
  assert.ok(!fs.existsSync(path.join(mb.dir, 'ghost')));
});

// ---- review R3 (041126) — each FAILS on mailbox.js 1.1.0 ----
test('R3: a run that has FINISHED cannot claim under its trace again (a timed-out script that kept running)', () => {
  const { mb } = mk();
  mb.finish('zombie', false);
  S(mb);
  assert.throws(() => mb.read('b', 'job', 'zombie'), /already ended/);
  assert.equal(mb.pending('b', 'job'), 1);
  assert.equal(mb.read('b', 'job', 'fresh').length, 1, 'another run still can');
});

test('R3: a record that parses but is not a message (null, a list) is treated as damaged, and the other mailboxes still work', () => {
  const { mb, lines } = mk();
  S(mb); S(mb, { to: 'c' });
  fs.writeFileSync(path.join(mb.dir, 'b', 'g-0-null.json'), 'null');
  assert.equal(mb.pending('b'), 1);
  mb.releaseStale();
  assert.equal(mb.pending('c'), 1);
  assert.equal(lines.filter((l) => l.kind === 'msg-corrupt').length, 1);
});

test('R3: a message marked dead by 1.0.0 (no diedAt) is kept 7 days from now, not removed at once', () => {
  const { mb, clk } = mk();
  S(mb); const f = path.join(mb.dir, 'b', mb.list('b')[0].id + '.json');
  const r = JSON.parse(fs.readFileSync(f, 'utf8')); r.status = 'dead'; r.at -= 8 * 86400000; fs.writeFileSync(f, JSON.stringify(r));
  mb.releaseStale(); assert.equal(mb.list('b').length, 1, 'removed at once');
  clk.t += 7 * 86400000 + 1; mb.releaseStale(); assert.equal(mb.list('b').length, 0);
});

test('R3: a damaged file that cannot be moved is reported once, not on every look', () => {
  const { mb, lines } = mk();
  S(mb); fs.writeFileSync(path.join(mb.dir, '.corrupt'), 'a file where the folder should be');
  fs.writeFileSync(path.join(mb.dir, 'b', 'g-0-bad.json'), '{x');
  mb.pending('b'); mb.pending('b'); mb.releaseStale();
  assert.equal(lines.filter((l) => l.kind === 'msg-corrupt').length, 1);
});
