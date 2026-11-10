// stdlib.test.js — v1.0.0 · tests: the standard library — values, limits and labels · changelog: act/CHANGELOG.md#actteststdlibtestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// eval 1.6.0 (ACTBUS docs/functions-and-mailboxes.md §2): the standard library — values, limits, and LABELS by the literal rule
// (selection keeps an item's credential, parsing keeps it + computed, containers are data, everything else computed). Every test
// FAILS on eval 1.5.0 (none of these is built in). Run: node --test test/stdlib.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { read } = require(path.join(ROOT, 'proteus/reader'));
const { check, run } = require(path.join(ROOT, 'proteus/eval'));
const go = (src, opt = {}) => run(read(src), { actions: new Set(), ...opt });
const val = async (src, opt) => (await go(src, opt)).value;
const runErr = (src, re, opt) => assert.rejects(go(src, opt), (e) => e.code === 'RUN' && re.test(e.message), src);
const G = { input: { facts: [{ v: '38', u: 'kg' }, { v: '12', u: 'lb' }], t: '  Café Rate  ', j: '{"rate":0.73,"list":[1,2]}', n: '5' }, inputLabels: ['grounded'] };
const W = { ...G, inputLabels: ['web'] };
const labels = async (src, opt) => (await go(src, opt)).labels;

test('text: upper lower trim contains? starts-with? ends-with? split join replace', async () => {
  assert.equal(await val('(upper "café")'), 'CAFÉ');
  assert.equal(await val('(lower "ABC")'), 'abc');
  assert.equal(await val('(trim "  a b  ")'), 'a b');
  assert.equal(await val('(contains? "hello" "ell")'), true);
  assert.equal(await val('(starts-with? "hello" "he")'), true);
  assert.equal(await val('(ends-with? "hello" "lo")'), true);
  assert.deepEqual(await val('(split "a,b,,c" ",")'), ['a', 'b', '', 'c']);
  assert.deepEqual(await val('(split "añb" "")'), ['a', 'ñ', 'b']);
  assert.equal(await val('(join (list "a" 1.5 "c") "-")'), 'a-1.5-c');
  assert.equal(await val('(replace "a-b-c" "-" "+")'), 'a+b+c');
  await runErr('(replace "abc" "" "x")', /non-empty text to find/);
  await runErr('(join (list (list 1)) ",")', /joins text and numbers/);
  await runErr('(upper 1)', /needs text/);
});

test('lists: first last nth take drop reverse append range empty?', async () => {
  assert.equal(await val('(first (list 1 2 3))'), '1');
  assert.equal(await val('(last (list 1 2 3))'), '3');
  assert.equal(await val('(first (list))'), null);
  assert.equal(await val('(nth (list "a" "b") 1)'), 'b');
  assert.equal(await val('(nth (list "a" "b") 5)'), null);
  assert.deepEqual(await val('(take (list 1 2 3) 2)'), ['1', '2']);
  assert.deepEqual(await val('(drop (list 1 2 3) 2)'), ['3']);
  assert.deepEqual(await val('(reverse (list 1 2 3))'), ['3', '2', '1']);
  assert.deepEqual(await val('(append (list 1) (list) (list 2 3))'), ['1', '2', '3']);
  assert.deepEqual(await val('(range 3)'), ['0', '1', '2']);
  assert.deepEqual(await val('(range 2 5)'), ['2', '3', '4']);
  assert.equal(await val('(empty? (list))'), true);
  assert.equal(await val('(empty? "")'), true);
  assert.equal(await val('(empty? nil)'), true);
  assert.equal(await val('(empty? "x")'), false);
  await runErr('(nth (list 1) 1.5)', /whole number/);
  await runErr('(take (list 1) -1)', /whole number/);
  await runErr('(range 1001)', /whole number from 0 to 1000/);
  await runErr('(range 0 2000)', /longer than 1000 items/);
});

