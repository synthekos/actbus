// collect.test.js — v1.0.1 · tests: the PROTEUS-K collection forms · changelog: act/CHANGELOG.md#acttestcollecttestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// PROTEUS-K collection forms (eval 1.2.0). Every test here FAILS on eval
// 1.1.0 (there, filter/count/… are unknown names and the script is refused at load).
// Run: node --test --test-reporter=tap test/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../proteus/reader');
const { run, check, ScriptError, LIMITS } = require('../proteus/eval');
const { survey } = require('../proteus/engine');

const ACTIONS = new Set(['fetch', 'file-append', 'calc']);
function bus() {
  const log = [];
  const callAction = async (action, input, meta) => {
    log.push({ action, input, ...meta });
    if (action === 'fetch') return { ok: true, value: { limit: '2.5', name: 'P-2', items: [{ v: '9' }] }, labels: ['device', 'web'] };
    return { ok: true, value: { written: true }, labels: ['computed', 'device'] };
  };
  return { log, callAction };
}
// facts as a replay will pass them: a list of records, labelled grounded
const FACTS = [
  { item: 'P-1', attr: 'max-flow', value: '2.8', unit: 'L/s' },
  { item: 'P-2', attr: 'max-flow', value: '1.9', unit: 'L/s' },
  { item: 'P-3', attr: 'max-flow', value: '3.15', unit: 'L/s' },
  { item: 'P-4', attr: 'max-flow', value: '2.8', unit: 'L/s' },
];
const go = (src, o = {}) => { const b = o.bus || bus(); return run(read(src), { actions: ACTIONS, callAction: b.callAction, input: { facts: FACTS }, inputLabels: ['grounded'], ...o }).then((r) => ({ ...r, log: b.log })); };
const rejects = (p, code, re) => assert.rejects(p, (e) => e instanceof ScriptError && e.code === code && (!re || re.test(e.message)));
const WEB = '(number (get (fetch :url "https://page.example") "limit"))';
const V = '(number (get f "value"))';

test('values: count, sum (exact), filter, collect, max-by, min-by, sort-by', async () => {
  assert.equal((await go(`(count (f (input facts)) (> ${V} 2))`)).value, '3');
  assert.equal((await go(`(sum (f (input facts)) ${V})`)).value, '10.65');                       // exact: 2.8+1.9+3.15+2.8
  assert.equal((await go('(sum (x (list 0.1 0.2)) x)')).value, '0.3');                              // no float error
  assert.deepEqual((await go(`(collect (f (filter (f (input facts)) (> ${V} 2))) (get f "item"))`)).value, ['P-1', 'P-3', 'P-4']);
  assert.equal((await go(`(get (max-by (f (input facts)) ${V}) "item")`)).value, 'P-3');
  assert.equal((await go(`(get (min-by (f (input facts)) ${V}) "item")`)).value, 'P-2');
  assert.deepEqual((await go(`(collect (f (sort-by (f (input facts)) ${V})) (get f "item"))`)).value, ['P-2', 'P-1', 'P-4', 'P-3']);
  assert.deepEqual((await go('(sort-by (s (list "b" "a" "c")) s)')).value, ['a', 'b', 'c']);
});

test('ties and empty lists: max-by keeps the first; sort-by is stable; empty → nil / 0', async () => {
  assert.equal((await go('(get (max-by (f (filter (f (input facts)) (= (get f "value") "2.8"))) (number (get f "value"))) "item")')).value, 'P-1');
  assert.deepEqual((await go(`(collect (f (sort-by (f (input facts)) (if (> ${V} 2) 1 0))) (get f "item"))`)).value, ['P-2', 'P-1', 'P-3', 'P-4']);
  assert.equal((await go(`(max-by (f (filter (f (input facts)) (> ${V} 99))) ${V})`)).value, null);
  assert.equal((await go('(count (x (list)) true)')).value, '0');
  assert.equal((await go('(sum (x (list)) x)')).value, '0');
});

