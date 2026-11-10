// units.js — v1.0.0 · exact unit conversion: length, mass, volume, pressure, energy, speed, temperature · changelog: act/CHANGELOG.md#actactionsunitsjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// exact unit conversion (length, mass, volume, pressure, energy, speed, temperature)
// Input { value: "2.5", from: "bar", to: "psi" } — value is a STRING so it stays exact ("0.1" is 1/10).
// Factors are the exact definitions (inch = 0.0254 m, pound = 0.45359237 kg, US gallon = 3.785411784 L,
// psi = lbf/in² = 0.45359237 × 9.80665 / 0.0254² Pa, cal = 4.184 J thermochemical). Temperature is affine (via kelvin).
// Output { result, exact, dimension } — rounded to 12 decimals only when the exact answer does not terminate.
'use strict';
const R = require('rational');
const D = (s) => R.parseDecimal(s);
const Q = (a, b) => R.div(D(a), D(b));

const DIM = {
  length:   { m: D('1'), km: D('1000'), cm: D('0.01'), mm: D('0.001'), in: D('0.0254'), ft: D('0.3048'), yd: D('0.9144'), mi: D('1609.344'), nmi: D('1852') },
  mass:     { kg: D('1'), g: D('0.001'), mg: D('0.000001'), t: D('1000'), lb: D('0.45359237'), oz: D('0.028349523125') },
  volume:   { l: D('1'), ml: D('0.001'), m3: D('1000'), gal: D('3.785411784'), qt: D('0.946352946'), floz: D('0.0295735295625') },
  pressure: { pa: D('1'), kpa: D('1000'), bar: D('100000'), atm: D('101325'), psi: R.div(R.mul(D('0.45359237'), D('9.80665')), R.mul(D('0.0254'), D('0.0254'))) },
  energy:   { j: D('1'), kj: D('1000'), wh: D('3600'), kwh: D('3600000'), cal: D('4.184'), kcal: D('4184') },
  speed:    { 'm/s': D('1'), 'km/h': Q('1000', '3600'), mph: Q('1609.344', '3600'), kn: Q('1852', '3600') },
};
const ALIAS = { litre: 'l', liter: 'l', litres: 'l', liters: 'l', metre: 'm', meter: 'm', inch: 'in', foot: 'ft', feet: 'ft', mile: 'mi',
  pound: 'lb', lbs: 'lb', ounce: 'oz', gallon: 'gal', 'kph': 'km/h', knot: 'kn', knots: 'kn',
  c: 'c', '°c': 'c', celsius: 'c', f: 'f', '°f': 'f', fahrenheit: 'f', k: 'k', kelvin: 'k' };
const TEMP = ['c', 'f', 'k'];
const norm = (u) => { const s = String(u).trim().toLowerCase(); return ALIAS[s] || s; };

function parseValue(s) {
  const m = /^\s*([+-]?)\s*(\d+(?:\.\d+)?|\.\d+)\s*$/.exec(String(s));
  if (!m) throw new Error('value must be a decimal number written as text, e.g. "2.5"');
  const v = D(m[2]); return m[1] === '-' ? R.neg(v) : v;
}
const toK = (v, u) => (u === 'k' ? v : u === 'c' ? R.add(v, D('273.15')) : R.add(R.div(R.mul(R.sub(v, D('32')), D('5')), D('9')), D('273.15')));
const fromK = (k, u) => (u === 'k' ? k : u === 'c' ? R.sub(k, D('273.15')) : R.add(R.div(R.mul(R.sub(k, D('273.15')), D('9')), D('5')), D('32')));

function convert(value, from, to) {
  const v = parseValue(value), a = norm(from), b = norm(to);
  let out, dim;
  if (TEMP.includes(a) || TEMP.includes(b)) {
    if (!(TEMP.includes(a) && TEMP.includes(b))) throw new Error('cannot convert ' + from + ' to ' + to + ' (different dimensions)');
    const k = toK(v, a);
    if (R.cmp(k, R.int(0)) < 0) throw new Error('below absolute zero');
    out = fromK(k, b); dim = 'temperature';
  } else {
    dim = Object.keys(DIM).find((d) => DIM[d][a] && DIM[d][b]);
    if (!dim) {
      const da = Object.keys(DIM).find((d) => DIM[d][a]), db = Object.keys(DIM).find((d) => DIM[d][b]);
      throw new Error(!da ? 'unknown unit ' + from : !db ? 'unknown unit ' + to : 'cannot convert ' + from + ' (' + da + ') to ' + to + ' (' + db + ')');
    }
    out = R.div(R.mul(v, DIM[dim][a]), DIM[dim][b]);
  }
  const d = R.toDecimal(out, 12);
  return { result: d.text, exact: d.exact, dimension: dim };
}

module.exports = { run: (input) => convert(input.value, input.from, input.to), convert };
