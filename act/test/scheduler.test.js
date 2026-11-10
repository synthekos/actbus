// scheduler.test.js — v1.0.0 · tests: triggers · changelog: act/CHANGELOG.md#acttestschedulertestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// slice 3 step 2: triggers (act/scheduler.js). Every test FAILS without scheduler.js.
// A fake clock and a fake bus for the rules; one test through the real bus (the runsAs grant). Run: node --test test/scheduler.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { Scheduler, validate, nextAt } = require(path.join(ROOT, 'scheduler'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
const H = 3600000;

function fake({ slow } = {}) {
  const calls = []; let release;
  const bus = { ask: (who, action, input, meta) => { calls.push({ who, action, input, meta }); return slow ? new Promise((r) => { release = () => r({ ok: true, labels: [] }); }) : Promise.resolve({ ok: true, labels: ['person', 'computed'] }); } };
  return { bus, calls, release: () => release && release() };
}
function sched(triggers, { T0 = Date.UTC(2026, 10, 3, 15, 0), dir = tmp(), slow, perHour } = {}) {
  const clk = { t: T0 }, f = fake({ slow }), audit = [];
  const s = new Scheduler({ bus: f.bus, spec: { triggers }, stateDir: dir, clock: () => clk.t, audit: (r) => audit.push(r), perHour });
  return { s, clk, f, audit, dir };
}

test('every: fires once per period, as the runsAs identity, through bus.ask — never before it is due', async () => {
  const { s, clk, f } = sched([{ id: 'hourly', script: 'thought', runsAs: 'helper-thoughts', every: 3600, input: { x: '1' } }]);
  clk.t += H - 1000; await s.tick(); assert.equal(f.calls.length, 0);
  clk.t += 1000; await s.tick(); await s.tick(); assert.equal(f.calls.length, 1, 'once, even if ticked twice');
  assert.deepEqual(f.calls[0], { who: 'helper-thoughts', action: 'thought', input: { x: '1' }, meta: { labels: [] } });
  clk.t += H; await s.tick(); assert.equal(f.calls.length, 2);
});

test('at: a time zone, week days, and daylight saving — the repeated hour fires ONCE, the missing hour at the first minute after', async () => {
  const t = (at, days) => validate([{ id: 'x', script: 's', runsAs: 'r', at, tz: 'America/Toronto', days }]).ok[0];
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(iso(nextAt(t('18:15', 'mon-fri'), Date.UTC(2026, 10, 3, 12))), '2026-11-03T23:15:00.000Z');   // Tue, EST
  assert.equal(iso(nextAt(t('18:15', 'mon-fri'), Date.UTC(2026, 10, 7, 12))), '2026-11-09T23:15:00.000Z');   // Sat → Mon
  const fb = t('01:30', 'daily'), first = nextAt(fb, Date.UTC(2026, 10, 1, 0));                               // 1 Nov: clocks go back
  assert.equal(iso(first), '2026-11-01T05:30:00.000Z');
  assert.equal(iso(nextAt(fb, first)), '2026-11-02T06:30:00.000Z', 'not again at 01:30 EST the same night');
  assert.equal(iso(nextAt(t('02:30', 'daily'), Date.UTC(2026, 2, 8, 0))), '2026-03-08T07:00:00.000Z');         // 8 Mar: 02:30 does not exist
  const { s, clk, f } = sched([{ id: 'n', script: 's', runsAs: 'r', at: '01:30', tz: 'America/Toronto' }], { T0: Date.UTC(2026, 10, 1, 4) });
  for (let m = 0; m < 4 * 60; m += 1) { clk.t += 60000; await s.tick(); }                                     // 00:00 EDT → 03:00 EST
  assert.equal(f.calls.length, 1, 'fired once over the fall-back night');
});

test('missed runs: "skip" does not fire after the box was off; "run-late" fires ONCE, never once per missed period', async () => {
  const dir = tmp();
  const a = sched([{ id: 'k', script: 's', runsAs: 'r', every: 3600 }, { id: 'l', script: 's', runsAs: 'r', every: 3600, missed: 'run-late' }], { dir });
  a.clk.t += H; await a.s.tick(); assert.equal(a.f.calls.length, 2);
  const b = sched([{ id: 'k', script: 's', runsAs: 'r', every: 3600 }, { id: 'l', script: 's', runsAs: 'r', every: 3600, missed: 'run-late' }], { dir, T0: a.clk.t + 5 * H });
  await b.s.tick(); await b.s.tick();
  assert.deepEqual(b.f.calls.map((c) => c.action), ['s'], 'one fire in total: l, late');
  assert.ok(b.audit.some((r) => r.kind === 'trigger-skip' && r.id === 'k' && /missed/.test(r.why)));
  assert.ok(b.audit.some((r) => r.kind === 'trigger-fire' && r.id === 'l' && r.late === true));
  b.clk.t += H; await b.s.tick(); assert.equal(b.f.calls.length, 3, 'both back on the hourly grid');
});

test('no overlap: while a run is still going the next fire is skipped and audited', async () => {
  const { s, clk, f, audit } = sched([{ id: 'o', script: 's', runsAs: 'r', every: 60 }], { slow: true });
  clk.t += 60000; s.tick(); await new Promise((r) => setImmediate(r));
  clk.t += 60000; await s.tick();
  assert.equal(f.calls.length, 1);
  assert.ok(audit.some((r) => r.kind === 'trigger-skip' && /still going/.test(r.why)));
  f.release(); await new Promise((r) => setTimeout(r, 10));
  clk.t += 60000; s.tick(); await new Promise((r) => setImmediate(r)); assert.equal(f.calls.length, 2);
});

