// eval.test.js — v1.0.0 · tests: the PROTEUS-K evaluator · changelog: act/CHANGELOG.md#acttestevaltestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// PROTEUS-K evaluator (ACTBUS docs/proteus-k.md §3–§6). Run: node --test --test-reporter=tap test/*.test.js
// A fake action bus stands in for the capability core (step 3 wires the real one): fetch returns web-labelled data.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../proteus/reader');
const { run, check, memState, ScriptError, LIMITS } = require('../proteus/eval');

const ACTIONS = new Set(['fetch', 'file-append', 'calc', 'model']);
function bus() {
  const log = [];
  const callAction = async (action, input, meta) => {
    log.push({ action, input, ...meta });
    if (action === 'fetch') return { ok: true, value: { text: 'rate 1.3725', rate: '1.3725', items: ['a', 'b', 'c'] }, labels: ['device', 'web'] };
    if (action === 'calc') return { ok: true, value: { result: '14119203', exact: true }, labels: ['computed', 'device'] };
    if (action === 'model') return { ok: false, code: 'NOT_PERMITTED', error: 'not permitted', labels: ['device'] };
    return { ok: true, value: { written: true }, labels: ['computed', 'device'] };
  };
  return { log, callAction };
}
const go = (src, o = {}) => { const b = o.bus || bus(); return run(read(src), { actions: ACTIONS, callAction: b.callAction, inputLabels: ['device'], ...o }).then((r) => ({ ...r, log: b.log })); };
const rejects = (p, code, re) => assert.rejects(p, (e) => e instanceof ScriptError && e.code === code && (!re || re.test(e.message)));
const has = (labels, l) => labels.includes(l);
const WEB = '(get (fetch :url "https://bank.example") "rate")';

