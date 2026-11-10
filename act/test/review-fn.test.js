// review-fn.test.js — v1.0.0 · tests: one per finding of the second-reader review of functions and the standard library (R-fn) · changelog: act/CHANGELOG.md#acttestreview-fntestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// the second-reader review of eval 1.6.0 (functions + standard library): one test per confirmed
// finding (U1, C1, C2). Every test FAILS on eval 1.6.0. Run: node --test test/review-fn.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { read } = require(path.join(ROOT, 'proteus/reader'));
const { check, run, ScriptError } = require(path.join(ROOT, 'proteus/eval'));
const web = async () => ({ ok: true, value: 'go', labels: ['web'] });
const go = (src, opt = {}) => run(read(src), { actions: new Set(['fetch']), callAction: web, ...opt });

test('U1: a too-long replace / join / str is a RUN error BEFORE the text is built — and it carries the web label that decided it', async () => {
  const big = { big: 'a'.repeat(63000) };
  const cases = [
    '(let ((r (join (range 1000) ""))) (when (= (fetch :url "https://x.example") "go") (replace (input big) "a" (str r r r r r))))',
    '(when (= (fetch :url "https://x.example") "go") (join (range 1000) (input big)))',
    '(when (= (fetch :url "https://x.example") "go") (str (input big) (input big)))',
  ];
  for (const src of cases) {
    await assert.rejects(go(src, { input: big, inputLabels: ['person'] }), (e) => {
      assert.ok(e instanceof ScriptError, src + ' threw a ' + (e && e.constructor && e.constructor.name) + ': ' + e.message);
      assert.equal(e.code, 'RUN'); assert.match(e.message, /longer than 65536/);
      assert.ok(e.labels.includes('web'), src + ' lost the web label: ' + e.labels); return true;
    });
  }
});

test('C1: parse-json refuses a number it cannot read exactly (and any exponent); exact numbers still read, grounded', async () => {
  for (const t of ['[1.00000000000000001]', '{"k":2.0000000000000000001}', '[1e400]', '[1e2]', '[12345678901234567890]'])
    await assert.rejects(go('(parse-json (input a))', { input: { a: t }, inputLabels: ['grounded'] }), (e) => e.code === 'RUN' && /exactly|exponent/.test(e.message), t);
  const r = await go('(get (parse-json (input a)) "rate")', { input: { a: '{"rate":0.73,"n":2.0}' }, inputLabels: ['grounded'] });
  assert.equal(r.value, '0.73'); assert.ok(r.labels.includes('grounded'));
  assert.equal((await go('(get (parse-json (input a)) "n")', { input: { a: '{"n":2.0}' } })).value, '2');
});

test('C2: (constructor) — a name on Object.prototype — is an ordinary CHECK refusal, not a JS TypeError', () => {
  for (const src of ['(constructor)', '(constructor 1)', '(let ((x (constructor))) x)'])
    assert.throws(() => check(read(src), new Set()), (e) => e instanceof ScriptError && e.code === 'CHECK' && /no action named "constructor"/.test(e.message), src);
});
