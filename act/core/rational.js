// rational.js — v1.1.0 · exact rational arithmetic on BigInt · changelog: act/CHANGELOG.md#actcorerationaljs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// exact rational arithmetic on BigInt (no floating point anywhere)
// A value is { n, d } with d > 0 and gcd(n, d) = 1. Decimals are parsed exactly ("0.1" is 1/10, not 0.1000000000000000055…).
// toDecimal() is exact when the denominator has only the prime factors 2 and 5; otherwise it rounds (half away from zero)
// and says so (exact: false). Used by the calc and units actions — models got 4837 × 2919 wrong on every pass (ACTBUS docs/capability-architecture.md §2).
'use strict';

const ZERO = 0n, ONE = 1n, TEN = 10n;
const abs = (x) => (x < ZERO ? -x : x);
function gcd(a, b) { a = abs(a); b = abs(b); while (b) { [a, b] = [b, a % b]; } return a; }

function make(n, d) {
  if (typeof n !== 'bigint' || typeof d !== 'bigint') throw new TypeError('rational parts must be BigInt');
  if (d === ZERO) throw new RangeError('division by zero');
  if (d < ZERO) { n = -n; d = -d; }
  const g = gcd(n, d) || ONE;
  return Object.freeze({ n: n / g, d: d / g });
}
const int = (k) => make(BigInt(k), ONE);

// "12", "12.5", ".5" are accepted; signs, exponents, commas, spaces are not (the caller handles the sign).
const DEC = /^(\d+)?(?:\.(\d+))?$/;
function parseDecimal(s) {
  const m = DEC.exec(String(s));
  if (!m || (m[1] === undefined && m[2] === undefined)) throw new SyntaxError('not a decimal number: ' + JSON.stringify(s));
  const ip = m[1] || '0', fp = m[2] || '';
  return make(BigInt(ip + fp), TEN ** BigInt(fp.length));
}

const isInt = (a) => a.d === ONE;
const bitlen = (x) => abs(x).toString(2).length;
const bits = (a) => Math.max(bitlen(a.n), bitlen(a.d));
// fix 1.1.0: the size of EVERY intermediate is bounded (not only powers) — a 97-character input built from large powers
// froze the event loop for 120 s. 8 192 bits ≈ 2 466 decimal digits on both numerator and denominator: far beyond any
// practical sum, and fast to compute (measured: worst of 2000 random 300-character near-limit inputs in the tens of ms).
const MAX_BITS = 8192;
function guard(r, maxBits = MAX_BITS) { if (bits(r) > maxBits) throw new RangeError('result too large (over ' + maxBits + ' bits)'); return r; }

// pre-check BEFORE the work: two operands whose sizes add up past the limit are refused without multiplying or
// reducing anything (reducing 40 000-bit products is what cost time); the exact guard then checks the result.
function pre(a, b) { if (bits(a) + bits(b) > MAX_BITS + 64) throw new RangeError('result too large (over ' + MAX_BITS + ' bits)'); }
const add = (a, b) => { pre(a, b); return guard(make(a.n * b.d + b.n * a.d, a.d * b.d)); };
const sub = (a, b) => { pre(a, b); return guard(make(a.n * b.d - b.n * a.d, a.d * b.d)); };
const mul = (a, b) => { pre(a, b); return guard(make(a.n * b.n, a.d * b.d)); };
const div = (a, b) => { if (b.n === ZERO) throw new RangeError('division by zero'); pre(a, b); return guard(make(a.n * b.d, a.d * b.n)); };
const neg = (a) => make(-a.n, a.d);
const cmp = (a, b) => { const x = a.n * b.d - b.n * a.d; return x < ZERO ? -1 : x > ZERO ? 1 : 0; };
// Integer powers only. maxBits bounds the size of the result (a 300-character input must not allocate gigabytes).
function pow(a, e, maxBits = MAX_BITS) {
  if (!isInt(e)) throw new RangeError('exponent must be a whole number');
  let k = e.n; const negExp = k < ZERO; if (negExp) k = -k;
  if (k > 100000n) throw new RangeError('exponent too large');
  const est = (Math.max(bitlen(a.n), bitlen(a.d)) - 1) * Number(k) + 1;   // ≈ result bits; coarse pre-check, exact guard below
  if (est > 2 * maxBits) throw new RangeError('result too large (over ' + maxBits + ' bits)');
  if (negExp && a.n === ZERO) throw new RangeError('division by zero');
  const r = guard(make(a.n ** k, a.d ** k), maxBits);
  return negExp ? make(r.d, r.n) : r;
}

// Exact when the reduced denominator is 2^x · 5^y; otherwise rounded to maxFrac digits after the point.
function toDecimal(a, maxFrac = 30) {
  let d = a.d, twos = 0, fives = 0;
  while (d % 2n === ZERO) { d /= 2n; twos++; }
  while (d % 5n === ZERO) { d /= 5n; fives++; }
  const terminating = d === ONE;
  const k = terminating ? Math.max(twos, fives) : maxFrac;
  const scale = TEN ** BigInt(k);
  const sign = a.n < ZERO ? '-' : '';
  const num = abs(a.n) * scale;
  let q = num / a.d; const rem = num % a.d;
  if (!terminating && rem * 2n >= a.d) q += ONE;          // round half away from zero
  let s = q.toString().padStart(k + 1, '0');
  let ip = s.slice(0, s.length - k), fp = k ? s.slice(s.length - k) : '';
  fp = fp.replace(/0+$/, '');
  const out = (fp ? ip + '.' + fp : ip);
  return { text: (out === '0' ? '' : sign) + out, exact: terminating };
}
const toFraction = (a) => (a.d === ONE ? a.n.toString() : a.n.toString() + '/' + a.d.toString());

module.exports = { make, int, parseDecimal, add, sub, mul, div, neg, pow, cmp, isInt, toDecimal, toFraction, gcd, guard, bits, MAX_BITS };
