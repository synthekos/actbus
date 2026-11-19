// id-charset.test.js — v1.0.2 · tests: an envelope's id, trace and replyTo are 1–80 characters of A-Z a-z 0-9 . _ : - (issue #12) · changelog: act/CHANGELOG.md#acttestid-charsettestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// Issue #12: envelope.js 1.2.1 bounded id and trace to 1–80 UTF-16 units of ANY character, and replyTo not at all.
// JSON escapes C0 but leaves U+2028, U+2029, NEL, C1 and bidi controls raw, so a value could break or reorder an audit line for a
// reader. Tests marked FAIL-FIRST fail on envelope.js 1.2.1 (kernel v0.54.6); tests marked GUARD hold on both. Every refused value
// is checked to be absent — raw or JSON-escaped — from the reply, its reason, every audit line and the dedupe file.
// Doors: (a) act.route through a stand-in host, (b) the bus's test edge over HTTP, (c) bus.ask { id }, (d) bus.ask { trace },
// (e) a hand-built bus.dispatch, with the value as id, as trace and as replyTo.
// Run: node --test test/id-charset.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), http = require('http');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'idc-' + t + '-'));

// issue #12's nine (line breaks, an escape, Unicode line separators, C1 and bidi controls), one-unit non-ASCII, four printable ASCII outside the set, a trailing newline, 81 units
const REFUSED = ['nl\nid', 'cr\rid', 'esc\u001bid', 'ls\u2028id', 'ps\u2029id', 'nel\u0085id', 'csi\u009bid', 'rlo\u202eid', 'rli\u2067id',
  'smile\u263aid', 'a b', 'a>b', 'a/b', 'a"b', 'job-42\n', 'x'.repeat(81)];
const ACCEPTED = [crypto.randomUUID(), crypto.randomUUID().toUpperCase(), 'job-42', 'r1-twin', 'a.b_c:d-e', 'x'.repeat(80)];
const show = (v) => JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const escForm = (v) => JSON.stringify(v).slice(1, -1);
function absent(v, texts, where) {   // the value, raw or as JSON writes it, appears in none of the texts
  for (const t of texts) assert.ok(!t.includes(v) && !t.includes(escForm(v)), show(v) + ' reached ' + where + ': ' + show(t.slice(0, 200)));
}
const dedupe = (files) => { try { return fs.readFileSync(path.join(files, '.dedupe.jsonl'), 'utf8'); } catch { return ''; } };

function world() {
  const dir = tmp('act'), files = tmp('f');
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.json'), 'utf8')).actions.filter((e) => e.name === 'calc');
  for (const e of spec) fs.copyFileSync(path.join(ROOT, 'actions', e.file), path.join(dir, e.file));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec }));
  const loaded = registry.load(dir, 'registry.json', {});
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const audit = [];
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} }, { name: 'bot', kind: 'euser', owner: 'alex', actions: { calc: {} } }]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), audit: (l) => audit.push(l), filesRoot: files });
  return { bus, audit, files };
}
const hand = (o) => ({ id: crypto.randomUUID(), trace: crypto.randomUUID(), from: 'bot', to: 'local', action: 'calc', input: { expr: '1+1' },
  time: new Date().toISOString(), hops: 8, labels: [], ctl: [], authority: ['bot'], ...o });

