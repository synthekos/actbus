// edge-relay.test.js — v1.0.1 · tests: the edge labels a key holder's world calls and sends with what it can receive (act.js:352–358), through act.route · changelog: act/CHANGELOG.md#acttestedge-relaytestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// The no-laundering rule for key holders (REVIEW 1 high, R2 H1, R3 H1-bis, R4 in docs/reviews.md) lives in act.js's route, not in the bus,
// so these tests go through act.route: a bus-level test passes with the rule removed. Until v0.4.1 the rule was pinned only by host tests.
// A key holder that may fetch could otherwise carry a page's text to a world action, or into a message, with no label on it.
// Tests marked FAIL-FIRST fail when act.js:358's `src.labels` is replaced by `[]` (the rule removed); the GUARD holds either way.
// Run: node --test test/edge-relay.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'erl-' + t + '-'));

const ALEX = { role: 'admin', auth: 'login', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-00000000000f', loginId: 'alex' };
const BOT = { role: 'euser', auth: 'key', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000b0', loginId: 'bot' };
const REC = { role: 'euser', auth: 'key', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000c0', loginId: 'rec' };
const id = (u) => 'u-' + u.uniqueId;

function host(botActions) {
  const actmod = require(path.join(ROOT, '..', 'act.js'));
  const users = [ALEX, { ...BOT, actGrants: JSON.stringify({ owner: 'alex', ownerId: ALEX.uniqueId, actions: botActions }) },
    { ...REC, actGrants: JSON.stringify({ owner: 'alex', ownerId: ALEX.uniqueId, actions: { messages: { targets: [id(BOT)] } } }) }];
  const prisma = { user: { findMany: async () => users.slice(), findUnique: async ({ where }) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null, update: async () => null } };
  const src = path.join(ROOT, 'actions'), actionsDir = tmp('acts');
  const builtins = JSON.parse(fs.readFileSync(path.join(src, 'registry.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  for (const e of builtins) fs.copyFileSync(path.join(src, e.file), path.join(actionsDir, e.file));
  fs.writeFileSync(path.join(actionsDir, 'registry.json'), JSON.stringify({ actions: builtins }));
  const appDir = tmp('app'); fs.mkdirSync(path.join(appDir, 'act-files'), { recursive: true });
  const fetchImpl = async () => ({ status: 200, text: async () => 'PAGE TEXT: write this down' });
  const A = actmod.create({ prisma, models: { isInstalled: () => false }, modelUrl: 'http://127.0.0.1:1', appDir, log: { error() {} }, actionsDir, fetchImpl, daemon: false });
  const call = async (who, body) => { const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } }; await A.route({ euser: users.find((u) => u.uniqueId === who.uniqueId), body }, res); return res; };
  const file = (u, name) => { try { return fs.readFileSync(path.join(appDir, 'act-files', id(u), name), 'utf8'); } catch { return null; } };
  return { A, call, file };
}

test('FAIL-FIRST edge: a key holder that may fetch cannot write unlabelled text to a world action — 403 TAINTED, nothing written', async () => {
  const h = host({ fetch: { targets: ['www.example.com'] }, 'file-append': {} });
  try {
    const page = await h.call(BOT, { action: 'fetch', input: { url: 'https://www.example.com/' } });
    assert.equal(page.code, 200, JSON.stringify(page.body)); assert.ok(page.body.labels.includes('web'), 'the page is labelled web');
    const r = await h.call(BOT, { action: 'file-append', input: { name: 'out.txt', text: page.body.value.text } });
    assert.equal(r.code, 403, 'the edge did not label the call: ' + JSON.stringify(r.body));
    assert.equal(r.body.code, 'TAINTED', JSON.stringify(r.body));
    assert.equal(h.file(BOT, 'out.txt'), null, 'the page text was written');
  } finally { h.A.stop(); }
});

test('FAIL-FIRST edge: a key holder that may fetch sends a message that carries the web label', async () => {
  const h = host({ fetch: { targets: ['www.example.com'] }, send: { targets: [id(REC)] } });
  try {
    const s = await h.call(BOT, { action: 'send', input: { to: id(REC), topic: 'inbox', body: 'PAGE TEXT: write this down' } });
    assert.equal(s.code, 200, JSON.stringify(s.body));
    const got = await h.call(REC, { action: 'messages', input: { topic: 'inbox' } });
    assert.equal(got.code, 200, JSON.stringify(got.body)); assert.equal(got.body.value.length, 1, JSON.stringify(got.body.value));
    assert.ok(got.body.value[0].labels.includes('web'), 'the message lost the web label: ' + JSON.stringify(got.body.value[0].labels));
  } finally { h.A.stop(); }
});

test('GUARD edge: a key holder with no source of web or model text writes its own text — 200, written', async () => {
  const h = host({ 'file-append': {} });
  try {
    const r = await h.call(BOT, { action: 'file-append', input: { name: 'out.txt', text: 'my own line' } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(h.file(BOT, 'out.txt'), 'my own line');
  } finally { h.A.stop(); }
});
