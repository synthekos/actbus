// reader.test.js — v1.0.0 · tests: the PROTEUS-K reader · changelog: act/CHANGELOG.md#acttestreadertestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// PROTEUS-K reader (ACTBUS docs/proteus-k.md §2). Run: node --test --test-reporter=tap test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, print, ReadError, LIMITS } = require('../proteus/reader');

const err = (src, re) => assert.throws(() => read(src), (e) => e instanceof ReadError && re.test(e.message), 'expected ' + re + ' for ' + JSON.stringify(String(src).slice(0, 60)));
const one = (src) => { const f = read(src); assert.equal(f.length, 1); return f[0]; };

test('atoms', () => {
  assert.deepEqual(one('42'), { t: 'num', s: '42', line: 1, col: 1 });
  assert.equal(one('-1.375').s, '-1.375');
  assert.equal(one('0.1').s, '0.1');
  assert.equal(one('true').v, true);
  assert.equal(one('false').v, false);
  assert.equal(one('nil').t, 'nil');
  assert.deepEqual([one('rate-before').t, one('rate-before').v], ['sym', 'rate-before']);
  assert.equal(one('remembered?').v, 'remembered?');
  assert.deepEqual([one(':url').t, one(':url').v], ['kw', 'url']);
  for (const op of ['+', '-', '*', '/', '=', '<', '>', '<=', '>=']) assert.deepEqual([one(op).t, one(op).v], ['sym', op]);
});

test('bad atoms are refused, not guessed', () => {
  for (const bad of ['1.', '.5', '1e3', '+5', '--5', '-x', 'Rate', 'a_b', 'a.b', '!=', '<>', '=>', '9a', '#t', "'x", '`x', ',x', '@x'])
    err(bad, /not a name, number or operator/);
  err(':', /bad keyword/); err(':9', /bad keyword/); err(':ok?', /bad keyword/); err('::a', /bad keyword/);
  err('café', /character outside a string or comment/);
});

test('names: 48 characters max (+ optional ?)', () => {
  const n48 = 'a'.repeat(48);
  assert.equal(one(n48).v, n48);
  assert.equal(one(n48 + '?').v, n48 + '?');
  err('a'.repeat(49), /not a name/);
  assert.equal(one(':' + n48).v, n48);
  err(':' + 'a'.repeat(49), /bad keyword/);
});

test('lists, nesting and positions', () => {
  const f = one('(when (< rate old)\n  (file-append :name "x.txt" :text "hello"))');
  assert.equal(f.t, 'list');
  assert.equal(f.items.length, 3);
  assert.equal(f.items[2].line, 2);
  assert.equal(f.items[2].col, 3);
  assert.equal(f.items[2].items[1].t, 'kw');
  assert.deepEqual(read('() (a) b').map((x) => x.t), ['list', 'list', 'sym']);
  assert.equal(read('').length, 0);
  assert.equal(read('  ; only a comment\n').length, 0);
});

test('strings: escapes, raw newline/tab, control characters refused', () => {
  assert.equal(one('"a\\"b\\\\c\\nd\\te"').v, 'a"b\\c\nd\te');
  assert.equal(one('"line1\nline2\tx"').v, 'line1\nline2\tx');
  assert.equal(one('"Київ ✓"').v, 'Київ ✓');
  assert.equal(one('""').v, '');
  err('"a\\x"', /unknown escape/);
  err('"a\\u0041"', /unknown escape/);
  err('"a\rb"', /control character U\+000d/);
  err('"a\u0000b"', /control character U\+0000/);
  err('"a\u007fb"', /control character U\+007f/);
  err('"abc', /never closed/);
  err('"abc\\', /never closed/);
});

test('structure errors name the place', () => {
  assert.throws(() => read('(a\n  (b c)'), (e) => e.line === 1 && e.col === 1 && /never closed/.test(e.message));
  assert.throws(() => read('(a))'), (e) => e.line === 1 && e.col === 4 && /unexpected \)/.test(e.message));
  assert.throws(() => read('\n\n   )'), (e) => e.line === 3 && e.col === 4);
  assert.throws(() => read('"ok"\n  "bad\\q"'), (e) => e.line === 2 && e.col === 7);
});

test('comments are not code; a ; inside a string is text', () => {
  assert.equal(read('(a ; (b c)\n d)')[0].items.length, 2);
  assert.equal(one('"x ; y"').v, 'x ; y');
  assert.equal(read('a;comment\nb').length, 2);
});

test('limit: nesting 64 is read, 65 refused', () => {
  assert.equal(read('('.repeat(64) + ')'.repeat(64)).length, 1);
  err('('.repeat(65) + ')'.repeat(65), /nested deeper than 64/);
});

test('limit: 4000 forms read, 4001 refused', () => {
  assert.equal(read('a '.repeat(LIMITS.FORMS)).length, LIMITS.FORMS);
  err('a '.repeat(LIMITS.FORMS + 1), /more than 4000 forms/);
  err('(' + 'a '.repeat(LIMITS.FORMS) + ')', /more than 4000 forms/);       // the list itself is a form
});

test('limit: source 16 KB (bytes, not characters)', () => {
  const ok = ';' + 'x'.repeat(LIMITS.SOURCE_BYTES - 1);
  assert.equal(read(ok).length, 0);
  err(ok + 'x', /larger than 16384 bytes/);
  err(';' + 'é'.repeat(LIMITS.SOURCE_BYTES / 2), /larger than 16384 bytes/);  // 8192 chars, 16385 bytes
  err(Buffer.alloc(LIMITS.SOURCE_BYTES + 1, 0x20), /larger than 16384 bytes/);
});

// The 64 KB string limit cannot be reached in v0: the whole source is limited to 16 KB and escapes only shrink text.
// It guards a later raise of the source limit; it is not tested here because no v0 input can trigger it.

test('Buffer input: strict UTF-8, BOM skipped', () => {
  assert.equal(read(Buffer.from('(a "é")')).length, 1);
  err(Buffer.from([0x28, 0x61, 0xff, 0x29]), /not valid UTF-8/);
  assert.equal(read(Buffer.from('﻿(a)'))[0].t, 'list');
  err(42, /source must be text/);
});

test('print gives the canonical form and round-trips', () => {
  const src = '(when  (< (number (get page "rate"))\n   rate-before)  ; fell\n (file-append :name "x.txt" :text "say \\"hi\\"\\n"))';
  const c = print(read(src));
  assert.equal(c, '(when (< (number (get page "rate")) rate-before) (file-append :name "x.txt" :text "say \\"hi\\"\\n"))');
  assert.equal(print(read(c)), c);                                        // canonical form is a fixed point
  assert.equal(print(read('a\n\n b')), 'a\nb');
});
