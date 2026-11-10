// functions.test.js — v1.0.0 · tests: `(define …)` — shape, no cycles, purity, labels, fuel · changelog: act/CHANGELOG.md#acttestfunctionstestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// eval 1.6.0 (ACTBUS docs/functions-and-mailboxes.md §2): (define …) functions — shape, no cycles, purity, labels as if inlined, reach,
// fuel. Every test FAILS on eval 1.5.0 (no define). Run: node --test test/functions.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { read } = require(path.join(ROOT, 'proteus/reader'));
const { check, run } = require(path.join(ROOT, 'proteus/eval'));
const ACTIONS = new Set(['calc', 'fetch', 'file-append']);
const go = (src, opt = {}) => run(read(src), { actions: ACTIONS, ...opt });
const refused = (src, re) => assert.throws(() => check(read(src), ACTIONS), (e) => e.code === 'CHECK' && re.test(e.message), src);

test('define: a named function, called with its arguments; a function may call functions defined ABOVE it', async () => {
  assert.equal((await go('(define (dbl x) (* x 2)) (dbl 21)')).value, '42');
  assert.equal((await go('(define (dbl x) (* x 2)) (define (quad x) (dbl (dbl x))) (quad 5)')).value, '20');
  assert.equal((await go('(define (pick a b) (if (> a b) a b)) (pick 3 9)')).value, '9');
  assert.equal((await go('(define (greet who) (str "hello " who)) (define (twice) (list (greet "a") (greet "b"))) (twice)')).value.join('|'), 'hello a|hello b');
  assert.equal((await go('(define (f x) x)')).value, null, 'a script of only definitions returns nil');
});

test('define: refused at load — not at the top level, recursion, a call before the definition, twice, bad names, wrong arity', () => {
  refused('(do (define (f) 1) (f))', /only at the top level/);
  refused('(define (f x) (f x)) (f 1)', /no action named "f"/);                       // recursion: f does not exist inside its own body
  refused('(define (a) (b)) (define (b) 1) (a)', /no action named "b"/);              // a cycle needs a forward call: refused
  refused('(define (f) 1) (define (f) 2)', /"f" is a function name/);
  refused('(define (if) 1)', /"if" is a form or action name/);
  refused('(define (fetch) 1)', /"fetch" is a form or action name/);
  refused('(define (upper) 1)', /"upper" is a form or action name/);
  refused('(define (f x x) x)', /used twice/);
  refused('(define (f a b c d e g h i j) a)', /at most 8 arguments/);
  refused('(define (f x) x) (f)', /takes 1 value/);
  refused('(define (f x) x) (f 1 2)', /takes 1 value/);
  refused('(define (f) 1) f', /must be called/);
  refused('(define (f) 1) (let ((f 2)) f)', /"f" is a function name/);
  refused('(define (f x) (x))', /is a value, not something to call/);
  refused('(define f 1)', /\(define \(name arg …\) body …\)/);
  refused('(define (f))', /\(define \(name arg …\) body …\)/);
});

test('define: a body sees ONLY its own arguments (no closures, no outer names)', () => {
  refused('(let ((y 1)) (define (f) y))', /only at the top level/);
  refused('(define (f) y) (let ((y 1)) (f))', /unknown name "y"/);
  refused('(define (f x) (let ((z x)) z)) z', /unknown name "z"/);
});

