// calc.js — v1.0.0 · exact arithmetic on numbers: + − × ÷ ^ and parentheses · changelog: act/CHANGELOG.md#actactionscalcjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// exact arithmetic: numbers, + - * / ^, parentheses, decimal points — nothing else
// No eval, no floating point: a small recursive-descent parser over exact rationals. 0.1 + 0.2 is exactly 0.3;
// 4837 * 2919 is 14119203 (both models got this wrong on every pass: ACTBUS docs/capability-architecture.md §2). Precedence: ^ (right-assoc) > unary − >
// * / > + −, so −2^2 = −4 and 2^−1 = 0.5. Anything that is not arithmetic is refused: "not arithmetic: …".
// Output: { result, exact, fraction } — exact:false only when the answer does not terminate (1/3), then result is
// rounded to 30 decimals and fraction carries the exact value.
'use strict';
const R = require('rational');

const MAX_LEN = 300, MAX_DEPTH = 64;

function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if ('+-*/^()'.includes(c)) { out.push({ t: c }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const lit = s.slice(i, j);
      if ((lit.match(/\./g) || []).length > 1 || lit === '.') throw new Error('not arithmetic: bad number "' + lit + '"');
      out.push({ t: 'n', v: R.parseDecimal(lit) }); i = j; continue;
    }
    throw new Error('not arithmetic: "' + c + '" is not a number, operator or parenthesis');
  }
  return out;
}

function parse(tokens) {
  let p = 0, depth = 0;
  const peek = () => tokens[p], take = () => tokens[p++];
  const expect = (t) => { const x = take(); if (!x || x.t !== t) throw new Error('not arithmetic: expected "' + t + '"'); };
  function expr() {
    let v = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = take().t; const r = term(); v = op === '+' ? R.add(v, r) : R.sub(v, r); }
    return v;
  }
  function term() {
    let v = unary();
    while (peek() && (peek().t === '*' || peek().t === '/')) { const op = take().t; const r = unary(); v = op === '*' ? R.mul(v, r) : R.div(v, r); }
    return v;
  }
  function unary() {
    if (peek() && (peek().t === '-' || peek().t === '+')) {
      if (++depth > MAX_DEPTH) throw new Error('not arithmetic: too deeply nested');
      const op = take().t; const v = unary(); depth--; return op === '-' ? R.neg(v) : v;
    }
    return power();
  }
  function power() {
    const b = primary();
    if (peek() && peek().t === '^') {
      take();
      if (++depth > MAX_DEPTH) throw new Error('not arithmetic: too deeply nested');
      const e = unary(); depth--;
      return R.pow(b, e);
    }
    return b;
  }
  function primary() {
    const x = take();
    if (!x) throw new Error('not arithmetic: the expression ends too early');
    if (x.t === 'n') return x.v;
    if (x.t === '(') {
      if (++depth > MAX_DEPTH) throw new Error('not arithmetic: too deeply nested');
      const v = expr(); expect(')'); depth--; return v;
    }
    throw new Error('not arithmetic: unexpected "' + x.t + '"');
  }
  const v = expr();
  if (p !== tokens.length) throw new Error('not arithmetic: unexpected "' + tokens[p].t + '"');
  return v;
}

function evaluate(expr) {
  const s = String(expr);
  if (!s.trim()) throw new Error('not arithmetic: empty');
  if (s.length > MAX_LEN) throw new Error('not arithmetic: longer than ' + MAX_LEN + ' characters');
  const v = parse(tokenize(s));
  const d = R.toDecimal(v, 30);
  return { result: d.text, exact: d.exact, fraction: R.toFraction(v) };
}

module.exports = { run: (input) => evaluate(input.expr), evaluate };