test('records: record has? keys, and get on a built record; the dangerous keys are refused', async () => {
  assert.equal(await val('(get (record "a" 1 "b" "x") "a")'), '1');
  assert.equal(await val('(has? (record "a" 1) "a")'), true);
  assert.equal(await val('(has? (record "a" 1) "toString")'), false, 'nothing inherited');
  assert.deepEqual(await val('(keys (record "a" 1 "b" 2))'), ['a', 'b']);
  await runErr('(record "a" 1 "a" 2)', /twice/);
  await runErr('(record "__proto__" 1)', /cannot use the key/);
  assert.throws(() => check(read('(record "a")'), new Set()), /key" value pairs/);
});

test('numbers: min max abs round (half away from zero, exact)', async () => {
  assert.equal(await val('(max 3 9 2)'), '9');
  assert.equal(await val('(min 3 9 2)'), '2');
  assert.equal(await val('(abs -4.5)'), '4.5');
  assert.equal(await val('(round 2.5)'), '3');
  assert.equal(await val('(round -2.5)'), '-3');
  assert.equal(await val('(round 2.4)'), '2');
  assert.equal(await val('(round 1.005 2)'), '1.01', 'exact decimals: no binary 1.00499…');
  assert.equal(await val('(round (/ 1 3) 2)'), '0.33');
  assert.equal(await val('(round (/ 2 3) 4)'), '0.6667');
  await runErr('(round 1 31)', /whole number from 0 to 30/);
});

test('json and kinds: parse-json to-json number? text? list? record? nil?', async () => {
  assert.equal(await val('(get (parse-json "{\\"rate\\":0.73}") "rate")'), '0.73');
  assert.deepEqual(await val('(parse-json "[1, 2.5, \\"x\\", null]")'), ['1', '2.5', 'x', null]);
  assert.equal(await val('(to-json (list 1 "a" (record "k" true)))'), '["1","a",{"k":true}]');
  await runErr('(parse-json "{oops")', /not JSON/);
  await runErr('(parse-json ' + JSON.stringify('['.repeat(40) + ']'.repeat(40)) + ')', /nested deeper than 32/);
  assert.deepEqual(await val('(list (number? 1) (text? "a") (list? (list)) (record? (record)) (nil? nil) (number? "1"))'), [true, true, true, true, true, false]);
});

test('(now): the time the run was given, labelled device; refused when there is none', async () => {
  const r = await go('(now)', { now: '2026-11-04T13:00:00.000Z' });
  assert.equal(r.value, '2026-11-04T13:00:00.000Z'); assert.deepEqual(r.labels, ['device']);
  await runErr('(now)', /not available here/);
});

test('LABELS — selection keeps an item\'s credential: first last nth take drop reverse min max', async () => {
  for (const src of ['(get (first (input facts)) "v")', '(get (last (input facts)) "v")', '(get (nth (input facts) 1) "v")',
    '(get (first (take (input facts) 1)) "v")', '(get (first (drop (input facts) 1)) "v")', '(get (first (reverse (input facts))) "v")'])
    assert.ok((await labels(src, G)).includes('grounded'), src);
  assert.ok((await labels('(max (number (get (first (input facts)) "v")) (number (get (last (input facts)) "v")))', G)).includes('grounded'), 'max picks a grounded number');
  assert.ok(!(await labels('(max (number (get (first (input facts)) "v")) 100)', G)).includes('grounded'), 'max picked the written 100: not grounded');
});

test('LABELS — parsing keeps it (+ computed); containers are data; everything else is computed (no credential)', async () => {
  const p = await labels('(get (parse-json (input j)) "rate")', G);
  assert.ok(p.includes('grounded') && p.includes('computed'), p.join());
  assert.ok((await labels('(append (input facts) (input facts))', G)).includes('grounded'), 'a container of grounded lists');
  assert.ok((await labels('(record "a" (input t))', G)).includes('grounded'), 'a container of a grounded value');
  for (const src of ['(upper (input t))', '(trim (input t))', '(lower (input t))', '(replace (input t) "a" "b")', '(split (input t) " ")',
    '(join (list (input t)) ",")', '(contains? (input t) "a")', '(keys (first (input facts)))', '(abs (number (input n)))', '(round (number (input n)))',
    '(to-json (input facts))', '(empty? (input facts))', '(has? (first (input facts)) "v")', '(text? (input t))', '(range (number (input n)))'])
    assert.ok(!(await labels(src, G)).includes('grounded'), src + ' must not be grounded');
});

test('LABELS — warnings still flow: web text stays web through every function', async () => {
  for (const src of ['(upper (input t))', '(split (input t) " ")', '(first (input facts))', '(parse-json (input j))', '(join (list "x" (input t)) "")',
    '(record "a" (input t))', '(min (number (input n)) 9)', '(take (input facts) 1)', '(keys (first (input facts)))'])
    assert.ok((await labels(src, W)).includes('web'), src);
});

test('the new built-ins are reserved names (a script cannot shadow them) and are pure (usable in collection forms)', async () => {
  assert.throws(() => check(read('(let ((first 1)) first)'), new Set()), /"first" is a form or action name/);
  assert.deepEqual(await val('(collect (s (list " a " "b ")) (upper (trim s)))'), ['A', 'B']);
  assert.deepEqual(await val('(filter (s (list "apple" "kiwi")) (contains? s "pp"))'), ['apple']);
});
