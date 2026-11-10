// invariants.test.js — v1.0.0 · tests: label propagation, form by form · changelog: act/CHANGELOG.md#acttestinvariantstestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// PROTEUS-K label-propagation INVARIANTS, form by form (eval.js 1.1.0 header + README).
// Every builtin and special form gets a web-labelled value (from the fake fetch) in each argument position in turn, and the
// test asserts the label arrives where the documented rule says: the result's labels, the next action call's labels / ctl,
// the state store, or the thrown error's labels. Literal-only twins assert the NEGATIVE (no web anywhere).
// A test the current code does not satisfy is kept and marked `// MISMATCH:` with the rule it breaks.
// Run: node --test test/*.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('../proteus/reader');
const { run, memState, ScriptError } = require('../proteus/eval');

// ---------- fake bus ----------
const ACTIONS = new Set(['fetch', 'quiet', 'sink', 'boom', 'dud']);
function bus() {
  const log = [];
  const callAction = async (action, input, meta) => {
    log.push({ action, input, ...meta });
    switch (action) {
      case 'fetch': return { ok: true, value: { text: 'rate 1.3725', rate: '1.3725', n: '2', key: 'rate', items: ['a', 'b', 'c'] }, labels: ['device', 'web'] };
      case 'quiet': return { ok: true, value: { rate: '9', n: '3' }, labels: ['device'] };
      case 'sink': return { ok: true, value: { written: true }, labels: ['device'] };
      case 'boom': return { ok: false, code: 'REFUSED', error: 'refused', labels: ['web'] };
      case 'dud': return { ok: false, code: 'REFUSED', error: 'refused', labels: [] };
    }
  };
  return { log, callAction };
}
const go = (src, o = {}) => { const b = o.bus || bus(); return run(read(src), { actions: ACTIONS, callAction: b.callAction, inputLabels: ['person'], ...o }).then((r) => ({ ...r, log: b.log })); };
const err = async (src, o = {}) => {
  try { await go(src, o); } catch (e) { assert.ok(e instanceof ScriptError, 'not a ScriptError: ' + e); return e; }
  assert.fail('expected an error from ' + src);
};
const has = (labels, l) => labels.includes(l);
const web = (labels, what) => assert.ok(has(labels, 'web'), (what || '') + ' lacks web: ' + JSON.stringify(labels));
const noWeb = (labels, what) => assert.ok(!has(labels, 'web'), (what || '') + ' carries web: ' + JSON.stringify(labels));
const sub = (a, b, what) => { for (const l of a) assert.ok(b.includes(l), what + ': ' + l + ' dropped (' + JSON.stringify(a) + ' ⊄ ' + JSON.stringify(b) + ')'); };
const last = (r) => r.log[r.log.length - 1];

// ---------- web-labelled values (each is ONE expression) ----------
const REC = '(fetch :url "u")';                         // a record            labels device web
const W = '(get (fetch :url "u") "rate")';              // text "1.3725"       device person web
const W2 = '(get (fetch :url "u") "n")';                // text "2"
const WK = '(get (fetch :url "u") "key")';              // text "rate" (a key)
const WN = '(number (get (fetch :url "u") "n"))';       // number 2            + computed
const WL = '(get (fetch :url "u") "items")';            // list a b c
const WB = '(= ' + W + ' "1.3725")';                    // true
const WF = '(= ' + W + ' "no")';                        // false
const Q = '(quiet :x "y")';                             // a clean record      device

