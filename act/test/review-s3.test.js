// review-s3.test.js — v1.0.3 · tests: one per finding of the second-reader review of daemons, triggers and mail (R-S3) · changelog: act/CHANGELOG.md#acttestreview-s3testjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// slice 3 second-reader review: one test per confirmed finding (H1 H2 M1 M2 M3 L1 L2 + "every" never
// fires). Every test FAILS on the pre-review code (supervisor 1.0.0, engine 1.3.0, state 1.1.0, outbox 1.0.0, scheduler 1.0.0).
// Run: node --test test/review-s3.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
const { Supervisor } = require(path.join(ROOT, 'daemon/supervisor'));
const { Outbox } = require(path.join(ROOT, 'mail/outbox'));
const { Scheduler, validate, nextAt } = require(path.join(ROOT, 'scheduler'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');   // 0.53.2: shipped built-ins only — an installed script (staging: scout) is not part of this test
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'rv3-' + t + '-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a world whose script `s` (source src) runs in a daemon — the real pkd, or a FAKE one standing in for a compromised daemon
function world(src, { fake, daemon = {}, inputLabels, fuel } = {}) {
  const dir = tmp('act'), box = tmp('box');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 's.pk'), src);
  const spec = [...SPEC, { name: 's', version: '1.0.0', kind: 'script', file: 's.pk', produces: 'computed', world: false, runsAs: 's', needs: [], input: { x: 'string?' }, acceptWarnings: true }];
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  const audit = [];
  let opts = { audit: (r) => audit.push(r), ...daemon };
  if (fake) { const fd = tmp('fake'), fp = path.join(fd, 'fake.js'); fs.writeFileSync(fp, fake); opts = { ...opts, daemonPath: fp, allowRead: fd }; }
  const sup = new Supervisor(opts);
  const engine = createEngine({ stateRoot: box, audit: (r) => audit.push(r), daemon: sup, fuel });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: { s: {}, calc: {} } }, { name: 's', kind: 'script', owner: 'alex', actions: { s: {}, calc: {} } }]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), filesRoot: box, audit: (l) => audit.push(JSON.parse(l)) });
  return { bus, audit, box, engine, sup, ask: (input = {}) => bus.ask('alex', 's', input, { labels: inputLabels || [] }) };
}
const FAKE = (onRun) => `let rid; process.on('message', (m) => { if (m.t === 'run') { rid = m.runId; (${onRun})(m); } else if (m.t === 'reply') { process.send({ t: 'done', runId: rid, ok: true, value: String(m.reply.code || m.reply.ok), labels: ['person'], seen: [] }); } });
  process.send({ t: 'ready', pid: process.pid, permission: !!process.permission });`;

test('H1: the daemon inherits NO environment — not the mail password, not anything', async () => {
  process.env.PKD_REVIEW_SECRET = 'hunter2-secret';
  const w = world('"x"', { fake: FAKE("(m) => process.send({ t: 'done', runId: m.runId, ok: true, value: JSON.stringify(process.env), labels: ['person'], seen: [] })") });
  try {
    const r = await w.ask();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!r.value.includes('hunter2-secret'), 'the secret reached the daemon');
    assert.deepEqual(Object.keys(JSON.parse(r.value)).filter((k) => !/^(__CF_USER_TEXT_ENCODING|NODE_|ELECTRON)/.test(k)), []);
  } finally { delete process.env.PKD_REVIEW_SECRET; w.engine.close(); }
});

test('macOS install: a daemon whose code folder is reached through a SYMLINK still starts (macOS /var → /private/var)', async () => {
  const real = tmp('real'), link = path.join(tmp('link'), 'via-symlink');
  fs.symlinkSync(real, link);
  fs.writeFileSync(path.join(real, 'fake.js'), FAKE("(m) => process.send({ t: 'done', runId: m.runId, ok: true, value: 'started', labels: ['person'], seen: [] })"));
  const w = world('"x"', { daemon: { daemonPath: path.join(link, 'fake.js'), allowRead: link } });
  try { const r = await w.ask(); assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, 'started'); } finally { w.engine.close(); }
});

test('H2: a daemon asking for an action OUTSIDE the script\'s source is refused and audited — the action never runs', async () => {
  const w = world('"x"', { fake: FAKE("(m) => process.send({ t: 'call', runId: m.runId, callId: 1, action: 'calc', input: { expr: '6*7' }, labels: [], ctl: [] })") });
  try {
    const r = await w.ask();
    assert.equal(r.value, 'NOT_PERMITTED', JSON.stringify(r));
    assert.ok(!w.audit.some((x) => x.action === 'calc' && x.outcome === 'run'), 'calc ran');
    assert.ok(w.audit.some((x) => x.kind === 'daemon-refused' && x.action === 'calc'));
  } finally { w.engine.close(); }
});