test('pure bodies: an action call or remember inside a collection form is refused at LOAD', () => {
  const bad = (src, re) => assert.throws(() => check(read(src), ACTIONS), (e) => e.code === 'CHECK' && re.test(e.message), src);
  bad('(count (x (list 1 2)) (fetch :url "https://a.example"))', /no action call inside \(count/);
  bad('(filter (x (list 1)) (do (file-append :name "a" :text "b") true))', /no action call inside \(filter/);
  bad('(sum (x (list 1)) (let ((y (calc :expr "1"))) 1))', /no action call inside \(sum/);
  bad('(collect (x (list 1)) (when true (for-each (y (list 1)) (file-append :name "a" :text "b"))))', /no action call inside \(collect/);
  bad('(max-by (x (list 1)) (remember k x))', /\(remember …\) cannot be inside \(max-by/);
  bad('(count (x (list 1)) true false)', /\(count \(name list\) one-form\)/);
  bad('(count x (list 1))', /\(count \(name list\) one-form\)/);
  bad('(let ((count 1)) count)', /"count" is a form or action name/);
  bad('(sum (fetch (list 1)) 1)', /"fetch" is a form or action name/);
  // an action call in the LIST part is fine (it runs once, outside the body)
  assert.doesNotThrow(() => check(read('(count (x (get (fetch :url "https://a.example") "items")) true)'), ACTIONS));
});

test('labels: web data that CHOOSES items is carried by everything chosen (rule b data labels)', async () => {
  // grounded facts, a web threshold: which items survive depends on the page
  const r1 = await go(`(let ((lim ${WEB})) (for-each (f (filter (f (input facts)) (> ${V} lim))) (file-append :name "out" :text (get f "item"))))`);
  const w1 = r1.log.filter((c) => c.action === 'file-append');
  assert.equal(w1.length, 3);                                                      // 2.8, 3.15, 2.8 > 2.5
  for (const c of w1) assert.ok(c.labels.includes('web'), 'a filtered item written out must carry web: ' + c.labels);
  // max-by with a web-derived key: the picked item's field carries web
  const r2 = await go(`(let ((lim ${WEB})) (file-append :name "o" :text (get (max-by (f (input facts)) (if (> ${V} lim) 1 0)) "item")))`);
  assert.ok(r2.log.find((c) => c.action === 'file-append').labels.includes('web'));
  // sort-by on web keys: the first item's field carries web
  const r3 = await go(`(let ((lim ${WEB})) (for-each (f (sort-by (f (input facts)) (- ${V} lim))) (file-append :name "o" :text (get f "item"))))`);
  for (const c of r3.log.filter((c) => c.action === 'file-append')) assert.ok(c.labels.includes('web'));
  // count / sum under a web condition
  const r4 = await go(`(let ((lim ${WEB})) (file-append :name "o" :text (str (count (f (input facts)) (> ${V} lim)))))`);
  assert.ok(r4.log.find((c) => c.action === 'file-append').labels.includes('web'));
  const r5 = await go(`(let ((lim ${WEB})) (file-append :name "o" :text (str (sum (f (input facts)) (if (> ${V} lim) 1 0)))))`);
  assert.ok(r5.log.find((c) => c.action === 'file-append').labels.includes('web'));
  // collect's values carry web when the body used web
  const r6 = await go(`(let ((lim ${WEB})) (file-append :name "o" :text (str (len (collect (f (input facts)) lim)))))`);
  assert.ok(r6.log.find((c) => c.action === 'file-append').labels.includes('web'));
  // a WEB list (the page's own items): everything taken from it is web
  const r7 = await go('(file-append :name "o" :text (str (count (x (get (fetch :url "https://a.example") "items")) true)))');
  assert.ok(r7.log.find((c) => c.action === 'file-append').labels.includes('web'));
});

test('labels: no over-tainting — grounded facts and the script\'s own constants stay grounded/person', async () => {
  const r = await go(`(file-append :name "o" :text (get (max-by (f (input facts)) ${V}) "item"))`);
  const c = r.log.find((x) => x.action === 'file-append');
  assert.ok(!c.labels.includes('web') && !c.labels.includes('model'), String(c.labels));
  // F-B (031126, ACTBUS docs/reviews.md, PROTEUS-K review finding 1): every input of an action call is data — the literal :name "o" is not grounded, so the call
  // is not; and a count decided by a comparison with the literal 2 is computed, not read from the documents
  assert.ok(!c.labels.includes('grounded'), 'F-B: ' + c.labels);
  const v = await go(`(count (f (input facts)) (> ${V} 2))`);
  assert.deepEqual(v.labels, ['computed', 'person']);
});

test('control: a collection body runs under the list\'s labels (sticky control sees them)', async () => {
  const r = await go('(do (count (x (get (fetch :url "https://a.example") "items")) true) (file-append :name "o" :text "fixed"))');
  const c = r.log.find((x) => x.action === 'file-append');
  assert.ok(c.ctl.includes('web'), 'the later write ran after web data was read: ctl ' + c.ctl);
  assert.ok(!c.labels.includes('web'), 'its constant text is not web: ' + c.labels);
});

test('limits and errors: wrong kinds, mixed keys, more than 1 000 items, fuel', async () => {
  await rejects(go('(count (x "abc") true)'), 'RUN', /needs a list, got text/);
  await rejects(go('(sum (f (input facts)) (get f "item"))'), 'RUN', /\(sum …\) needs a number/);
  await rejects(go('(max-by (s (list 1 "a")) s)'), 'RUN', /cannot compare a number with text/);
  await rejects(go('(sort-by (s (list (list 1) (list 2))) s)'), 'RUN', /needs a number or text/);
  const big = Array.from({ length: LIMITS.LIST + 1 }, (_, i) => ({ value: String(i) }));
  await rejects(go('(count (f (input facts)) true)', { input: { facts: big } }), 'RUN', /a list longer than 1000 items/);
  const many = Array.from({ length: 1000 }, (_, i) => ({ value: String(i) }));
  await rejects(go(`(sum (f (input facts)) ${V})`, { input: { facts: many }, fuel: 500 }), 'FUEL');
  assert.equal((await go(`(sum (f (input facts)) ${V})`, { input: { facts: many } })).value, '499500');
});

test('reach: collection forms add no action to what a script can reach (engine survey)', () => {
  const s = survey(read('(let ((n (count (f (input facts)) true))) (when (> n 2) (file-append :name "o" :text "many")))'));
  assert.deepEqual(s.calls.map((c) => c.name).filter((n) => ACTIONS.has(n)), ['file-append']);
  assert.deepEqual(check(read('(sum (x (list 1 2)) x)'), ACTIONS).calls, []);
});