function host() {   // (a): act.js's route, with a stand-in host as dedupe-full.test.js builds it
  const APP = path.join(ROOT, '..');
  const actmod = require(path.join(APP, 'act.js'));
  const ALEX = { role: 'admin', auth: 'login', actGrants: null, uniqueId: 'a1b2c3d4-0000-4000-8000-00000000000f', loginId: 'alex' };
  const BOT = { role: 'euser', auth: 'key', uniqueId: 'a1b2c3d4-0000-4000-8000-0000000000b0', loginId: 'bot', actGrants: JSON.stringify({ owner: 'alex', ownerId: ALEX.uniqueId, actions: { calc: {} } }) };
  const USERS = [ALEX, BOT];
  const prisma = { user: { findMany: async () => USERS.slice(), findUnique: async ({ where }) => USERS.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null, update: async () => null } };
  const src = path.join(ROOT, 'actions'), actionsDir = tmp('acts');
  const builtins = JSON.parse(fs.readFileSync(path.join(src, 'registry.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
  for (const e of builtins) fs.copyFileSync(path.join(src, e.file), path.join(actionsDir, e.file));
  fs.writeFileSync(path.join(actionsDir, 'registry.json'), JSON.stringify({ actions: builtins }));
  const appDir = tmp('app'); fs.mkdirSync(path.join(appDir, 'act-files'), { recursive: true });
  const A = actmod.create({ prisma, models: { isInstalled: () => false }, modelUrl: 'http://127.0.0.1:1', appDir, log: { error() {} }, actionsDir });
  const call = async (body) => { const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } }; await A.route({ euser: BOT, body }, res); return res; };
  const texts = () => { const out = []; for (const f of [path.join(appDir, 'logs', 'act.jsonl'), path.join(appDir, 'act-files', '.dedupe.jsonl')]) { try { out.push(fs.readFileSync(f, 'utf8')); } catch { /* not written */ } } return out; };
  return { A, call, texts };
}

test('FAIL-FIRST (a) act.route: an id outside the rule is refused 400 BAD_ENVELOPE; nothing runs; the value is in no reply, audit line or dedupe line', async () => {
  const h = host();
  try {
    for (const v of REFUSED) {
      const r = await h.call({ id: v, action: 'calc', input: { expr: '1+1' } });
      assert.equal(r.code, 400, show(v) + ' was not refused: ' + show(JSON.stringify(r.body)));
      assert.equal(r.body.code, 'BAD_ENVELOPE', show(v));
      absent(v, [JSON.stringify(r.body)], 'the reply');
    }
    absent('x'.repeat(81), h.texts(), 'the audit or dedupe file');
    for (const v of REFUSED) absent(v, h.texts(), 'the audit or dedupe file');
    assert.ok(!h.texts().join('').includes('"outcome":"run"'), 'nothing ran');
  } finally { if (h.A.stop) h.A.stop(); }
});

test('GUARD (a) act.route: ids inside the rule run (200); a missing id still gets a UUID', async () => {
  const h = host();
  try {
    for (const v of ACCEPTED) { const r = await h.call({ id: v, action: 'calc', input: { expr: '1+1' } }); assert.equal(r.code, 200, show(v) + ': ' + show(JSON.stringify(r.body))); }
    const none = await h.call({ action: 'calc', input: { expr: '1+1' } });
    assert.equal(none.code, 200, JSON.stringify(none.body));
    assert.match(none.body.id, /^[0-9a-f-]{36}$/);
  } finally { if (h.A.stop) h.A.stop(); }
});

async function edge(w) {   // (b)
  const { createEdge } = require(path.join(ROOT, 'core/edge'));
  const srv = http.createServer(createEdge({ bus: w.bus, resolveKey: () => 'bot' }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const post = async (body) => { const r = await fetch('http://127.0.0.1:' + srv.address().port + '/act', { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
  return { srv, post };
}
test('FAIL-FIRST (b) the edge: an id outside the rule is refused 400 BAD_ENVELOPE; nothing runs; the value is in no reply, audit line or dedupe line', async () => {
  const w = world(); const e = await edge(w);
  try {
    for (const v of REFUSED) {
      const r = await e.post({ id: v, action: 'calc', input: { expr: '1+1' } });
      assert.equal(r.status, 400, show(v) + ': ' + show(r.text));
      assert.equal(JSON.parse(r.text).code, 'BAD_ENVELOPE', show(v));
      absent(v, [r.text], 'the reply');
    }
    for (const v of REFUSED) absent(v, [...w.audit, dedupe(w.files)], 'the audit or dedupe file');
    assert.ok(!w.audit.some((l) => JSON.parse(l).outcome === 'run'), 'nothing ran');
  } finally { e.srv.close(); }
});
test('GUARD (b) the edge: ids inside the rule run (200)', async () => {
  const w = world(); const e = await edge(w);
  try { for (const v of ACCEPTED) { const r = await e.post({ id: v, action: 'calc', input: { expr: '1+1' } }); assert.equal(r.status, 200, show(v) + ': ' + show(r.text)); } }
  finally { e.srv.close(); }
});

for (const k of ['id', 'trace']) {
  test('FAIL-FIRST (' + (k === 'id' ? 'c' : 'd') + ') bus.ask { ' + k + ' }: a value outside the rule is refused BAD_ENVELOPE; it is in no reply, audit line or dedupe line', async () => {
    const w = world();
    for (const v of REFUSED) {
      const r = await w.bus.ask('bot', 'calc', { expr: '1+1' }, { [k]: v });
      assert.equal(r.ok, false, show(v) + ' as ' + k + ' ran: ' + show(JSON.stringify(r)));
      assert.equal(r.code, 'BAD_ENVELOPE', show(v));
      absent(v, [JSON.stringify(r), r.error || ''], 'the reply or its reason');
    }
    for (const v of REFUSED) absent(v, [...w.audit, dedupe(w.files)], 'the audit or dedupe file');
    assert.ok(!w.audit.some((l) => JSON.parse(l).outcome === 'run'), 'nothing ran');
  });
  test('GUARD (' + (k === 'id' ? 'c' : 'd') + ') bus.ask { ' + k + ' }: values inside the rule run', async () => {
    const w = world();
    for (const v of ACCEPTED) { const r = await w.bus.ask('bot', 'calc', { expr: '1+1' }, { [k]: v, ...(k === 'trace' ? { id: crypto.randomUUID() } : {}) }); assert.equal(r.ok, true, show(v) + ': ' + show(JSON.stringify(r))); }
  });
}

for (const k of ['id', 'trace', 'replyTo']) {
  test('FAIL-FIRST (e) a hand-built dispatch, ' + k + ': a value outside the rule is refused BAD_ENVELOPE; it is in no reply, audit line or dedupe line', async () => {
    const w = world();
    for (const v of REFUSED) {
      const r = await w.bus.dispatch(hand({ [k]: v }));
      assert.equal(r.ok, false, show(v) + ' as ' + k + ' ran: ' + show(JSON.stringify(r)));
      assert.equal(r.code, 'BAD_ENVELOPE', show(v) + ' as ' + k);
      absent(v, [JSON.stringify(r), r.error || ''], 'the reply or its reason');
    }
    for (const v of REFUSED) absent(v, [...w.audit, dedupe(w.files)], 'the audit or dedupe file');
    assert.ok(!w.audit.some((l) => JSON.parse(l).outcome === 'run'), 'nothing ran');
  });
}
test('GUARD (e) a hand-built dispatch: ids and traces inside the rule run; replyTo absent, null or a UUID runs', async () => {
  const w = world();
  for (const v of ACCEPTED) {
    for (const k of ['id', 'trace']) { const r = await w.bus.dispatch(hand({ [k]: v })); assert.equal(r.ok, true, show(v) + ' as ' + k + ': ' + show(JSON.stringify(r))); }
  }
  for (const rt of [undefined, null, crypto.randomUUID()]) {
    const env = hand({}); if (rt !== undefined) env.replyTo = rt;
    const r = await w.bus.dispatch(env); assert.equal(r.ok, true, 'replyTo ' + JSON.stringify(rt) + ': ' + show(JSON.stringify(r)));
  }
});
test('FAIL-FIRST the rule is one exported constant, and it is the rule of this issue', () => {
  const E = require(path.join(ROOT, 'core/envelope'));
  assert.ok(E.ID instanceof RegExp, 'envelope.js exports ID');
  assert.equal(E.ID.source, '^[A-Za-z0-9._:-]{1,80}$');
  assert.equal(E.ID.flags, '');
});