test('H2: a daemon cannot mint a credential — `grounded` on its reply or its call is dropped unless the run received it', async () => {
  const w = world('(calc :expr "1")', { fake: FAKE("(m) => process.send({ t: 'call', runId: m.runId, callId: 1, action: 'calc', input: { expr: '1' }, labels: ['person', 'grounded'], ctl: [] })") });
  try {
    const r = await w.ask();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(!r.labels.includes('grounded'), 'reply: ' + r.labels);
    const run = w.audit.find((x) => x.action === 'calc' && x.outcome === 'run');
    assert.ok(run && !run.labels.includes('grounded'), JSON.stringify(run));
  } finally { w.engine.close(); }
  const d = world('"x"', { fake: FAKE("(m) => process.send({ t: 'done', runId: m.runId, ok: true, value: 'v', labels: ['person', 'grounded', 'nonsense'], seen: ['grounded'] })") });
  try { const r = await d.ask(); assert.equal(r.ok, true); assert.ok(!r.labels.includes('grounded') && !r.labels.includes('nonsense'), r.labels.join()); } finally { d.engine.close(); }
});

test('H2 (focused re-check): a daemon cannot re-mint `grounded` from an unrelated grounded state key', async () => {
  const w = world('"x"', { fake: FAKE("(m) => process.send({ t: 'done', runId: m.runId, ok: true, value: 'made up', labels: ['person', 'grounded'], seen: [] })") });
  try {
    fs.mkdirSync(path.join(w.box, '.pk-state', 's-s'), { recursive: true });
    fs.writeFileSync(path.join(w.box, '.pk-state', 's-s', 'state.json'), JSON.stringify({ v: 1, keys: { old: { value: 'x', labels: ['grounded'] } }, absent: ['grounded'] }));
    const r = await w.ask();
    assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(!r.labels.includes('grounded'), r.labels.join());
  } finally { w.engine.close(); }
});

test('H2: a script that can reach an action PRODUCING `grounded` runs in-process (per-value tracking), not in the daemon', async () => {
  const dir = tmp('act'), box = tmp('box');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'doc.js'), "module.exports = { run: async () => ({ v: '38' }) };");
  fs.writeFileSync(path.join(dir, 'g.pk'), '(get (doc) "v")');
  const spec = [...SPEC, { name: 'doc', version: '1.0.0', kind: 'native', file: 'doc.js', produces: 'grounded', world: false, needs: [], input: {}, timeoutMs: 2000 },
    { name: 'g', version: '1.0.0', kind: 'script', file: 'g.pk', produces: 'computed', world: false, runsAs: 'g', needs: [], input: {}, acceptWarnings: true }];
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  const audit = [], sup = new Supervisor({ audit: (r) => audit.push(r) });
  const engine = createEngine({ stateRoot: box, audit: (r) => audit.push(r), daemon: sup });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: { g: {}, doc: {} } }, { name: 'g', kind: 'script', owner: 'alex', actions: { g: {}, doc: {} } }]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), filesRoot: box, audit: () => {} });
  try {
    const r = await bus.ask('alex', 'g', {}, {});
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, '38');
    assert.ok(r.labels.includes('grounded'), 'the per-value credential was lost: ' + r.labels);
    assert.equal(sup.pidOf('g'), null, 'it ran in a daemon');
    assert.ok(audit.some((x) => x.kind === 'daemon-skipped' && /doc produces grounded/.test(x.why)), JSON.stringify(audit));
  } finally { engine.close(); }
});

test('H2: junk state labels from a daemon cannot poison the identity\'s state (the next run still works)', async () => {
  const w = world('"x"', { fake: FAKE("(m) => { process.send({ t: 'state-set', runId: m.runId, key: 'k', value: 1, labels: 'zz' }); process.send({ t: 'done', runId: m.runId, ok: true, value: 'v', labels: ['person'], seen: [] }); }") });
  try {
    await w.ask();
    const again = await w.ask();
    assert.equal(again.ok, true, JSON.stringify(again));
    const st = JSON.parse(fs.readFileSync(path.join(w.box, '.pk-state', 's-s', 'state.json'), 'utf8'));
    assert.ok(st.keys.k.labels.every((l) => ['person', 'device', 'computed', 'grounded', 'model', 'web'].includes(l)), JSON.stringify(st.keys.k));
  } finally { w.engine.close(); }
});

test('L1: after a timeout the next run gets a FRESH daemon, and the timeout counts as one crash', async () => {
  const L = '(list ' + Array.from({ length: 100 }, (_, i) => i).join(' ') + ')';
  const LONG = '(for-each (a ' + L + ') (for-each (b ' + L + ') (for-each (c ' + L + ') (+ a b c))))';
  const w = world('(if (input x) "quick" ' + LONG + ')', { daemon: { crashLimit: 99, timeoutMs: 300 }, fuel: 100000000 });
  w.sup.backoffMs = () => 0;
  try {
    const slow = await w.ask();
    assert.equal(slow.ok, false); assert.match(slow.error, /^TIMEOUT: /, JSON.stringify(slow));
    const quick = await w.ask({ x: 'y' });
    assert.equal(quick.ok, true, JSON.stringify(quick)); assert.equal(quick.value, 'quick');
    assert.equal(w.audit.filter((x) => x.kind === 'daemon-crash').length, 1, JSON.stringify(w.audit.filter((x) => x.kind === 'daemon-crash')));
  } finally { w.engine.close(); }
});

