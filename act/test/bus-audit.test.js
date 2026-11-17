// bus-audit.test.js — v1.0.0 · tests: the bus refuses to be built without an audit destination · changelog: act/CHANGELOG.md#acttestbus-audittestjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// Every message is audited before its action runs, and the audit fails closed. A bus built with neither audit nor auditFile wrote
// nowhere and ran anyway. Tests marked FAIL-FIRST fail on ACTBUS v0.3.7 (bus.js 1.7.0); GUARD tests hold on both.
// Run from anywhere: node --test act/test/bus-audit.test.js — the test finds the kernel by its own location (act/test/..)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');   // the kernel's act/, found from this file's own location
const { Bus } = require(path.join(ROOT, 'core/bus'));
const { Names } = require(path.join(ROOT, 'core/names'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const base = () => ({ registry: new Map(), identities: caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} }]), names: new Names('local') });

test('FAIL-FIRST a bus with neither audit nor auditFile is refused at construction', () => {
  assert.throws(() => new Bus(base()), /audit/);
});

test('FAIL-FIRST a bus given audit: undefined and auditFile: undefined is refused too (the keys present, no destination)', () => {
  assert.throws(() => new Bus({ ...base(), audit: undefined, auditFile: undefined }), /audit/);
});

test('GUARD a bus with an audit function is built, and its audit receives the line for a refused call', async () => {
  const lines = [];
  const bus = new Bus({ ...base(), audit: (l) => lines.push(JSON.parse(l)) });
  const r = await bus.ask('alex', 'nosuch', {});
  assert.equal(r.ok, false);
  assert.ok(lines.length >= 1, 'a line was written');
});

test('GUARD a bus with an auditFile is built, and the file receives the line', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ba-')), 'audit.jsonl');
  const bus = new Bus({ ...base(), auditFile: f });
  await bus.ask('alex', 'nosuch', {});
  assert.ok(fs.readFileSync(f, 'utf8').trim().split('\n').length >= 1);
});