test('check: refused at load, with the place', () => {
  const bad = (src, re) => assert.throws(() => check(read(src), ACTIONS), (e) => e.code === 'CHECK' && re.test(e.message), src);
  bad('(send-money :to "x")', /no action named "send-money"/);
  bad('x', /unknown name "x"/);
  bad('(if true 1)', /exactly 3 parts/);
  bad('(let ((if 1)) 2)', /"if" is a form or action name/);
  bad('(let ((fetch 1)) 2)', /"fetch" is a form or action name/);
  bad('(let ((x 1)) (x))', /"x" is a value, not something to call/);
  bad('(fetch :url "a" :url "b")', /:url given twice/);
  bad('(fetch "a" "b")', /expected :name/);
  bad('(fetch :url)', /:name value pairs/);
  bad(':url', /keyword/);
  bad('()', /\(\) is not a form/);
  bad('(1 2)', /must start with a name/);
  bad('fetch', /must be called/);
  bad('(for-each x (list 1))', /\(for-each \(name list\)/);
  bad('(input "url")', /written as-is/);
  bad('(remember "k" 1)', /key of remember must be a name/);
  bad('(+)', /at least 1 value/);
  bad('(not 1 2)', /takes 1 value/);
  bad('(let ((a 1)) a) a', /unknown name "a"/);                     // let scope ends with the let
  assert.throws(() => check(read('(do 1\n  (bogus))'), ACTIONS), (e) => e.line === 2 && e.col === 4 && /no action named "bogus"/.test(e.message));   // points at the name
  assert.deepEqual(check(read('(do (fetch :url "u") (calc :expr "1"))'), ACTIONS).calls.map((c) => c.action), ['fetch', 'calc']);
});

test('a script with a load error never starts — no action runs', async () => {
  const b = bus();
  await rejects(go('(fetch :url "u")\n(bogus)', { bus: b }), 'CHECK');
  assert.equal(b.log.length, 0);
});

test('exact arithmetic (rational.js), no floating point', async () => {
  assert.equal((await go('(+ 0.1 0.2)')).value, '0.3');
  assert.equal((await go('(= (+ 0.1 0.2) 0.3)')).value, true);
  assert.equal((await go('(* 4837 2919)')).value, '14119203');
  assert.equal((await go('(- 5)')).value, '-5');
  assert.equal((await go('(- 10 2 3)')).value, '5');
  assert.equal((await go('(str (/ 1 3))')).value, '1/3');
  assert.equal((await go('(= (* (/ 1 3) 3) 1)')).value, true);
  await rejects(go('(/ 1 0)'), 'RUN', /division by zero/);
  await rejects(go('(/ 1 3)'), 'RUN', /no exact decimal form/);
  const big = '1' + '0'.repeat(1300);                                  // ~4 320 bits; squared > 8 192
  await rejects(go('(* ' + big + ' ' + big + ')'), 'RUN', /too large/);
  await rejects(go('(< "a" 1)'), 'RUN', /needs a number/);
});

test('values: truthiness, =, str, len, get, number, input', async () => {
  assert.equal((await go('(if 0 "yes" "no")')).value, 'yes');
  assert.equal((await go('(if "" "yes" "no")')).value, 'yes');
  assert.equal((await go('(if nil "yes" "no")')).value, 'no');
  assert.equal((await go('(= "a" 1)')).value, false);
  assert.equal((await go('(= nil nil)')).value, true);
  await rejects(go('(= (list 1) (list 1))'), 'RUN', /compares numbers/);
  assert.equal((await go('(str "a" 1.50 true nil)')).value, 'a1.5true');
  assert.equal((await go('(len "Київ")')).value, '4');
  assert.equal((await go('(len (list 1 2 3))')).value, '3');
  assert.equal((await go('(get (fetch :url "u") "missing")')).value, null);
  await rejects(go('(get "x" "y")'), 'RUN', /needs a record/);
  assert.equal((await go('(number "  1.25 ")')).value, '1.25');
  assert.equal((await go('(number "-2")')).value, '-2');
  await rejects(go('(number "1,000")'), 'RUN', /not a decimal/);
  assert.equal((await go('(input missing)', { input: {} })).value, null);
  assert.equal((await go('(+ (input n) 1)', { input: { n: 1.5 } })).value, '2.5');
  await rejects(go('(input n)', { input: { n: 1e21 } }), 'RUN', /too large or small/);
  assert.deepEqual((await go('(list 1 "a" (list true))')).value, ['1', 'a', [true]]);
  assert.deepEqual((await go('(calc :expr "4837 * 2919")')).log[0].input, { expr: '4837 * 2919' });
  assert.deepEqual((await go('(fetch :url "u" :n 2.50)')).log[0].input, { url: 'u', n: '2.5' });   // numbers go as exact text
});

test('labels: literals are person, input carries the envelope labels', async () => {
  assert.deepEqual((await go('"x"')).labels, ['person']);
  assert.deepEqual((await go('(input u)', { input: { u: 'x' } })).labels, ['device']);
  assert.deepEqual((await go('(+ 1 2)')).labels, ['computed', 'person']);
});

test('rule 1 — web data stays web through str, get, number, +, let, not', async () => {
  for (const src of [
    '(str "rate: " ' + WEB + ')',
    '(+ (number ' + WEB + ') 1)',
    '(let ((r ' + WEB + ')) (let ((s (str r))) s))',
    '(not ' + WEB + ')',
    '(len ' + WEB + ')',
  ]) assert.ok(has((await go(src)).labels, 'web'), src);
  const r = await go('(file-append :name "x.txt" :text (str "rate " ' + WEB + '))');
  assert.ok(has(r.log[1].labels, 'web'));                               // the bus will refuse this world call
  assert.ok(has(r.log[1].ctl, 'web'), 'sticky control (1.1.0): the call came after the page was read');
});

test('rule 3 — a conditional\'s VALUE carries the condition (no laundering through constants)', async () => {
  const cond = '(= ' + WEB + ' "1.3725")';
  for (const src of [
    '(if ' + cond + ' "A" "B")',
    '(when ' + cond + ' "A")',
    '(unless ' + cond + ' "A")',
    '(or false ' + WEB + ')',
    '(and ' + cond + ' "A")',
  ]) assert.ok(has((await go(src)).labels, 'web'), src);
  const r = await go('(file-append :name "x.txt" :text (if ' + cond + ' "A" "B"))');
  assert.ok(has(r.log[1].labels, 'web'), 'an if-chosen constant is web data');
  assert.deepEqual((await go('(and true "A")')).labels, ['person']);
});

test('rule 2 — a fixed action fired under a web condition: data person, ctl web (decision b)', async () => {
  const r = await go('(when (< (number ' + WEB + ') 2) (file-append :name "x.txt" :text "hello"))');
  assert.equal(r.log.length, 2);
  assert.deepEqual(r.log[1].labels, ['person']);
  assert.ok(has(r.log[1].ctl, 'web'));
  const a = await go('(and (= ' + WEB + ' "1.3725") (file-append :name "x.txt" :text "hi"))');
  assert.ok(has(a.log[1].ctl, 'web'), 'and: later operands run under the earlier ones');
  const o = await go('(or (= ' + WEB + ' "no") (file-append :name "x.txt" :text "hi"))');
  assert.ok(has(o.log[1].ctl, 'web'), 'or: the same');
  // sticky control (1.1.0, self-review S2): the next top-level form ran only because the script had not stopped — the
  // page could have stopped it (a fail, an action error) — so it is web-controlled too; its DATA stays person
  const s = await go('(when (= ' + WEB + ' "1.3725") "x")\n(file-append :name "x.txt" :text "z")');
  assert.ok(has(s.log[1].ctl, 'web'), 'after reading the page, every later call is web-controlled');
  assert.deepEqual(s.log[1].labels, ['person']);
  const clean = await go('(when (= 1 1) "x")\n(file-append :name "x.txt" :text "z")');
  assert.ok(!has(clean.log[0].ctl, 'web') && !has(clean.log[0].ctl, 'model'), 'a script that read nothing tainted stays clean');
  const seeded = await go('(file-append :name "x.txt" :text "z")', { ctl: ['web'] });
  assert.ok(has(seeded.log[0].ctl, 'web'), 'a script CALLED under web control runs under it (S4)');
});

test('rule 4 — remember under a condition stores the condition; it comes back as data', async () => {
  const state = memState();
  await go('(when (= ' + WEB + ' "1.3725") (remember flag "go"))', { state });
  assert.ok(has(state.get('flag').labels, 'web'));
  const r = await go('(file-append :name "x.txt" :text (remembered flag))', { state });
  assert.ok(has(r.log[0].labels, 'web'), 'a value remembered under web control is web data next run');
  const absent = await go('(remembered other)', { state });
  assert.equal(absent.value, null);
  assert.ok(has(absent.labels, 'web'), 'a MISSING key carries the labels of every write (absence can be steered)');
  const clean = await go('(remembered other)', { state: memState() });
  assert.deepEqual(clean.labels, ['person']);
});

test('for-each: body runs under the list\'s labels; items carry them', async () => {
  const r = await go('(for-each (i (get (fetch :url "u") "items")) (file-append :name "x.txt" :text "k"))');
  assert.equal(r.log.length, 4);
  for (const c of r.log.slice(1)) { assert.deepEqual(c.labels, ['person']); assert.ok(has(c.ctl, 'web')); }
  const d = await go('(for-each (i (get (fetch :url "u") "items")) (file-append :name "x.txt" :text i))');
  for (const c of d.log.slice(1)) assert.ok(has(c.labels, 'web'));
  // laundering attempt: a web condition CHOOSES between constant lists; the items must still be web data
  const w = await go('(for-each (i (if (= ' + WEB + ' "1.3725") (list "a" "b") (list "c"))) (file-append :name "x.txt" :text i))');
  assert.equal(w.log.length, 3);
  for (const c of w.log.slice(1)) assert.ok(has(c.labels, 'web'), 'an item of a web-chosen list is web data');
  await rejects(go('(for-each (i "abc") 1)'), 'RUN', /needs a list/);
});

test('errors carry labels: fail and a refused action', async () => {
  await assert.rejects(go('(fail (str "bad rate " ' + WEB + '))'), (e) => e.code === 'FAIL' && e.labels.includes('web') && /bad rate 1.3725/.test(e.message));
  await assert.rejects(go('(when (= ' + WEB + ' "1.3725") (model :model "m" :prompt "p"))'), (e) => e.code === 'ACTION' && /NOT_PERMITTED/.test(e.message) && e.labels.includes('web'));
  await rejects(run(read('(calc :expr "1")'), { actions: ACTIONS }), 'ACTION', /NO_BUS/);
});

test('totality: for-each 100 / 101, list 1000 / 1001, fuel', async () => {
  const L = (n) => '(list' + ' 1'.repeat(n) + ')';
  assert.equal((await go('(for-each (i ' + L(100) + ') i)')).value, null);
  await rejects(go('(for-each (i ' + L(101) + ') i)'), 'RUN', /more than 100 items/);
  assert.equal((await go('(len ' + L(1000) + ')')).value, '1000');
  await rejects(go(L(1001)), 'RUN', /longer than 1000/);
  const nest = '(for-each (a ' + L(100) + ') (for-each (b ' + L(100) + ') (for-each (c ' + L(100) + ') (+ a b c))))';
  await rejects(go(nest), 'FUEL', /more than 10000 evaluation steps/);
  const r = await go('(+ 1 2)', { fuel: 3 });
  assert.equal(r.fuelUsed, 3);
  await rejects(go('(+ 1 2)', { fuel: 2 }), 'FUEL');
});

test('script state: limits and exact round trip', async () => {
  const state = memState();
  assert.equal((await go('(remember third (/ 1 3)) (* (remembered third) 3)', { state })).value, '1');
  assert.equal((await go('(* (remembered third) 3)', { state })).value, '1');
  const keys = Array.from({ length: LIMITS.STATE_KEYS }, (_, i) => '(remember k' + i + ' 1)').join(' ');
  await go(keys, { state: memState() });
  await rejects(go(keys + ' (remember extra 1)', { state: memState() }), 'RUN', /more than 64 remembered keys/);
  await rejects(go('(remember big (str ' + '"xxxxxxxxxx" '.repeat(410) + '))'), 'RUN', /larger than 4096 bytes/);
});