// ---------- builtins: table, each argument position in turn ----------
// args: per position { lit, web }. arith: the result must also carry "computed".
const BUILTINS = [
  { h: '=', args: [{ lit: '"2"', web: W2 }, { lit: '"2"', web: W2 }] },
  { h: '<', args: [{ lit: '1', web: WN }, { lit: '3', web: WN }] },
  { h: '>', args: [{ lit: '1', web: WN }, { lit: '3', web: WN }] },
  { h: '<=', args: [{ lit: '1', web: WN }, { lit: '3', web: WN }] },
  { h: '>=', args: [{ lit: '1', web: WN }, { lit: '3', web: WN }] },
  { h: '+', arith: true, args: [{ lit: '2', web: WN }, { lit: '2', web: WN }, { lit: '2', web: WN }] },
  { h: '-', arith: true, args: [{ lit: '2', web: WN }, { lit: '2', web: WN }, { lit: '2', web: WN }] },
  { h: '-', tag: 'unary', arith: true, args: [{ lit: '2', web: WN }] },
  { h: '*', arith: true, args: [{ lit: '2', web: WN }, { lit: '2', web: WN }, { lit: '2', web: WN }] },
  { h: '/', arith: true, args: [{ lit: '8', web: WN }, { lit: '2', web: WN }] },
  { h: 'str', args: [{ lit: '"a"', web: W }, { lit: '1', web: WN }, { lit: 'true', web: WB }] },
  { h: 'len', args: [{ lit: '"abc"', web: W }] },
  { h: 'len', tag: 'of a list', args: [{ lit: '(list 1 2)', web: WL }] },
  { h: 'list', args: [{ lit: '"a"', web: W }, { lit: '"b"', web: W }, { lit: '"c"', web: W }] },
  { h: 'get', args: [{ lit: Q, web: REC }, { lit: '"rate"', web: WK }] },
  { h: 'number', arith: true, args: [{ lit: '"5"', web: W }] },
  { h: 'number', tag: 'of a number', args: [{ lit: '5', web: WN }] },
  { h: 'not', args: [{ lit: 'true', web: WB }] },
  { h: 'not', tag: 'of false', args: [{ lit: 'false', web: WF }] },
];
const form = (b, webAt) => '(' + b.h + ' ' + b.args.map((a, i) => (i === webAt ? a.web : a.lit)).join(' ') + ')';

for (const b of BUILTINS) {
  const name = '(' + b.h + ' …)' + (b.tag ? ' ' + b.tag : '');
  b.args.forEach((_, i) => {
    test('builtin ' + name + ': web in argument ' + (i + 1) + ' → result, next call labels, ctl', async () => {
      const src = form(b, i);
      const r = await go(src);
      web(r.labels, src);
      // the result carries the UNION of its operands' labels (each operand measured on its own) [+ computed]
      const ops = [];
      for (let j = 0; j < b.args.length; j++) ops.push(...(await go(j === i ? b.args[j].web : b.args[j].lit)).labels);
      sub(ops, r.labels, src);
      for (const l of r.labels) assert.ok(ops.includes(l) || l === 'computed', src + ': invented label ' + l);
      if (b.arith && !(b.h === 'number' && b.tag)) assert.ok(has(r.labels, 'computed'), src + ' lacks computed');
      web(r.seen, src + ' seen');
      // the value passed to an action: input labels carry web, ctl carries web (sticky)
      const s = await go('(sink :v ' + src + ')');
      web(last(s).labels, 'sink labels for ' + src);
      web(last(s).ctl, 'sink ctl for ' + src);
    });
  });
  test('builtin ' + name + ': literal-only operands → no web anywhere (negative)', async () => {
    const src = form(b, -1);
    const r = await go(src);
    noWeb(r.labels, src); noWeb(r.seen, src + ' seen');
    const s = await go('(sink :v ' + src + ')');
    noWeb(last(s).labels, 'sink labels'); noWeb(last(s).ctl, 'sink ctl');
  });
}

test('builtins: a type error on a web operand carries web (errors carry the operands + all seen)', async () => {
  for (const src of ['(+ ' + W + ' 1)', '(< ' + W + ' 1)', '(get ' + W + ' "k")', '(get ' + REC + ' 1)', '(len ' + WN + ')',
    '(str ' + REC + ')', '(number ' + REC + ')', '(number (get (fetch :url "u") "text"))', '(= ' + WL + ' ' + WL + ')', '(/ ' + WN + ' 0)']) {
    const e = await err(src);
    assert.equal(e.code, 'RUN', src);
    web(e.labels, src);
  }
  const clean = await err('(+ "a" 1)');
  noWeb(clean.labels, 'clean type error');
});

// ---------- let / do ----------
test('let: a binding keeps its labels; nested lets; an unused web binding still taints later control', async () => {
  web((await go('(let ((x ' + W + ')) x)')).labels, 'let');
  web((await go('(let ((x ' + W + ') (y (str x "!"))) y)')).labels, 'let*: second binding from first');
  web((await go('(let ((x ' + W + ')) (let ((y x)) (let ((z y)) z)))')).labels, 'three nested lets');
  const u = await go('(let ((x ' + W + ')) (sink :v "lit"))');
  noWeb(last(u).labels, 'unused binding: data stays person');
  web(last(u).ctl, 'unused binding: ctl is sticky');
  const n = await go('(let ((x "a")) (let ((y x)) y))');
  assert.deepEqual(n.labels, ['person']); noWeb(n.seen);
});
test('do: the value is the last form\'s; earlier web forms taint control only', async () => {
  web((await go('(do 1 ' + W + ')')).labels);
  const r = await go('(do ' + W + ' "x")');
  assert.deepEqual(r.labels, ['person']); web(r.seen, 'seen');
});

