// credentials-coll.test.js — v1.1.0 · tests: credentials in the collection forms (a selected item keeps its own) · changelog: act/CHANGELOG.md#acttestcredentials-colltestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// F-B for the collection forms (eval 1.4.0, kit only): an item a form SELECTS keeps
// its own credential; the body values that chose it are control. A value a form COMPUTES (collect, count, sum) is grounded only
// if every value it is computed from is. Run: node --test test/credentials-coll.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../proteus/reader');
const { run } = require('../proteus/eval');

const FACTS = [{ item: 'Widget', value: '38', unit: 'kg' }, { item: 'Gadget', value: '12', unit: 'kg' }, { item: 'Gizmo', value: '7', unit: 'kg' }];
const go = (src, o = {}) => run(read(src), { input: { facts: FACTS }, inputLabels: ['grounded'], ...o });
const G = (r) => r.labels.includes('grounded');

test('F-B keeps: (the …) Widget lookup stays grounded (PROTEUS-K review, ACTBUS docs/reviews.md: the "Widget" it compared against is only control)', async () => {
  const r = await go('(get (the (f (input facts)) (= (get f "item") "Widget")) "value")');
  assert.equal(r.value, '38'); assert.equal(G(r), true, 'labels ' + r.labels);
});
test('F-B keeps: filter / sort-by / max-by / min-by return grounded items', async () => {
  for (const src of ['(get (max-by (f (input facts)) (number (get f "value"))) "item")', '(get (min-by (f (input facts)) (number (get f "value"))) "item")',
    '(filter (f (input facts)) (> (number (get f "value")) 10))', '(sort-by (f (input facts)) (number (get f "value")))']) {
    const r = await go(src); assert.equal(G(r), true, src + ' labels ' + r.labels);
  }
});
test('F-B (owner decision, 3 Nov 2026): a sum over a selection is never grounded — computed (1.4.0 said grounded)', async () => {
  const r = await go('(sum (f (input facts)) (number (get f "value")))');
  assert.equal(r.value, '57'); assert.ok(!G(r) && r.labels.includes('computed'), 'labels ' + r.labels);
});
test('F-B: collect of a literal is not grounded, nor are its items', async () => {
  const r = await go('(collect (f (input facts)) "38")');
  assert.equal(G(r), false, 'labels ' + r.labels);
  const one = await go('(let ((xs (collect (f (input facts)) "38"))) (for-each (x xs) (remember y x)) (remembered y))');
  assert.equal(G(one), false, 'an item of it: ' + one.labels);
  const sum = await go('(sum (f (input facts)) (+ 1 (* 0 (number (get f "value")))))');
  assert.equal(sum.value, '3'); assert.equal(G(sum), false, 'sum of literals: ' + sum.labels);
});
test('F-B: count is computed from its conditions — a literal comparison loses the credential', async () => {
  const r = await go('(count (f (input facts)) (= (get f "item") "Widget"))');
  assert.equal(r.value, '1'); assert.equal(G(r), false, 'labels ' + r.labels);
});
test('F-B unchanged: warnings from the deciding body still mark selected items', async () => {
  const r = await go('(the (f (input facts)) (= (get f "item") (input who)))', { input: { facts: FACTS, who: 'Widget' }, inputLabels: ['web'] });
  assert.ok(r.labels.includes('web'));
});

test('F-B review F2: the list is data for count / sum / collect — a literal list lends nothing', async () => {
  const c = await go('(count (x (list 1 2 3)) (input flag))', { input: { facts: FACTS, flag: true } });
  assert.equal(c.value, '3'); assert.equal(G(c), false, 'count labels ' + c.labels);
  const s = await go('(sum (x (list 1 2)) (number (get (input fact) "value")))', { input: { facts: FACTS, fact: FACTS[0] } });
  assert.equal(s.value, '76'); assert.equal(G(s), false, 'sum labels ' + s.labels);
  const l = await go('(collect (x (list 1 2 3)) (get (input fact) "value"))', { input: { facts: FACTS, fact: FACTS[0] } });
  assert.equal(G(l), false, 'collect list labels ' + l.labels);
  const k = await go('(collect (f (input facts)) (get f "value"))');
  assert.equal(G(k), true, 'a projection of a grounded list stays grounded: ' + k.labels);
});
