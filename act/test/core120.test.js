// core120.test.js — v1.0.0 · tests: per-value labels for scripts, control labels, strictControl · changelog: act/CHANGELOG.md#acttestcore120testjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// capability core 1.2.0: per-value labels for scripts, ctl, strictControl (ACTBUS docs/proteus-k.md §5, §8)
// Every test marked [1.2.0] FAILS on core 1.1.0 (checked by running this file against it).
// The bus is built from a hand-made registry so the rules are tested apart from the registry (kind:script loading is 3b).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ROOT = process.env.CORE_ROOT || path.join(__dirname, '..');
const caps = require(path.join(ROOT, 'core/capabilities'));
const env_ = require(path.join(ROOT, 'core/envelope'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus, ERR } = require(path.join(ROOT, 'core/bus'));

const entry = (name, kind, run, extra = {}) => ({ name, version: '1.0.0', kind, sha256: 'f'.repeat(64), produces: kind === 'tentacle' ? 'web' : 'computed',
  world: false, runsAs: null, needs: [], input: {}, timeoutMs: 2000, impl: { run }, ...extra });
function mkBus({ strict = false, fetchTainted = false } = {}) {
  const audit = [];
  const reg = new Map([
    // a fake page: web-labelled text
    ['fetch', entry('fetch', 'tentacle', async () => ({ text: 'rate 1.3725' }), { produces: 'web', world: true, input: { url: 'string' } })],
    // the world action under test: records what it was asked to write
    ['file-append', entry('file-append', 'tentacle', async (i) => ({ written: i.text }), { produces: 'computed', world: true, input: { text: 'string' } })],
    // what the PROTEUS-K interpreter will be: a script entry passing per-value labels and ctl explicitly
    ['watch', entry('watch', 'script', async (i, ctx) => {
      const page = await ctx.send('fetch', { url: 'https://bank.example' });
      if (!page.ok) return { step: 'fetch', code: page.code };
      const fell = page.value.text.includes('1.3725');                 // a decision made on web data …
      const w = await ctx.send(i.via || 'file-append', { text: i.text }, { labels: i.dataLabels || ['person'], ctl: fell ? ['web'] : [] });
      return { step: 'write', ok: w.ok, code: w.code, error: w.error };
    }, { input: { text: 'string', dataLabels: 'array?', via: 'string?' } })],
    // the same logic as NATIVE code: it must keep 1.1.0's conservative rule (everything received taints what it sends)
    ['native-watch', entry('native-watch', 'native', async (i, ctx) => {
      await ctx.send('fetch', { url: 'https://bank.example' });
      const w = await ctx.send('file-append', { text: 'hello' }, { labels: ['person'], ctl: [] });
      return { ok: w.ok, code: w.code };
    })],
    // a native action a script calls; it calls file-append in turn (ctl must travel down the chain)
    ['relay', entry('relay', 'native', async (i, ctx) => { const w = await ctx.send('file-append', { text: i.text }); return { ok: w.ok, code: w.code }; }, { input: { text: 'string' } })],
  ]);
  const grant = (extra = {}) => ({ fetch: fetchTainted ? { allowTainted: true } : {}, 'file-append': { ...extra }, watch: {}, 'native-watch': {}, relay: {} });
  const ids = caps.fromList([
    { name: 'alex', kind: 'person', owner: 'alex', actions: grant(strict ? { strictControl: true } : {}) },
    { name: 'bot', kind: 'euser', owner: 'alex', actions: grant() },
  ]);
  const bus = new Bus({ registry: reg, identities: ids, names: new Names('local'), audit: (l) => audit.push(JSON.parse(l)) });
  return { bus, audit };
}
const runOf = (audit, action) => audit.filter((l) => l.action === action && l.outcome === 'run');

test('[1.2.0] a script fires a fixed world action under a web condition: runs, ctl recorded (rule b)', async () => {
  const { bus, audit } = mkBus();
  const r = await bus.ask('alex', 'watch', { text: 'hello' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.value.ok, true, 'file-append ran: ' + JSON.stringify(r.value));
  const fa = runOf(audit, 'file-append')[0];
  assert.deepEqual(fa.labels, ['person']);
  assert.deepEqual(fa.ctl, ['web'], 'the audit line says it fired under a web condition');
});

test('a script cannot pass web DATA to a world action (per-value labels honoured, not dropped)', async () => {
  const { bus } = mkBus();
  const r = await bus.ask('alex', 'watch', { text: 'rate 1.3725', dataLabels: ['web'] });
  assert.equal(r.value.ok, false); assert.equal(r.value.code, ERR.TAINTED);
});

test('a script cannot drop the labels it was CALLED with', async () => {
  const { bus } = mkBus({ fetchTainted: true });                    // so the script gets as far as the write
  const r = await bus.ask('alex', 'watch', { text: 'x', dataLabels: [] }, { labels: ['web'] });   // the caller declares web input
  assert.equal(r.value.ok, false); assert.equal(r.value.code, ERR.TAINTED);
});

test('[1.2.0] strictControl: the same call is refused, and the reason names the control labels', async () => {
  const { bus, audit } = mkBus({ strict: true });
  const r = await bus.ask('alex', 'watch', { text: 'hello' });
  assert.equal(r.value.ok, false); assert.equal(r.value.code, ERR.TAINTED);
  assert.match(r.value.error, /control/);
  const ref = audit.find((l) => l.action === 'file-append' && l.outcome === 'refused');
  assert.deepEqual(ref.ctl, ['web']);
});

test('native code keeps 1.1.0: everything it received taints what it sends (labels or ctl passed are ignored)', async () => {
  const { bus } = mkBus();
  const r = await bus.ask('alex', 'native-watch', {});
  assert.equal(r.value.ok, false); assert.equal(r.value.code, ERR.TAINTED);
});

test('[1.2.0] ctl travels down the chain: script → native relay → file-append', async () => {
  const { bus, audit } = mkBus();
  const r = await bus.ask('alex', 'watch', { text: 'hi', via: 'relay' });
  assert.equal(r.value.ok, true, JSON.stringify(r.value));
  const fa = runOf(audit, 'file-append')[0];
  assert.deepEqual(fa.ctl, ['web'], 'the relay cannot shed the control labels');
  const s = mkBus({ strict: true });
  await s.bus.ask('alex', 'watch', { text: 'hi', via: 'relay' });
  assert.equal(runOf(s.audit, 'file-append').length, 0, 'under strictControl the relayed write never runs');
  const ref = s.audit.find((l) => l.action === 'file-append' && l.outcome === 'refused');
  assert.equal(ref.code, 'TAINTED'); assert.deepEqual(ref.ctl, ['web']);
});

test('a script\'s own reply stays conservative: it carries everything it received', async () => {
  const { bus } = mkBus();
  const r = await bus.ask('alex', 'watch', { text: 'hello' });
  assert.ok(r.labels.includes('web'));
});

test('[1.2.0] envelope: ctl is checked and inherited', () => {
  const root = env_.root({ from: 'alex', action: 'x', kindLabel: 'person', time: 't' });
  assert.deepEqual(root.ctl, []);
  const c = env_.child({ ...root, ctl: ['web'] }, { action: 'y', from: 'alex', authority: ['alex'], ctl: ['model'], time: 't' });
  assert.deepEqual(c.ctl.sort(), ['model', 'web']);
  assert.throws(() => env_.check({ ...root, ctl: ['evil'] }), /ctl/);
  assert.throws(() => env_.check({ ...root, ctl: 'web' }), /ctl/);
});

test('[1.2.0] capabilities: strictControl must be true/false; any identity in the chain makes it strict', () => {
  const base = { name: 'alex', kind: 'person', owner: 'alex' };
  assert.throws(() => caps.fromList([{ ...base, actions: { x: { strictControl: 'yes' } } }]), /strictControl/);
  const ids = caps.fromList([{ ...base, actions: { x: {} } }, { name: 'b', kind: 'euser', owner: 'alex', actions: { x: { strictControl: true } } }]);
  assert.equal(caps.effective(ids, ['alex'], 'x').strictControl, false);
  assert.equal(caps.effective(ids, ['alex', 'b'], 'x').strictControl, true);
});