// ---------- if ----------
test('if: web condition → value (then AND else branch) carries web; branch call has ctl web, data person', async () => {
  web((await go('(if ' + WB + ' "A" "B")')).labels, 'then taken');
  web((await go('(if ' + WF + ' "A" "B")')).labels, 'else taken');
  const c = await go('(if ' + WB + ' (sink :v "k") nil)');
  assert.deepEqual(last(c).labels, ['person']); web(last(c).ctl, 'ctl');
  const d = await go('(sink :v (if ' + WB + ' "A" "B"))');
  web(last(d).labels, 'if-chosen constant is web data');
});
test('if: web in the then / else branch → value carries web', async () => {
  web((await go('(if true ' + W + ' "B")')).labels, 'then');
  web((await go('(if false "A" ' + W + ')')).labels, 'else');
  assert.deepEqual((await go('(if true "A" ' + W + ')')).labels, ['person'], 'branch not taken contributes nothing');
});
test('if: two levels — web at either level reaches the value and the call', async () => {
  for (const src of [
    '(if ' + WB + ' (if (= 1 1) "a" "b") "c")',               // outer condition
    '(if (= 1 1) (if ' + WB + ' "a" "b") "c")',               // inner condition
    '(if (= 1 1) (if (= 1 1) ' + W + ' "b") "c")',            // innermost value
    '(if (= 1 2) "c" (if ' + WF + ' "a" "b"))',               // inner in else
  ]) {
    web((await go(src)).labels, src);
    const s = await go('(sink :v ' + src + ')');
    web(last(s).labels, 'sink ' + src);
  }
  const inner = await go('(if ' + WB + ' (if (= 1 1) (sink :v "k") nil) nil)');
  assert.deepEqual(last(inner).labels, ['person']); web(last(inner).ctl, 'outer web condition reaches a call two levels in');
  const clean = await go('(if (= 1 1) (if (= 2 2) "a" "b") "c")');
  assert.deepEqual(clean.labels, ['person']); noWeb(clean.seen);
});

// ---------- when / unless ----------
test('when / unless: web condition → value, taken or not; body web → value', async () => {
  web((await go('(when ' + WB + ' "A")')).labels, 'when taken');
  web((await go('(when ' + WF + ' "A")')).labels, 'when not taken (nil)');
  web((await go('(unless ' + WF + ' "A")')).labels, 'unless taken');
  web((await go('(unless ' + WB + ' "A")')).labels, 'unless not taken (nil)');
  web((await go('(when true ' + W + ')')).labels, 'when body');
  web((await go('(unless false "x" ' + W + ')')).labels, 'unless last body form');
  for (const h of ['when', 'unless']) {
    const c = await go('(' + h + ' ' + (h === 'when' ? WB : WF) + ' (sink :v "k"))');
    assert.deepEqual(last(c).labels, ['person'], h); web(last(c).ctl, h + ' ctl');
    const d = await go('(sink :v (' + h + ' ' + (h === 'when' ? WB : WF) + ' "k"))');
    web(last(d).labels, h + '-chosen constant');
  }
  assert.deepEqual((await go('(when (= 1 1) "A")')).labels, ['person']);
  assert.deepEqual((await go('(unless (= 1 1) "A")')).labels, ['person']);
});

