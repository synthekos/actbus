// credentials.test.js — v1.2.0 · tests: credentials follow data only, never control · changelog: act/CHANGELOG.md#acttestcredentialstestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// F-B (ACTBUS docs/reviews.md, PROTEUS-K review finding 1): CREDENTIALS FOLLOW DATA ONLY.
// `grounded` is a credential ("this was read from the documents"), not a warning. A value is grounded only if EVERY data
// input to it is grounded; a condition, a selector key or an earlier and/or operand never lends it. Warnings (person, web,
// model, computed, device) still follow data AND control, exactly as before. Run: node --test test/credentials.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../proteus/reader');
const { run, memState } = require('../proteus/eval');

const ACTIONS = new Set(['echo']);
function bus() {
  const log = [];
  return { log, callAction: async (action, input, meta) => { log.push({ action, input, ...meta }); return { ok: true, value: { ok: true }, labels: ['computed', 'device'] }; } };
}
const FACTS = [{ item: 'Widget', value: '38', unit: 'kg' }, { item: 'Gadget', value: '12', unit: 'kg' }];
const go = (src, o = {}) => { const b = o.bus || bus(); return run(read(src), { actions: ACTIONS, callAction: b.callAction, input: { facts: FACTS, fact: FACTS[0], flag: true, name: 'Widget' }, inputLabels: ['grounded'], ...o }).then((r) => ({ ...r, log: b.log })); };
const G = (r) => r.labels.includes('grounded');

// ---- PROTEUS-K review finding 1 (ACTBUS docs/reviews.md): a value the PROGRAM wrote must not come out grounded ----
test('F-B: a literal reached through and/or is not grounded (PROTEUS-K review finding 1 repro, ACTBUS docs/reviews.md)', async () => {
  const r = await go('(and (input facts) "38")');
  assert.equal(r.value, '38');
  assert.equal(G(r), false, 'labels ' + r.labels);
  assert.ok(r.labels.includes('person'));
  assert.equal(G(await go('(or false (input flag) "38")')), true, 'or returns (input flag) itself: data, grounded');
  assert.equal(G(await go('(or (= 1 2) "38")')), false);
});
test('F-B: arithmetic with a literal operand is not grounded (the (* 0 …) trick)', async () => {
  const r = await go('(+ 38 (* 0 (len (input facts))))');
  assert.equal(r.value, '38');
  assert.equal(G(r), false, 'labels ' + r.labels);
  assert.ok(r.labels.includes('computed'));
});
test('F-B: a conditional lends its condition no credential', async () => {
  assert.equal(G(await go('(if (input flag) "38" "39")')), false);
  assert.equal(G(await go('(when (input flag) "38")')), false);
  assert.equal(G(await go('(unless (input flag) "38")')), false, 'the nil of a skipped branch');
  assert.equal(G(await go('(str (input name) " weighs " "38")')), false, 'text joined with a literal');
});
test('F-B: remember does not launder a credential through state', async () => {
  const r = await go('(do (remember x (if (input flag) "38" "0")) (remembered x))');
  assert.equal(r.value, '38');
  assert.equal(G(r), false, 'labels ' + r.labels);
  const st = memState();
  await go('(do (input facts) (remember y "38"))', { state: st });           // sticky control saw grounded before the write
  assert.equal(st.dump().y.labels.includes('grounded'), false, 'stored labels ' + st.dump().y.labels);
});
test('F-B: an action receives no credential the data did not have', async () => {
  const b = bus();
  await go('(echo :v (and (input facts) "38"))', { bus: b });
  assert.equal(b.log[0].labels.includes('grounded'), false, 'sent labels ' + b.log[0].labels);
  assert.equal(b.log[0].ctl.includes('grounded'), false, 'round 3: control is never a credential: ' + b.log[0].ctl);
});
test('F-B: a list holding a literal is not grounded, and its literal item does not become grounded', async () => {
  assert.equal(G(await go('(list (input fact) "x")')), false);
  const st = memState();
  await go('(for-each (i (list (input fact) "x")) (when (= i "x") (remember got i)))', { state: st });
  assert.equal(st.dump().got.labels.includes('grounded'), false, 'stored labels ' + st.dump().got.labels);
});

