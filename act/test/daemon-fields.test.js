// daemon-fields.test.js — v1.1.1 · tests: a daemon-* line keeps act.js's own time; a daemon message's type is written as `msg`, `runId` only where it is a string or a number that passes the id rule, `pid` only where it is a whole number (act.js 1.10.1) · changelog: act/CHANGELOG.md#acttestdaemon-fieldstestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// The cold read of v0.4.0 (finding 2): act.js 1.9.4 merged the supervisor's record into the line after the time, so the record's `t`
// (the daemon message's type, for a dropped message the daemon's own text) replaced it, and `runId` was any value the daemon sent.
// 1.1.0 (the review of the repair, R6 and R8 → docs/reviews.md, 20 Nov): `pid` comes from the daemon's own ready message and was written as sent; a `runId` that is a list such
// as ["abc"] passed the id rule as text. Two FAIL-FIRST tests added.
// Each test runs the real act.js and kernel from a copy of this tree in a temp folder, with act/daemon/pkd.js replaced by a stand-in
// that sends the message under test; the tree itself is not changed. Tests marked FAIL-FIRST fail on act.js 1.9.4; the GUARD holds on both.
// Every hostile character is built with String.fromCharCode, so this file holds none of them raw.
// Run: node --test test/daemon-fields.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'dfld-' + t + '-'));
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const LS = String.fromCharCode(0x2028), RLO = String.fromCharCode(0x202e);

