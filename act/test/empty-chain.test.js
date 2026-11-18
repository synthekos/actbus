// empty-chain.test.js — v1.0.0 · tests: an empty chain holds no grant and no models, on purpose (P1, pull request #19) · changelog: act/CHANGELOG.md#acttestempty-chaintestjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// Tests marked FAIL-FIRST fail on ACTBUS v0.3.8 (capabilities.js 1.1.1): there an empty chain reached intersect([]), and [].reduce()
// threw a TypeError — closed only by accident. Tests marked GUARD hold on both.
// Run from anywhere: node --test act/test/empty-chain.test.js — the test finds the kernel by its own location (act/test/..)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ROOT = path.join(__dirname, '..');   // the kernel's act/, found from this file's own location
const caps = require(path.join(ROOT, 'core/capabilities'));

const ids = () => caps.fromList([
  { name: 'alex', kind: 'person', owner: 'alex', actions: {} },
  { name: 'p', kind: 'euser', owner: 'alex', actions: { fetch: { targets: ['a.example', 'b.example'], allowTainted: true }, calc: {} }, models: ['m1', 'm2'] },
  { name: 'q', kind: 'euser', owner: 'alex', actions: { fetch: { targets: ['b.example'] }, calc: { strictControl: true } }, models: ['m2'] },
]);

test('FAIL-FIRST effective(): an empty chain returns null, for every action', () => {
  for (const a of ['fetch', 'email', 'send', 'messages', 'calc', 'no-such-action']) assert.equal(caps.effective(ids(), [], a), null, a);
});

test('FAIL-FIRST modelsFor(): an empty chain returns no models', () => {
  assert.deepEqual(caps.modelsFor(ids(), []), []);
});

test('GUARD effective(): a chain of one identity returns its own grant', () => {
  assert.deepEqual(caps.effective(ids(), ['p'], 'fetch'), { targets: ['a.example', 'b.example'], allowTainted: true, strictControl: false });
});

test('GUARD effective(): a longer chain intersects targets, ANDs allowTainted, ORs strictControl', () => {
  assert.deepEqual(caps.effective(ids(), ['p', 'q'], 'fetch'), { targets: ['b.example'], allowTainted: false, strictControl: false });
  assert.equal(caps.effective(ids(), ['p', 'q'], 'calc').strictControl, true);
});

test('GUARD effective(): an unknown identity or a missing action anywhere in the chain returns null', () => {
  assert.equal(caps.effective(ids(), ['p', 'nobody'], 'fetch'), null);
  assert.equal(caps.effective(ids(), ['alex', 'p'], 'fetch'), null);
});

test('GUARD modelsFor(): one identity gives its models; a chain gives their intersection; an unknown name gives none', () => {
  assert.deepEqual(caps.modelsFor(ids(), ['p']), ['m1', 'm2']);
  assert.deepEqual(caps.modelsFor(ids(), ['p', 'q']), ['m2']);
  assert.deepEqual(caps.modelsFor(ids(), ['p', 'nobody']), []);
});