// ── outbox ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ME = 'alex@example.org';
const q = (o) => o.enqueue({ to: ME, subject: 's', text: 't', labels: ['person'], identity: 'helper', authority: ['helper'], trace: 't', targets: [ME] });

test('M1: mail queued for an address that is LATER removed from MAIL_ALLOW is failed at delivery, never sent', async () => {
  const dir = tmp('ob'), sent = [];
  q(new Outbox({ dir, allow: [ME] }));
  const o = new Outbox({ dir, allow: [], adapter: { send: async (r) => { sent.push(r.to); return { ok: true, code: 250 }; } } });
  await o.deliver();
  assert.deepEqual(sent, []);
  assert.equal(o.list()[0].status, 'failed');
});

test('M2: if the record cannot be marked "sending" nothing is sent; a crash mid-send is failed, never resent; a failing audit cannot throw', async () => {
  const dir = tmp('ob'), sent = [];
  const o = new Outbox({ dir, allow: [ME], adapter: { send: async (r) => { sent.push(r.id); return { ok: false, code: 451, temporary: true }; } } });
  q(o);
  const write = o.write.bind(o); o.write = () => { const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e; };
  for (let i = 0; i < 5; i++) await o.deliver();
  assert.equal(sent.length, 0, 'sent while the disk was full: ' + sent.length);
  o.write = write;
  const rec = o.records()[0]; rec.status = 'sending'; rec.sendingAt = Date.now() - 3600000; write(rec);   // what a crash mid-send leaves
  await o.deliver();
  assert.equal(sent.length, 0, 'an interrupted send was resent'); assert.equal(o.list()[0].status, 'failed');
  let boom = true;
  const p = new Outbox({ dir: tmp('ob'), allow: [ME], audit: () => { if (boom) throw new Error('audit disk full'); }, adapter: { send: async () => ({ ok: true, code: 250 }) } });
  assert.throws(() => q(p), /audit disk full/, 'queueing without an audit line must fail');
  assert.equal(p.records().length, 0, 'no line, no mail');
  boom = false; q(p); boom = true;
  await assert.doesNotReject(p.deliver(), 'a failing audit threw out of the delivery pass');
  assert.equal(p.records()[0].status, 'sent');
});

// ── scheduler ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('M3: a daily `at` trigger does not skip the spring-forward day', () => {
  const t = (at) => validate([{ id: 'x', script: 's', runsAs: 'r', at, tz: 'America/Toronto' }]).ok[0];
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(iso(nextAt(t('23:30'), Date.parse('2026-03-08T04:30:30Z'))), '2026-03-09T03:30:00.000Z');   // Mar 8 23:30 EDT
  assert.equal(iso(nextAt(t('09:00'), Date.parse('2026-03-08T04:10:00Z'))), '2026-03-08T13:00:00.000Z');   // Mar 8 09:00 EDT
  assert.equal(iso(nextAt(t('23:30'), Date.parse('2026-11-01T04:00:00Z'))), '2026-11-02T04:30:00.000Z');   // Nov 1 23:30 EST (fall-back day)
});

function sched(triggers, dir, T0) {
  const clk = { t: T0 }, calls = [], audit = [];
  const s = new Scheduler({ bus: { ask: (who, a) => { calls.push(a); return Promise.resolve({ ok: true, labels: [] }); } }, spec: { triggers }, stateDir: dir, clock: () => clk.t, audit: (r) => audit.push(r) });
  return { s, clk, calls, audit };
}
test('L2: a trigger named "constructor" (or "toString") is not born switched off', async () => {
  const a = sched([{ id: 'constructor', script: 's', runsAs: 'r', every: 60 }, { id: 'tostring', script: 's', runsAs: 'r', every: 60 }], tmp('sc'), Date.UTC(2026, 10, 3));
  a.clk.t += 60000; await a.s.tick();
  assert.equal(a.calls.length, 2, JSON.stringify(a.audit));
  assert.ok(a.s.status().every((x) => x.on), JSON.stringify(a.s.status()));
});
test('an `every` trigger fires on its grid even when the server restarts more often than its period', async () => {
  const dir = tmp('sc'), T0 = Date.UTC(2026, 10, 3, 12), tr = [{ id: 'h', script: 's', runsAs: 'r', every: 3600, missed: 'run-late' }];
  let fired = 0;
  for (let k = 0; k < 3; k++) {                                        // restarts at +0, +50 and +100 minutes, ticking every minute between
    const x = sched(tr, dir, T0 + k * 50 * 60000);
    for (let m = 0; m < 50; m++) { x.clk.t += 60000; await x.s.tick(); }
    fired += x.calls.length;
  }
  assert.ok(fired >= 2, 'fired ' + fired + ' times in 150 minutes');
});