test('define: an IMPURE function (calls an action or remembers) cannot be used inside a collection form; a pure one can', async () => {
  assert.deepEqual((await go('(define (dbl x) (* x 2)) (collect (i (list 1 2 3)) (dbl i))')).value, ['2', '4', '6']);
  refused('(define (f x) (calc :expr "1")) (collect (i (list 1)) (f i))', /calls an action or remembers; it cannot be used inside \(collect/);
  refused('(define (f x) (remember k x)) (filter (i (list 1)) (f i))', /cannot be used inside \(filter/);
  refused('(define (g) (calc :expr "1")) (define (f x) (g)) (count (i (list 1)) (f i))', /cannot be used inside \(count/);   // impurity passes up
});

test('define: labels are EXACTLY as if the body were written out in place (warnings and the credential)', async () => {
  const cases = [
    ['(get (first (input facts)) "v")', '(define (f r) (get r "v")) (f (first (input facts)))'],
    ['(+ 1 (number (get (first (input facts)) "v")))', '(define (inc x) (+ 1 x)) (inc (number (get (first (input facts)) "v")))'],
    ['(if (input flag) (input facts) (list))', '(define (choose c a b) (if c a b)) (choose (input flag) (input facts) (list))'],
    ['(str "x" (get (first (input facts)) "v"))', '(define (s v) (str "x" v)) (s (get (first (input facts)) "v"))'],
    ['(and (input flag) (input facts))', '(define (both a b) (and a b)) (both (input flag) (input facts))'],
  ];
  for (const L of [['grounded'], ['web'], ['grounded', 'web'], ['person']]) {
    const opt = { input: { facts: [{ v: '38' }], flag: true }, inputLabels: L };
    for (const [inline, fn] of cases) {
      const a = await go(inline, opt), b = await go(fn, opt);
      assert.deepEqual(b.value, a.value, fn); assert.deepEqual(b.labels, a.labels, fn + ' under ' + L);
    }
  }
});

test('define: a chain of functions that doubles the work at each step is stopped by FUEL (every script still terminates)', async () => {
  let src = '(define (f0 x) (+ x 1))';
  for (let i = 1; i <= 16; i++) src += ' (define (f' + i + ' x) (+ (f' + (i - 1) + ' x) (f' + (i - 1) + ' x)))';
  src += ' (f16 1)';
  await assert.rejects(go(src), (e) => e.code === 'FUEL');
});

test('define: the reach (every action a script can call) includes actions inside function bodies — even ones never called', () => {
  const c = check(read('(define (never) (fetch :url "https://a.example")) (define (once) (calc :expr "1")) (once)'), ACTIONS);
  assert.deepEqual([...new Set(c.calls.map((x) => x.action))].sort(), ['calc', 'fetch']);
  assert.deepEqual(c.functions, [{ name: 'never', arity: 0, pure: false }, { name: 'once', arity: 0, pure: false }]);
  const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
  const s = createEngine({ daemon: false }).survey(read('(define (g) (fetch :url "https://a.example")) (g)'));
  assert.equal(s.calls.find((x) => x.name === 'fetch').branched, true, 'an action inside a function counts as branched');
  assert.deepEqual(s.targets, ['url:https://a.example']);
});

test('define: an impure function calls its action each time it runs, through the bus, with the call site\'s labels', async () => {
  const seen = [];
  const callAction = async (a, input, meta) => { seen.push({ a, input, labels: meta.labels, ctl: meta.ctl }); return { ok: true, value: { result: input.expr }, labels: ['computed'] }; };
  const r = await go('(define (ask e) (get (calc :expr e) "result")) (list (ask "1+1") (when (input flag) (ask "2+2")))',
    { callAction, input: { flag: true }, inputLabels: ['web'] });
  assert.deepEqual(r.value, ['1+1', '2+2']);
  assert.deepEqual(seen.map((x) => x.input.expr), ['1+1', '2+2']);
  assert.ok(seen[1].ctl.includes('web'), 'the second call ran under the web condition');
});

test('through the real bus (in-process and in a daemon): (now) is the time of the message that started the run', async () => {
  const registry = require(path.join(ROOT, 'core/registry')), caps = require(path.join(ROOT, 'core/capabilities'));
  const { Names } = require(path.join(ROOT, 'core/names')), { Bus } = require(path.join(ROOT, 'core/bus'));
  const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
  const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');   // 0.53.2: shipped built-ins only — an installed script (staging: scout) is not part of this test
  for (const daemon of [false, true]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fn-')), box = fs.mkdtempSync(path.join(os.tmpdir(), 'fnbox-'));
    for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'st.pk'), '(define (stamp x) (str x "@" (now))) (stamp "hi")');
    const spec = [...SPEC, { name: 'st', version: '1.0.0', kind: 'script', file: 'st.pk', produces: 'computed', world: false, runsAs: 'st', needs: [], input: {}, acceptWarnings: true }];
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
    const engine = createEngine({ stateRoot: box, daemon });
    const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
    assert.deepEqual(loaded.refused, []);
    const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: { st: {} } }, { name: 'st', kind: 'script', owner: 'alex', actions: { st: {} } }]);
    const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), filesRoot: box, audit: () => {} });
    try {
      const T = Date.now(), r = await bus.ask('alex', 'st', {}, {});
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.match(r.value, /^hi@\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/, String(r.value));
      assert.ok(Math.abs(Date.parse(r.value.slice(3)) - T) < 60000, 'the message time, not some other clock');
      assert.ok(r.labels.includes('device'), 'the time is labelled device: ' + r.labels);
      if (daemon) assert.ok(engine.supervisor.pidOf('st'), 'it ran in a daemon');
    } finally { engine.close(); }
  }
});