test('switch off: free from the admin page, kept across restarts; ON again only when the trigger\'s line in the file changes', async () => {
  const dir = tmp(), spec = [{ id: 'h', script: 's', runsAs: 'r', every: 3600 }];
  const a = sched(spec, { dir }); assert.equal(a.s.switchOff('h', 'alex'), true);
  a.clk.t += H; await a.s.tick(); assert.equal(a.f.calls.length, 0);
  const b = sched(spec, { dir, T0: a.clk.t }); b.clk.t += H; await b.s.tick(); assert.equal(b.f.calls.length, 0, 'still off after a restart');
  assert.equal(typeof b.s.switchOn, 'undefined', 'there is no switch-on from the page');
  const c = sched([{ id: 'h', script: 's', runsAs: 'r', every: 7200 }], { dir, T0: b.clk.t });
  assert.ok(c.audit.some((r) => r.kind === 'trigger-switched-on'));
  c.clk.t += 2 * H; await c.s.tick(); assert.equal(c.f.calls.length, 1);
});

test('a bad trigger file entry is refused (the others load): every < 60 s, unknown zone, both every and at, duplicate id, > 20', () => {
  const base = { script: 's', runsAs: 'r' };
  const v = validate([{ id: 'a', ...base, every: 30 }, { id: 'b', ...base, at: '07:00', tz: 'Mars/Olympus' }, { id: 'c', ...base, every: 60, at: '07:00', tz: 'UTC' },
    { id: 'd', ...base, every: 60 }, { id: 'd', ...base, every: 60 }, { id: 'e', ...base, at: '7:00', tz: 'UTC' }, { id: 'f', ...base, every: 60, tz: 'UTC' },
    { id: 'g', ...base, every: 60, extra: 1 }, { id: 'H', ...base, every: 60 }]);
  assert.deepEqual(v.ok.map((t) => t.id), ['d']);
  assert.equal(v.refused.length, 8, JSON.stringify(v.refused));
  const many = validate(Array.from({ length: 22 }, (_, i) => ({ id: 't' + i, ...base, every: 60 })));
  assert.equal(many.ok.length, 20); assert.match(many.refused[0].reason, /more than 20/);
});

test('a per-identity cap on fires per hour', async () => {
  const { s, clk, f, audit } = sched([{ id: 'a', script: 's', runsAs: 'r', every: 60 }, { id: 'b', script: 's2', runsAs: 'r', every: 60 }], { perHour: 3 });
  for (let i = 0; i < 3; i++) { clk.t += 60000; await s.tick(); }
  assert.equal(f.calls.length, 3);
  assert.ok(audit.some((r) => r.kind === 'trigger-skip' && /reached 3 fires this hour/.test(r.why)));
});

test('a corrupt state file stops the scheduler (no silent reset)', () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'scheduler.json'), '{ not json');
  assert.throws(() => sched([{ id: 'a', script: 's', runsAs: 'r', every: 60 }], { dir }), /corrupt.*no silent reset/);
});

test('through the real bus: the runsAs identity must hold the script — a fire without the grant is refused and audited', async () => {
  const registry = require(path.join(ROOT, 'core/registry')), caps = require(path.join(ROOT, 'core/capabilities'));
  const { Names } = require(path.join(ROOT, 'core/names')), { Bus } = require(path.join(ROOT, 'core/bus'));
  const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
  const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');   // 0.53.2: shipped built-ins only — an installed script (staging: scout) is not part of this test
  const dir = tmp(), box = tmp();
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'tick.pk'), '(remember n (+ 1 (or (remembered n) 0)))');
  const spec = [...SPEC, { name: 'tick', version: '1.0.0', kind: 'script', file: 'tick.pk', produces: 'computed', world: false, runsAs: 'ticker', needs: [], input: {}, acceptWarnings: true }];
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  const engine = createEngine({ stateRoot: box });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} }, { name: 'ticker', kind: 'script', owner: 'alex', actions: { tick: {} } }, { name: 'nobody', kind: 'euser', owner: 'alex', actions: {} }]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), filesRoot: box, audit: () => {} });
  const clk = { t: Date.UTC(2026, 10, 3) }, audit = [];
  const s = new Scheduler({ bus, spec: { triggers: [{ id: 'ok', script: 'tick', runsAs: 'ticker', every: 60 }, { id: 'no', script: 'tick', runsAs: 'nobody', every: 60 }] },
    stateDir: path.join(box, '.pk-state'), clock: () => clk.t, audit: (r) => audit.push(r) });
  try {
    clk.t += 60000; await s.tick();
    const done = Object.fromEntries(audit.filter((r) => r.kind === 'trigger-done').map((r) => [r.id, r]));
    assert.equal(done.ok.ok, true, JSON.stringify(done.ok));
    assert.equal(done.no.ok, false); assert.equal(done.no.code, 'NOT_PERMITTED');
    assert.match(String(JSON.parse(fs.readFileSync(path.join(box, '.pk-state', 's-ticker', 'state.json'), 'utf8')).keys.n.value.v), /^1(\/1)?$/, 'the script ran once');
  } finally { engine.close(); }
});