// ---------- and / or ----------
test('and: web in each operand position (when evaluated) → value', async () => {
  web((await go('(and ' + WB + ' "A")')).labels, 'first operand true');
  web((await go('(and ' + WF + ' "A")')).labels, 'first operand false (short circuit)');
  web((await go('(and "A" ' + W + ')')).labels, 'second operand');
  web((await go('(and true true ' + W + ')')).labels, 'third operand');
  web((await go('(and true ' + WB + ' "A")')).labels, 'middle operand as condition');
  assert.deepEqual((await go('(and false ' + W + ')')).labels, ['person'], 'an unevaluated operand contributes nothing');
  const c = await go('(and ' + WB + ' (sink :v "k"))');
  assert.deepEqual(last(c).labels, ['person']); web(last(c).ctl, 'and: later operand runs under earlier');
  assert.deepEqual((await go('(and true "A")')).labels, ['person']);
});
test('or: web in each operand position (when evaluated) → value', async () => {
  web((await go('(or ' + W + ' "A")')).labels, 'first operand truthy');
  web((await go('(or ' + WF + ' "A")')).labels, 'first operand false → second chosen');
  web((await go('(or false ' + W + ')')).labels, 'second operand');
  web((await go('(or false nil ' + W + ')')).labels, 'third operand');
  assert.deepEqual((await go('(or "A" ' + W + ')')).labels, ['person'], 'an unevaluated operand contributes nothing');
  const c = await go('(or ' + WF + ' (sink :v "k"))');
  assert.deepEqual(last(c).labels, ['person']); web(last(c).ctl, 'or: later operand runs under earlier');
  const d = await go('(sink :v (or ' + WF + ' "k"))');
  web(last(d).labels, 'or-chosen constant');
  assert.deepEqual((await go('(or false "A")')).labels, ['person']);
});

// ---------- for-each ----------
test('for-each: items carry the list\'s labels; body runs under them; the value carries them', async () => {
  const r = await go('(for-each (i ' + WL + ') (sink :v i))');
  assert.equal(r.log.length, 4);
  for (const c of r.log.slice(1)) { web(c.labels, 'item'); web(c.ctl, 'body ctl'); }
  web((await go('(for-each (i ' + WL + ') 1)')).labels, 'for-each value');
  // ONE web item makes the whole list web: every item, even the literal one, carries it
  const m = await go('(for-each (i (list "a" ' + W + ')) (sink :v i))');
  assert.equal(m.log.length, 3);
  for (const c of m.log.slice(1)) web(c.labels, 'item of a list with a web member');
  // a web condition chooses between literal lists
  const w = await go('(for-each (i (if ' + WB + ' (list "a" "b") (list "c"))) (sink :v i))');
  for (const c of w.log.slice(1)) web(c.labels, 'item of a web-chosen list');
  // literal body under a web list: data person, ctl web
  const k = await go('(for-each (i ' + WL + ') (sink :v "k"))');
  for (const c of k.log.slice(1)) { assert.deepEqual(c.labels, ['person']); web(c.ctl); }
  const e = await err('(for-each (i ' + W + ') 1)');
  web(e.labels, 'for-each on a web non-list: error');
  const n = await go('(for-each (i (list "a" "b")) (sink :v i))');
  for (const c of n.log) { noWeb(c.labels); noWeb(c.ctl); }
  assert.deepEqual(n.labels, ['person']);
});
test('nesting: web key → list → for-each → get on a clean record → action', async () => {
  const r = await go('(for-each (k (list ' + WK + ')) (sink :v (get ' + Q + ' k)))');
  const s = r.log.filter((c) => c.action === 'sink');
  assert.equal(s.length, 1); assert.equal(s[0].input.v, '9');
  web(s[0].labels, 'get with a key that came through list + for-each');
  const rec = await go('(for-each (x (list ' + REC + ')) (sink :v (get x "rate")))');
  web(last(rec).labels, 'get on a web record that came through list + for-each');
  const clean = await go('(for-each (k (list "rate")) (sink :v (get ' + Q + ' k)))');
  noWeb(last(clean).labels); noWeb(last(clean).ctl);
});

