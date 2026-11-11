// date-diff.js — v1.0.0 · whole days between two calendar dates, and the weekday of each · changelog: act/CHANGELOG.md#actactionsdate-diffjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// whole days between two calendar dates, and the weekday of each
// Input { from: "2026-10-28", to: "2026-10-31", weekday?: "Tuesday" } — strict YYYY-MM-DD; impossible dates (2026-02-30)
// are refused. With weekday, it is checked against `to` and a mismatch is REFUSED rather than guessed
// (ACTBUS docs/capability-architecture.md §2: "Tuesday 31 Oct 2026" — 31 Oct 2026 is a Saturday). Calendar arithmetic in UTC: no time zone shifts.
'use strict';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parse(s, field) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new Error(field + ' must be YYYY-MM-DD');
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d), x = new Date(t);
  if (x.getUTCFullYear() !== y || x.getUTCMonth() !== mo - 1 || x.getUTCDate() !== d) throw new Error(field + ' ' + s + ' is not a real date');
  return t;
}

function diff(from, to, weekday) {
  const a = parse(from, 'from'), b = parse(to, 'to');
  const out = { days: Math.round((b - a) / 86400000), fromWeekday: DAYS[new Date(a).getUTCDay()], toWeekday: DAYS[new Date(b).getUTCDay()] };
  if (weekday !== undefined) {
    const w = String(weekday).trim().toLowerCase();
    const want = DAYS.find((d) => d.toLowerCase() === w || d.slice(0, 3).toLowerCase() === w);
    if (!want) throw new Error('weekday ' + JSON.stringify(weekday) + ' is not a day name');
    if (want !== out.toWeekday) throw new Error(to + ' is a ' + out.toWeekday + ', not a ' + want + ' — refusing to guess which was meant');
  }
  return out;
}

module.exports = { run: (input) => diff(input.from, input.to, input.weekday), diff };
