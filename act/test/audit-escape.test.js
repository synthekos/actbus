// audit-escape.test.js — v1.0.0 · tests: every line act.js writes to logs/act.jsonl has the unsafe characters escaped, and a JSON parser reads back the same values (act.js 1.10.0) · changelog: act/CHANGELOG.md#acttestaudit-escapetestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// The cold read of v0.4.0 (findings 1 and 2; issue #20): JSON.stringify leaves DEL, C1, U+061C, U+200B–200F, U+2028–202E, U+2060–2069 and
// U+FEFF raw, and a request's text, a page's text (a script's child call) and a script error's reason reached the audit with them raw.
// Since act.js 1.10.0 every line goes through auditLine (cap), which escapes them as \\uXXXX before the 4 KB measure.
// Tests marked FAIL-FIRST fail on act.js 1.9.4: (a)–(c) because a raw character reaches the log; (d)–(f) because 1.9.4 exports no
// auditLine. Every character below is built with String.fromCharCode, so this file holds none of them raw.
// Run: node --test test/audit-escape.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'aesc-' + t + '-'));

const CODES = [0x7f, 0x80, 0x85, 0x9b, 0x9f, 0x61c, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2060, 0x2066, 0x2069, 0xfeff];
const ALL = CODES.map((c) => 'x' + String.fromCharCode(c)).join('') + 'x';
const UNSAFE = new RegExp('[' + CODES.map((c) => '\\u' + c.toString(16).padStart(4, '0')).join('') + '\\x80-\\x9f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069]');
const show = (s) => String(s).replace(/[^\x20-\x7e]/g, (c) => '<U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + '>');

const ALEX = { role: 'admin', auth: 'login', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-00000000000f', loginId: 'alex' };
const BOT = { role: 'euser', auth: 'key', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000b0', loginId: 'bot' };
const HELPER = { role: 'euser', auth: 'key', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000c0', loginId: 'helper' };
const id = (u) => 'u-' + u.uniqueId;
const SCRIPTS = {
  pageread: '(read-number :text (get (fetch :url "https://www.example.com/") "text"))\n',
  pagefail: '(fail (get (fetch :url "https://www.example.com/") "text"))\n',
};

function host() {
  const actmod = require(path.join(ROOT, '..', 'act.js'));
  const g = { calc: {}, fetch: { targets: ['www.example.com'] }, 'read-number': {}, pageread: {}, pagefail: {} };
  const users = [ALEX, ...[BOT, HELPER].map((u) => ({ ...u, actGrants: JSON.stringify({ owner: 'alex', ownerId: ALEX.uniqueId, actions: g }) }))];
  const prisma = { user: { findMany: async () => users.slice(), findUnique: async ({ where }) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null, update: async () => null } };
  const src = path.join(ROOT, 'actions'), actionsDir = tmp('acts');
  const spec = JSON.parse(fs.readFileSync(path.join(src, 'registry.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  for (const e of spec) fs.copyFileSync(path.join(src, e.file), path.join(actionsDir, e.file));
  for (const [name, text] of Object.entries(SCRIPTS)) {
    fs.writeFileSync(path.join(actionsDir, name + '.pk'), text);
    spec.push({ name, version: '1.0.0', kind: 'script', file: name + '.pk', produces: 'computed', world: true, runsAs: id(HELPER), needs: [], input: {}, acceptWarnings: true, timeoutMs: 60000,
      sha256: registry.sha256(fs.readFileSync(path.join(actionsDir, name + '.pk'))) });
  }
  fs.writeFileSync(path.join(actionsDir, 'registry.json'), JSON.stringify({ actions: spec }));
  const appDir = tmp('app'); fs.mkdirSync(path.join(appDir, 'act-files'), { recursive: true });
  const fetchImpl = async () => ({ status: 200, text: async () => 'PAGE' + ALL + 'END' });
  const A = actmod.create({ prisma, models: { isInstalled: () => false }, modelUrl: 'http://127.0.0.1:1', appDir, log: { error() {} }, actionsDir, fetchImpl, daemon: false });
  const call = async (body) => { const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } }; await A.route({ euser: users[1], body }, res); return res; };
  const log = () => { try { return fs.readFileSync(path.join(appDir, 'logs', 'act.jsonl'), 'utf8'); } catch { return ''; } };
  return { A, call, log };
}
// every line: no raw unsafe character, and it parses as JSON
function clean(text) {
  const lines = text.split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'nothing was audited');
  for (const l of lines) { assert.ok(!UNSAFE.test(l), 'a raw character reached the audit: ' + show(l.slice(0, 300))); JSON.parse(l); }
  return lines.map((l) => JSON.parse(l));
}

test('FAIL-FIRST (a) a request: the run line holds the input escaped, and a JSON parser reads back the input as sent', async () => {
  const h = host();
  try {
    const input = { expr: '1+' + ALL };
    await h.call({ action: 'calc', input });
    const run = clean(h.log()).find((j) => j.outcome === 'run' && j.action === 'calc');
    assert.ok(run, 'no run line for calc');
    assert.equal(run.input, JSON.stringify(input).slice(0, 300), 'the value read back is not the input as sent');
  } finally { h.A.stop(); }
});

test('FAIL-FIRST (b) a page: a script\'s child call carrying page text is escaped in its run line, and reads back as the page sent it', async () => {
  const h = host();
  try {
    await h.call({ action: 'pageread', input: {} });
    const run = clean(h.log()).find((j) => j.outcome === 'run' && j.action === 'read-number');
    assert.ok(run, 'no run line for the child call read-number');
    assert.ok(JSON.parse(run.input).text.includes('PAGE' + ALL + 'END'), 'the page text did not read back the same: ' + show(run.input));
    assert.ok(run.labels.includes('web'), 'the child call is labelled web');
  } finally { h.A.stop(); }
});

test('FAIL-FIRST (c) a script error: a reason quoting page text is escaped in the error line, and reads back the same', async () => {
  const h = host();
  try {
    const r = await h.call({ action: 'pagefail', input: {} });
    assert.notEqual(r.code, 200, JSON.stringify(r.body));
    const err = clean(h.log()).find((j) => j.outcome === 'error' && j.action === 'pagefail');
    assert.ok(err, 'no error line for pagefail');
    assert.ok(String(err.reason).includes('PAGE' + ALL + 'END'), 'the reason did not read back the same: ' + show(err.reason));
  } finally { h.A.stop(); }
});

const { auditLine } = require(path.join(ROOT, '..', 'act.js'));
const lineOf = (n, fill) => ({ t: '2026-11-19T00:00:00.000Z', node: 'local', outcome: 'run', code: 'X', who: ['alex'], input: fill.repeat(n) });

test('FAIL-FIRST (d) auditLine escapes every class and a parser reads back the same object', () => {
  assert.equal(typeof auditLine, 'function', 'act.js exports no auditLine');
  const o = { t: 'now', node: 'local', outcome: 'run', input: ALL, reason: 'a' + ALL + 'b' };
  const s = auditLine({ ...o });
  assert.ok(!UNSAFE.test(s), 'raw: ' + show(s));
  assert.deepEqual(JSON.parse(s), o);
});

test('FAIL-FIRST (e) the 4 KB measure is of the escaped text: a line of exactly 4 096 escaped characters is kept whole, one more is cut', () => {
  assert.equal(typeof auditLine, 'function', 'act.js exports no auditLine');
  const base = auditLine(lineOf(0, '')).length;                 // the line with an empty input
  const sep = String.fromCharCode(0x2028), one = 6;             // one U+2028 is written as six characters
  const n = Math.floor((4096 - base) / one), pad = 4096 - base - n * one;
  const whole = { ...lineOf(n, sep), input: 'a'.repeat(pad) + sep.repeat(n) };
  const s1 = auditLine({ ...whole });
  assert.equal(s1.length, 4096, 'the line is not 4 096 characters: ' + s1.length);
  assert.equal(JSON.parse(s1).truncated, undefined, 'a 4 096-character line was cut');
  const s2 = auditLine({ ...whole, input: whole.input + 'a' });
  assert.ok(s2.length <= 4096, 'over 4 KB: ' + s2.length);
  assert.equal(JSON.parse(s2).truncated, true, 'a 4 097-character line was not cut');
});

test('FAIL-FIRST (f) the 200-character cut and the fallback line hold on escaped text', () => {
  assert.equal(typeof auditLine, 'function', 'act.js exports no auditLine');
  const sep = String.fromCharCode(0x2028);
  const cut = JSON.parse(auditLine(lineOf(1000, sep)));         // 6 000 characters escaped: cut to 200 + '…'
  assert.equal(cut.truncated, true); assert.equal(cut.input, sep.repeat(200) + '…');
  const many = lineOf(0, ''); for (let i = 0; i < 6; i++) many['f' + i] = sep.repeat(150);   // six fields of 900 escaped characters each, none over 200 raw
  const s = auditLine(many);
  assert.ok(s.length <= 4096, 'over 4 KB: ' + s.length);
  assert.deepEqual(JSON.parse(s), { t: many.t, node: 'local', outcome: 'run', code: 'X', who: ['alex'], truncated: true }, 'not the fallback line');
});

test('GUARD auditLine leaves a line without such characters as JSON.stringify writes it', () => {
  if (typeof auditLine !== 'function') return;                 // 1.9.4 has no auditLine; its lines are JSON.stringify's
  const o = { t: 'now', node: 'local', outcome: 'ok', reason: 'tab\tline\nquote" back\\ é ü 日本 …' };
  assert.equal(auditLine({ ...o }), JSON.stringify(o));
});
