// retry-slack.test.js — v1.0.0 · tests: a refused time trigger's retries land on the 15 s ticks 15 s and 30 s on (issue #15) · changelog: act/CHANGELOG.md#acttestretry-slacktestjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// The scheduler sets a retry's time when the refusal comes back, a few ms after the tick that fired it. With an exact `now >= at`, the
// tick 30 s later reads the clock those few ms too early and the second retry waits for the next tick: 45 s, not 30 s (the race the
// README described). Here the clock is the test's: every tick is exactly 15 s apart and every refusal comes back LATE ms after its tick,
// so the race is decided the same way every run. Tests marked FAIL-FIRST fail on ACTBUS v0.3.7 (scheduler.js 1.3.0); GUARD on both.
// tools/tick-probe.js runs the same case on the real 15 s timer and the real clock; the release kit runs it three times.
// Run from anywhere: node --test act/test/retry-slack.test.js — the test finds the kernel by its own location (act/test/..)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');   // the kernel's act/, found from this file's own location
const { Scheduler } = require(path.join(ROOT, 'scheduler'));
const TICK = 15000;

// one time trigger, refused DEDUPE_FULL (transient) at every fire; the bus answers LATE ms after the tick asked it
function run(late) {
  const clk = { t: Date.UTC(2026, 10, 16, 12, 0, 0) }, audit = [], fires = [];
  const bus = { ask: async () => { fires.push(clk.t); clk.t += late; return { ok: false, code: 'DEDUPE_FULL', transient: true, retryAfterMs: 86400000, labels: [] }; } };
  const s = new Scheduler({ bus, spec: { triggers: [{ id: 'full', script: 'go', runsAs: 'svc', every: 60 }] }, stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rs-')),
    clock: () => clk.t, audit: (r) => audit.push(r) });
  return { s, clk, audit, fires, async ticks(n) { for (let i = 0; i < n; i++) { clk.t = Math.ceil((clk.t + 1) / TICK) * TICK; await s.tick(); } } };
}
const gaps = (f) => f.slice(1).map((x, i) => Math.round((x - f[i]) / 1000));

for (const late of [1, 3, 17, 250]) {
  test('FAIL-FIRST a refusal that comes back ' + late + ' ms after its tick: the retries are 15 s and 30 s after the fire, then the fire is lost', async () => {
    const w = run(late);
    await w.ticks(12);
    const first = w.fires[0]; assert.ok(first !== undefined, 'the trigger fired');
    assert.deepEqual(gaps(w.fires.filter((t) => t - first < 60000)), [15, 30], 'gaps of the fire and its two retries');
    assert.equal(w.audit.filter((r) => r.kind === 'trigger-lost').length >= 1, true, 'then the fire is lost');
    const later = w.audit.filter((r) => r.kind === 'trigger-retry-later').map((r) => r.at);
    assert.equal(later.length >= 2, true);
  });
}

test('GUARD the retry-later line still records the time 5 s and 30 s after each refusal (the slack is in the comparison, not the time)', async () => {
  const w = run(3);
  await w.ticks(12);
  const rl = w.audit.filter((r) => r.kind === 'trigger-retry-later').slice(0, 2);
  assert.deepEqual(rl.map((r, i) => Date.parse(r.at) - (w.fires[i] + 3)), [5000, 30000]);
});

test('GUARD a refusal that comes back at its tick\'s own instant gives 15 s and 30 s (as before)', async () => {
  const w = run(0);
  await w.ticks(12);
  const first = w.fires[0];
  assert.deepEqual(gaps(w.fires.filter((t) => t - first < 60000)), [15, 30]);
});
