// read-number.js — v1.0.0 · the first number in a text, after an optional marker · changelog: act/CHANGELOG.md#actactionsread-numberjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// NATIVE: the first number in a text, after an optional marker (ACTBUS docs/capability-architecture.md §6 test 2)
// Input { text, after? }. Output { number: "1.3725" } — the digits exactly as written (an optional minus, digits, an
// optional decimal part). Exact jobs are code: a page's rate is read by this, never by a model. The reply carries every
// label its input had (the bus adds them), so a number read from a page stays web data.
// Not handled (refused or read literally, by design): thousands separators ("1,375.25" reads 1), exponents, other scripts' digits.
'use strict';
const NUM = /-?\d+(?:\.\d+)?/;
async function run(input) {
  const text = String(input.text);
  let from = 0;
  if (input.after !== undefined) {
    const i = text.indexOf(String(input.after));
    if (i < 0) throw new Error('the marker ' + JSON.stringify(String(input.after)).slice(0, 80) + ' is not in the text');
    from = i + String(input.after).length;
  }
  const m = NUM.exec(text.slice(from));
  if (!m) throw new Error('no number in the text' + (input.after !== undefined ? ' after the marker' : ''));
  return { number: m[0] };
}
module.exports = { run };