// ---------- remember / remembered ----------
test('remember: stores value labels ∪ control ∪ everything seen', async () => {
  const cases = [
    ['web value', '(remember k ' + W + ')', {}],
    ['web condition, literal value', '(when ' + WB + ' (remember k "go"))', {}],
    ['web read earlier, literal value', W + '\n(remember k "go")', {}],
    ['web read earlier in the same form', '(do ' + W + ' (remember k "go"))', {}],
    ['run called under web ctl', '(remember k "go")', { ctl: ['web'] }],
    ['web list via for-each', '(for-each (i ' + WL + ') (remember k i))', {}],
    ['web through two ifs', '(if (= 1 1) (if ' + WB + ' (remember k "a") nil) nil)', {}],
  ];
  for (const [what, src, o] of cases) {
    const state = memState();
    await go(src, { state, ...o });
    assert.ok(state.get('k'), what + ': not stored');
    web(state.get('k').labels, 'stored labels (' + what + ')');
  }
  const state = memState();
  await go('(remember k (str "a" 1))', { state });
  noWeb(state.get('k').labels, 'clean store');
  assert.deepEqual(state.get('k').labels, ['person']);
});
test('remember → remembered in a SECOND run, same store: labels come back as data', async () => {
  for (const src of ['(remember k ' + W + ')', '(when ' + WB + ' (remember k "go"))', W + '\n(remember k "go")',
    '(remember k (list ' + W + ' "b"))', '(remember k ' + WN + ')']) {
    const state = memState();
    await go(src, { state });
    const r = await go('(remembered k)', { state });
    web(r.labels, 'remembered after ' + src); web(r.seen, 'seen after ' + src);
    const s = await go('(sink :v (remembered k))', { state });
    web(last(s).labels, 'action input from remembered (' + src + ')');
    web(last(s).ctl, 'ctl after remembered (' + src + ')');
    const f = await go('(for-each (i (let ((x (remembered k))) (if (= 1 1) (list x) nil))) (sink :v i))', { state });
    web(last(f).labels, 'remembered → let → if → list → for-each');
  }
  const state = memState();
  await go('(remember k "a")', { state });
  const r = await go('(sink :v (remembered k))', { state });
  noWeb(r.labels); noWeb(last(r).labels); noWeb(last(r).ctl);
});
test('remembered: a MISSING key carries the labels of every write', async () => {
  const state = memState();
  await go('(remember k ' + W + ')', { state });
  web((await go('(remembered other)', { state })).labels, 'absent key');
  assert.deepEqual((await go('(remembered other)', { state: memState() })).labels, ['person']);
});

// ---------- input ----------
test('input: values carry inputLabels, through builtins, records and calls', async () => {
  const o = { inputLabels: ['web'], input: { s: 'x', n: 2, r: { a: 'b' }, l: ['p', 'q'] } };
  for (const src of ['(input s)', '(input n)', '(input missing)', '(+ (input n) 1)', '(get (input r) "a")', '(str "a" (input s))',
    '(if (input s) "y" "n")']) web((await go(src, o)).labels, src);
  const f = await go('(for-each (i (input l)) (sink :v i))', o);
  for (const c of f.log) { web(c.labels, 'input list item'); web(c.ctl); }
  const c = await go('(sink :v (input s))', o);
  web(last(c).labels); web(last(c).ctl, 'sticky after reading input');
  const clean = await go('(sink :v (input s))', { inputLabels: ['device'], input: { s: 'x' } });
  assert.deepEqual(clean.labels, ['device']); noWeb(last(clean).labels); noWeb(last(clean).ctl);
});

// ---------- action calls ----------
test('action call: input labels = union of argument labels, web in each argument position', async () => {
  for (const src of ['(sink :a ' + W + ' :b "x" :c 1)', '(sink :a "x" :b ' + W + ' :c 1)', '(sink :a "x" :b 1 :c ' + WN + ')']) {
    const r = await go(src);
    web(last(r).labels, src); web(last(r).ctl, src + ' ctl');
    assert.ok(has(last(r).labels, 'person'), src + ': literal argument labels dropped');
  }
  const clean = await go('(sink :a "x" :b 1)');
  assert.deepEqual(clean.log[0].labels, ['person']); noWeb(clean.log[0].ctl, 'clean ctl');
});
test('action call: ctl = C ∪ seen (sticky across forms); ctl alone never taints data', async () => {
  const r = await go('(sink :v "a")\n' + W + '\n(sink :v "b")');
  noWeb(r.log[0].ctl, 'before the read'); web(r.log[2].ctl, 'after the read');
  assert.deepEqual(r.log[2].labels, ['person']);
  const t = await go('(let ((x ' + W + ')) 1)\n(let ((y 2)) (sink :v y))');
  web(last(t).ctl, 'sticky through a closed let'); assert.deepEqual(last(t).labels, ['person']);
  const s = await go('(sink :v "a")', { ctl: ['web'] });
  web(s.log[0].ctl, 'opt.ctl seeds control'); assert.deepEqual(s.log[0].labels, ['person']);
  web(s.seen, 'opt.ctl is seen'); assert.deepEqual(s.labels, ['device'], 'reply data labels unaffected by ctl');
});
test('action reply: the value carries exactly the reply\'s labels', async () => {
  assert.deepEqual((await go(REC)).labels, ['device', 'web']);
  assert.deepEqual((await go(Q)).labels, ['device']);
  web((await go('(get ' + REC + ' "items")')).labels);
  const n = await go('(sink :v ' + Q + ')');
  noWeb(last(n).labels); noWeb(last(n).ctl);
});

