// the.test.js — v1.0.1 · tests: `(the …)` — exactly one match, or a refusal that lists every possibility · changelog: act/CHANGELOG.md#acttestthetestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// PROTEUS-K (the (x list) cond), eval 1.3.0 (B′, owner decision, 2 Nov 2026). Every test here FAILS on
// eval 1.2.0 (there "the" is an unknown name — the script is refused at load — and may be used as a let name).
// Run: node --test --test-reporter=tap test/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../proteus/reader');
const { run, check, ScriptError } = require('../proteus/eval');

const ACTIONS = new Set(['fetch', 'file-append']);
const callAction = async (action) => (action === 'fetch'
  ? { ok: true, value: { limit: '2.5' }, labels: ['device', 'web'] } : { ok: true, value: { written: true }, labels: ['computed'] });
const FACTS = [
  { item: 'P-1', attr: 'max-flow', value: '2.8' }, { item: 'P-2', attr: 'max-flow', value: '1.9' },
  { item: 'P-3', attr: 'max-flow', value: '3.15' }, { item: 'P-4', attr: 'max-flow', value: '2.8' },
];
const go = (src) => run(read(src), { actions: ACTIONS, callAction, input: { facts: FACTS }, inputLabels: ['grounded'] });
const V = '(number (get f "value"))';
const WEB = '(number (get (fetch :url "https://page.example") "limit"))';
const err = async (src) => { try { await go(src); } catch (e) { return e; } assert.fail('expected an error: ' + src); };

test('one match → that item (a record), usable with get', async () => {
  const r = await go('(get (the (f (input facts)) (= (get f "item") "P-3")) "value")');
  assert.equal(r.value, '3.15');
  assert.ok(r.labels.includes('grounded'));
});

test('no match → refused as "not in the documents" (code FAIL), never nil', async () => {
  const e = await err('(the (f (input facts)) (= (get f "item") "P-9"))');
  assert.ok(e instanceof ScriptError); assert.equal(e.code, 'FAIL'); assert.match(e.message, /not in the documents/);
});

test('two or more → AMBIGUOUS: the program stops and the error carries every match, in list order; none is chosen', async () => {
  const e = await err('(get (the (f (input facts)) (= (get f "value") "2.8")) "item")');
  assert.equal(e.code, 'AMBIGUOUS'); assert.match(e.message, /matched 2 items/);
  assert.deepEqual(e.possibilities.map((x) => x.item), ['P-1', 'P-4']);
  assert.ok(!e.labels.includes('grounded'), 'F-B review F7 (031126): an error never carries a credential — the possibilities are still returned');
});

test('labels: a web-labelled condition marks the result AND the ambiguous error (data labels, rule b)', async () => {
  const one = await go(`(let ((lim ${WEB})) (get (the (f (input facts)) (> ${V} (+ lim 0.6))) "item"))`);
  assert.equal(one.value, 'P-3'); assert.ok(one.labels.includes('web'), 'the chosen item carries the condition\'s web label');
  const amb = await err(`(let ((lim ${WEB})) (the (f (input facts)) (> ${V} lim)))`);
  assert.equal(amb.code, 'AMBIGUOUS'); assert.equal(amb.possibilities.length, 3); assert.ok(amb.labels.includes('web'));
});

test('load: the body must be pure; the shape is (the (name list) one-form); "the" is reserved; reach unchanged', () => {
  const bad = (src, re) => assert.throws(() => check(read(src), ACTIONS), (e) => e.code === 'CHECK' && re.test(e.message), src);
  bad('(the (x (list 1 2)) (fetch :url "https://a.example"))', /no action call inside \(the/);
  bad('(the (x (list 1)) (remember k x))', /\(remember …\) cannot be inside \(the/);
  bad('(the (x (list 1)) true false)', /\(the \(name list\) one-form\)/);
  bad('(let ((the 1)) the)', /is a form or action name/);
  assert.deepEqual(check(read('(the (x (list 1 2)) (= x 2))'), ACTIONS).calls, []);
});
