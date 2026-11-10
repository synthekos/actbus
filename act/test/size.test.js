// size.test.js — v1.0.0 · tests: the size budget — a small script cannot build a value that kills the process · changelog: act/CHANGELOG.md#acttestsizetestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// F-A SIZE BUDGET (ACTBUS docs/reviews.md, PROTEUS-K review finding 5): a tiny script must not be able to build a value that
// kills the process. Each attack runs in a CHILD process with a 256 MB heap: on the old evaluator the child dies out of memory
// (exit 134) — the test FAILS; on the fixed one the script stops with a defined RUN error and the child exits 0.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const EVAL = path.join(__dirname, '..', 'proteus', 'eval.js'), READER = path.join(__dirname, '..', 'proteus', 'reader.js');
const ten = (v) => '(list ' + Array(10).fill(v).join(' ') + ')';
function nested(depth) { const b = ['(a0 ' + ten('1') + ')']; for (let i = 1; i <= depth; i++) b.push(`(a${i} ${ten('a' + (i - 1))})`); return `(let (${b.join(' ')}) a${depth})`; }
function inChild(src) {
  const code = `const {read}=require(${JSON.stringify(READER)});const {run}=require(${JSON.stringify(EVAL)});
run(read(${JSON.stringify(src)}),{}).then(r=>{console.log(JSON.stringify({ok:true,bytes:JSON.stringify(r.value).length}))},
e=>{console.log(JSON.stringify({ok:false,code:e.code,msg:String(e.message).slice(0,200)}))});`;
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', code], { encoding: 'utf8', timeout: 60000 });
  let out = null; try { out = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (_) {}
  return { status: r.status, signal: r.signal, out, err: (r.stderr || '').slice(0, 300) };
}
test('F-A: ten nested (let … (list …)) — 420 bytes of source — stops with RUN, the process survives', () => {
  const src = nested(9); assert.ok(src.length < 500);
  const r = inChild(src);
  assert.equal(r.status, 0, 'child process died (old evaluator: out of memory) — ' + (r.signal || '') + ' ' + r.err);
  assert.ok(r.out && r.out.ok === false && r.out.code === 'RUN' && /larger than/.test(r.out.msg), JSON.stringify(r.out));
});
test('F-A: an ordinary nested list (10 × 10 × 10 = 1 000 leaves) still works', () => {
  const r = inChild(nested(2));
  assert.equal(r.status, 0, r.err);
  assert.ok(r.out && r.out.ok === true && r.out.bytes > 1000, JSON.stringify(r.out));
});
test('F-A: the size is internal — a reply never shows it', () => {
  const r = inChild('(list 1 (list 2 3) "x")');
  assert.ok(r.out && r.out.ok === true && r.out.bytes === JSON.stringify(['1', ['2', '3'], 'x']).length, JSON.stringify(r.out));
});