// ---------- run() result ----------
test('run(): labels = the value\'s, seen = everything evaluated (plus opt.ctl)', async () => {
  const r = await go(W + '\n"x"');
  assert.deepEqual(r.labels, ['person']); web(r.seen);
  const c = await go('"x"', { ctl: ['web'] });
  assert.deepEqual(c.labels, ['person']); web(c.seen);
  const n = await go('(let ((a (+ 1 2))) (if (> a 1) (str "a" a) "b"))');
  noWeb(n.labels); noWeb(n.seen);
});

// ---------- errors ----------
test('errors: FAIL carries its reason\'s labels, control, and everything seen', async () => {
  web((await err('(fail ' + W + ')')).labels, 'web reason');
  web((await err('(when ' + WB + ' (fail "x"))')).labels, 'web condition');
  web((await err(W + '\n(fail "x")')).labels, 'web seen earlier');
  web((await err('(fail "x")', { ctl: ['web'] })).labels, 'opt.ctl');
  const state = memState(); await go('(remember k ' + W + ')', { state });
  web((await err('(fail (remembered k))', { state })).labels, 'remembered reason in a second run');
  const e = await err('(fail "x")');
  assert.equal(e.code, 'FAIL'); noWeb(e.labels);
});
test('errors: an action failure carries the reply labels, control, and everything seen', async () => {
  const a = await err('(boom :v "x")');
  assert.equal(a.code, 'ACTION'); web(a.labels, 'reply labels of a refused call');
  web((await err('(dud :v ' + W + ')')).labels, 'web argument');
  web((await err(W + '\n(dud :v "x")')).labels, 'web seen earlier');
  web((await err('(when ' + WB + ' (dud :v "x"))')).labels, 'web condition');
  web((await err('(dud :v "x")', { ctl: ['web'] })).labels, 'opt.ctl');
  noWeb((await err('(dud :v "x")')).labels, 'clean failure');
});
test('errors: a RUN error from the value itself carries web', async () => {
  // the returned value has no exact decimal form; the value itself is web
  web((await err('(/ ' + WN + ' 3)')).labels, 'final value from web');
});
// R1 (was MISMATCH, fixed in eval 1.2.0): "errors carry everything seen" — run() converts the final value with toWire() OUTSIDE its try/catch
// (proteus/eval.js:329, the catch is :328), so a RUN error raised there carries only the value's labels, not cx.seen.
test('errors: a RUN error converting the final value carries everything seen (sticky)', async () => {
  web((await err(W + '\n(/ 1 3)')).labels, 'web read earlier, then an inexact final value');
  web((await err('(when ' + WF + ' (fail "stop"))\n(/ 1 3)')).labels, 'reached only because the page did not stop it');
  web((await err('(/ 1 3)', { ctl: ['web'] })).labels, 'run called under web ctl');
});

// ---------- one literal-only script through every form: nothing is web ----------
test('negative: a literal-only script touching every form carries no web anywhere', async () => {
  const state = memState();
  const src = '(let ((a (+ 1 2)) (l (list "x" "y")))\n' +
    '  (if (and (> a 1) (or false (not nil))) (when true (unless false (do (str "a" (len l))))) "n")\n' +
    '  (for-each (i l) (sink :v i :n (number "4") :q (/ (* a 2) (- 3 1)) :e (= i "x") :le (<= 1 2) :ge (>= 2 1) :lt (< 1 2)))\n' +
    '  (remember k (str "z" a))\n  (sink :v (remembered k) :r (get ' + Q + ' "rate")))';
  const r = await go(src, { state });
  noWeb(r.labels, 'value'); noWeb(r.seen, 'seen');
  for (const c of r.log) { noWeb(c.labels, c.action + ' labels'); noWeb(c.ctl, c.action + ' ctl'); }
  noWeb(state.get('k').labels, 'stored');
  const again = await go('(sink :v (remembered k))', { state });
  noWeb(last(again).labels); noWeb(last(again).ctl);
});
