// size-collect.test.js — v1.0.0 · tests: the size budget in the collection forms · changelog: act/CHANGELOG.md#acttestsize-collecttestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// F-A for the collection forms (eval ≥ 1.2.0): (collect (x a) a) shares the same list
// 1 000 times; twice over it is 10^9 items. Must stop with RUN, not kill the process (the reviewer's 2 KB script: ACTBUS docs/reviews.md, PROTEUS-K review).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const EVAL = path.join(__dirname, '..', 'proteus', 'eval.js'), READER = path.join(__dirname, '..', 'proteus', 'reader.js');
test('F-A: (collect (x a) a) twice over a 1 000-item list stops with RUN, the process survives', () => {
  const ones = '(list ' + Array(1000).fill('1').join(' ') + ')';
  const src = `(let ((a ${ones}) (b (collect (x a) a)) (c (collect (x a) b))) c)`;
  const code = `const {read}=require(${JSON.stringify(READER)});const {run}=require(${JSON.stringify(EVAL)});
run(read(${JSON.stringify(src)}),{}).then(r=>console.log(JSON.stringify({ok:true})),e=>console.log(JSON.stringify({ok:false,code:e.code,msg:String(e.message).slice(0,200)})));`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', code], { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, 'child process died (old evaluator: out of memory) — ' + (r.signal || '') + ' ' + (r.stderr || '').slice(0, 200));
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.ok(out.ok === false && out.code === 'RUN' && /larger than/.test(out.msg), JSON.stringify(out));
});