// ---- what must STAY grounded: the honest lookups ----
test('F-B keeps: a field read from a grounded fact (the selector key is not data)', async () => {
  const r = await go('(get (input fact) "value")');
  assert.equal(r.value, '38'); assert.equal(G(r), true, 'labels ' + r.labels);
});
test('F-B keeps: the Widget lookup by for-each + when + remember', async () => {
  const r = await go('(do (for-each (f (input facts)) (when (= (get f "item") "Widget") (remember w (get f "value")))) (remembered w))');
  assert.equal(r.value, '38'); assert.equal(G(r), true, 'labels ' + r.labels);
});
test('F-B round 3 (literal rule): arithmetic on grounded values is computed, NOT grounded; a parsed number and a pass-through keep it', async () => {
  const r = await go('(+ (number (get (input fact) "value")) (number (get (input fact) "value")))');
  assert.equal(r.value, '76'); assert.ok(!G(r) && r.labels.includes('computed'), 'labels ' + r.labels);
  assert.equal(G(await go('(number (get (input fact) "value"))')), true, 'number parsed from grounded text: the same value');
  assert.equal(G(await go('(if (input flag) (input name) (input name))')), true, 'both branches grounded data');
});

// ---- warnings are unchanged: they still follow control ----
test('F-B unchanged: warnings still flow through conditions, and/or, remember', async () => {
  const w = { inputLabels: ['web'] };
  assert.ok((await go('(if (input flag) "38" "39")', w)).labels.includes('web'));
  assert.ok((await go('(and (input facts) "38")', w)).labels.includes('web'));
  assert.ok((await go('(do (remember x (if (input flag) 1 2)) (remembered x))', w)).labels.includes('web'));
  const b = bus(); await go('(echo :v (and (input facts) "38"))', { ...w, bus: b });
  assert.ok(b.log[0].labels.includes('web'), 'sent labels ' + b.log[0].labels);
});

// ---- review 2 (3 Nov) + owner decision: a length is never grounded; nil read from nothing and errors carry no credential ----
test('F-B review F3: a length is never grounded (the program chose how many copies), and it is computed', async () => {
  const r = await go('(len (list (input name) (input name) (input name)))');
  assert.equal(r.value, '3'); assert.equal(G(r), false, 'labels ' + r.labels); assert.ok(r.labels.includes('computed'));
  assert.equal(G(await go('(len (input facts))')), false, 'owner decision: not even the length of a grounded list');
  assert.equal(G(await go('(len (input name))')), false, 'nor of grounded text');
});
test('F-B review F5: a list of unlabelled values is person, as before 1.1.2', async () => {
  assert.deepEqual((await go('(list (input name))', { inputLabels: [] })).labels, ['person']);
});
test('F-B review F6: nil read from nothing is not grounded', async () => {
  assert.equal(G(await go('(input missing)')), false);
  assert.equal(G(await go('(str (input missing))')), false);
  assert.equal(G(await go('(get (input fact) "no-such-field")')), false);
  assert.equal(G(await go('(get (input fact) "value")')), true, 'a field that IS there stays grounded');
});
test('F-B review F7: an error never carries a credential', async () => {
  await assert.rejects(go('(do (input name) (fail "38"))'), (e) => e.code === 'FAIL' && !e.labels.includes('grounded') && e.labels.includes('person'));
  await assert.rejects(go('(do (input facts) (+ 1 "x"))'), (e) => e.code === 'RUN' && !e.labels.includes('grounded'));
});

// ---- round 3 (review 3, 3 Nov) + owner decision: the literal rule ----
test('F-B round 3: a count built by arithmetic in a loop is not grounded (review 3 UNSAFE 2)', async () => {
  const src = '(let ((g (number (get (input fact) "value")))) (remember c (- g g)) (for-each (x (input facts)) (remember c (+ (remembered c) (/ g g)))) (remembered c))';
  const r = await go(src);
  assert.equal(r.value, '2'); assert.equal(G(r), false, 'labels ' + r.labels);
});
test('F-B round 3: comparisons, joined text and not are computed values — never grounded', async () => {
  for (const src of ['(= (input name) (input name))', '(< (number (get (input fact) "value")) (number (get (input fact) "value")))',
    '(str (input name))', '(str (input name) (input name))', '(not (input flag))']) {
    const r = await go(src); assert.equal(G(r), false, src + ' labels ' + r.labels);
  }
  assert.equal(G(await go('(if (= (input name) "Widget") (input name) "no")')), true, 'a branch that passes a document value through keeps it');
});