const ALEX = { role: 'admin', auth: 'login', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-00000000000f', loginId: 'alex' };
const BOT = { role: 'euser', auth: 'key', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000b0', loginId: 'bot' };
const HELPER = { role: 'euser', auth: 'key', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000c0', loginId: 'helper' };
const id = (u) => 'u-' + u.uniqueId;

// `onRun` is the body of a function (m, send) the stand-in daemon runs on each 'run' message; `readyPid` is the expression its ready message sends as pid
function host(onRun, readyPid = 'process.pid') {
  const copy = tmp('tree');
  fs.copyFileSync(path.join(ROOT, '..', 'act.js'), path.join(copy, 'act.js'));
  fs.cpSync(ROOT, path.join(copy, 'act'), { recursive: true, filter: (p) => !p.startsWith(path.join(ROOT, 'test')) });
  fs.writeFileSync(path.join(copy, 'act', 'daemon', 'pkd.js'), `const send = (x) => process.send(x);
process.on('message', (m) => { if (m.t === 'run') { (function (m, send) { ${onRun} })(m, send); } });
process.send({ t: 'ready', pid: ${readyPid}, permission: !!process.permission });\n`);
  const actmod = require(path.join(copy, 'act.js'));
  const g = { calc: {}, s: {} };
  const users = [ALEX, ...[BOT, HELPER].map((u) => ({ ...u, actGrants: JSON.stringify({ owner: 'alex', ownerId: ALEX.uniqueId, actions: g }) }))];
  const prisma = { user: { findMany: async () => users.slice(), findUnique: async ({ where }) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null, update: async () => null } };
  const src = path.join(copy, 'act', 'actions'), actionsDir = tmp('acts');
  const spec = JSON.parse(fs.readFileSync(path.join(src, 'registry.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  for (const e of spec) fs.copyFileSync(path.join(src, e.file), path.join(actionsDir, e.file));
  fs.writeFileSync(path.join(actionsDir, 's.pk'), '(get (calc :expr "1") "result")\n');
  spec.push({ name: 's', version: '1.0.0', kind: 'script', file: 's.pk', produces: 'computed', world: false, runsAs: id(HELPER), needs: [], input: {}, acceptWarnings: true, timeoutMs: 20000,
    sha256: registry.sha256(fs.readFileSync(path.join(actionsDir, 's.pk'))) });
  fs.writeFileSync(path.join(actionsDir, 'registry.json'), JSON.stringify({ actions: spec }));
  const appDir = tmp('app'); fs.mkdirSync(path.join(appDir, 'act-files'), { recursive: true });
  const A = actmod.create({ prisma, models: { isInstalled: () => false }, modelUrl: 'http://127.0.0.1:1', appDir, log: { error() {} }, actionsDir, daemon: true });
  const call = async (body) => { const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } }; await A.route({ euser: users[1], body }, res); return res; };
  const lines = () => { let t = ''; try { t = fs.readFileSync(path.join(appDir, 'logs', 'act.jsonl'), 'utf8'); } catch {} return t.split('\n').filter(Boolean).map((l) => JSON.parse(l)); };
  const stop = async () => { if (A.stop) await A.stop(); };
  return { call, lines, stop };
}
const DONE = "send({ t: 'done', runId: m.runId, ok: true, value: '1', labels: [], seen: [] });";
const fixed = (j, outcome) => { assert.ok(ISO.test(j.t), outcome + ': t is not act.js\'s time: ' + JSON.stringify(j.t)); assert.equal(j.node, 'local'); assert.equal(j.outcome, outcome); };

test('FAIL-FIRST a dropped message: the line keeps its time; the message type is msg; a runId that passes the id rule is kept', async () => {
  const h = host("send({ t: 'stale', runId: -1 }); " + DONE);
  try {
    const r = await h.call({ action: 's', input: {} });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const d = h.lines().find((j) => j.outcome === 'daemon-dropped');
    assert.ok(d, 'no daemon-dropped line'); fixed(d, 'daemon-dropped');
    assert.equal(d.msg, 'stale'); assert.equal(d.runId, -1);
  } finally { await h.stop(); }
});

test('FAIL-FIRST a dropped message with hostile fields: the time is kept, msg and runId are null', async () => {
  const h = host("send({ t: 'x" + LS + RLO + "y', runId: 'not this run " + LS + RLO + "' }); " + DONE);
  try {
    await h.call({ action: 's', input: {} });
    const d = h.lines().find((j) => j.outcome === 'daemon-dropped');
    assert.ok(d, 'no daemon-dropped line'); fixed(d, 'daemon-dropped');
    assert.equal(d.msg, null, 'a message type that is not a name was written: ' + JSON.stringify(d.msg));
    assert.equal(d.runId, null, 'a runId that fails the id rule was written: ' + JSON.stringify(d.runId));
  } finally { await h.stop(); }
});

test('FAIL-FIRST a malformed call: the daemon-malformed line keeps its time, and the message type is msg', async () => {
  const h = host("send({ t: 'call', runId: m.runId, callId: 1, action: 'calc', input: { expr: '1' }, labels: 'person', ctl: [] });");
  try {
    const r = await h.call({ action: 's', input: {} });
    assert.notEqual(r.code, 200, JSON.stringify(r.body));
    const d = h.lines().find((j) => j.outcome === 'daemon-malformed');
    assert.ok(d, 'no daemon-malformed line'); fixed(d, 'daemon-malformed');
    assert.equal(d.msg, 'call'); assert.equal(d.why, 'labels is not a list of known labels');
  } finally { await h.stop(); }
});

test('FAIL-FIRST a dropped message whose runId is a list: runId is null, though its text passes the id rule', async () => {
  const h = host("send({ t: 'stale', runId: ['abc'] }); " + DONE);
  try {
    await h.call({ action: 's', input: {} });
    const d = h.lines().find((j) => j.outcome === 'daemon-dropped');
    assert.ok(d, 'no daemon-dropped line'); fixed(d, 'daemon-dropped');
    assert.equal(d.msg, 'stale'); assert.equal(d.runId, null, 'a runId that is not a string or a number was written: ' + JSON.stringify(d.runId));
  } finally { await h.stop(); }
});

test('FAIL-FIRST a ready message whose pid is text: the daemon-start line has pid null and act.js\'s time', async () => {
  const h = host(DONE, "'NOT A PID " + RLO + " 2026-01-01T00:00:00.000Z ' + 'x'.repeat(50)");
  try {
    const r = await h.call({ action: 's', input: {} });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const d = h.lines().find((j) => j.outcome === 'daemon-start');
    assert.ok(d, 'no daemon-start line'); fixed(d, 'daemon-start');
    assert.equal(d.pid, null, 'a pid that is not a whole number was written: ' + JSON.stringify(d.pid));
  } finally { await h.stop(); }
});

test('GUARD a daemon-start line keeps its time, pid and permission', async () => {
  const h = host(DONE);
  try {
    await h.call({ action: 's', input: {} });
    const d = h.lines().find((j) => j.outcome === 'daemon-start');
    assert.ok(d, 'no daemon-start line'); fixed(d, 'daemon-start');
    assert.ok(Number.isInteger(d.pid), JSON.stringify(d)); assert.equal(typeof d.permission, 'boolean');
  } finally { await h.stop(); }
});
