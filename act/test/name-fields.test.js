// name-fields.test.js — v1.0.1 · tests: a refusal writes `from` and `action` only where each is a name (issue #12, F1 and F2) · changelog: act/CHANGELOG.md#acttestname-fieldstestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// Issue #12, found while building its fix: act.js 1.9.3 wrote a caller's action that is not a name into the
// route's audit line (F1, act.js:333 → :318), and bus.js 1.7.2's refuse() wrote `from` and `action` as given, with :113's reason
// quoting `from` (F2). JSON leaves U+2028/U+2029, NEL, C1 and bidi controls raw. Tests marked FAIL-FIRST fail on act.js 1.9.3 /
// bus.js 1.7.2; tests marked GUARD hold on both. Every refused value is checked to be absent — raw or JSON-escaped — from the
// reply, its reason and every audit line. Doors: (a) act.route, (b) the test edge over HTTP, (c) bus.ask from an unknown name and
// with an action that is not a name, (d) a hand-built dispatch, (e) a native action's ctx.send (bus.js:236), (f) the hop limit (:231).
// The run line's `input` is not bounded (it is caller text); the last GUARD pins that, as the limit the README states.
// Run: node --test test/name-fields.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), http = require('http');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'nmf-' + t + '-'));

// issue #12's nine, each inside an otherwise name-like value
const HOSTILE = ['c\nx', 'c\rx', 'c\u001bx', 'c\u2028x', 'c\u2029x', 'c\u0085x', 'c\u009bx', 'c\u202ex', 'c\u2067x'];
const show = (v) => JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const escForm = (v) => JSON.stringify(v).slice(1, -1);
function absent(v, texts, where) {
  for (const t of texts) assert.ok(!t.includes(v) && !t.includes(escForm(v)), show(v) + ' reached ' + where + ': ' + show(t.slice(0, 240)));
}

const RELAY = "module.exports={run:async(i,ctx)=>{const r=await ctx.send(i.to,{expr:'1+1'});return {code:r.ok?'ok':r.code};}};";
function world() {
  const dir = tmp('act');
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.json'), 'utf8')).actions.filter((e) => e.name === 'calc');
  for (const e of spec) fs.copyFileSync(path.join(ROOT, 'actions', e.file), path.join(dir, e.file));
  fs.writeFileSync(path.join(dir, 'relay.js'), RELAY);
  const all = [...spec, { name: 'relay', version: '1.0.0', kind: 'native', file: 'relay.js', produces: 'computed', world: false, input: { to: 'string' } }]
    .map((e) => (e.sha256 ? e : { ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) }));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: all }));
  const loaded = registry.load(dir, 'registry.json', {});
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const audit = [];
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} }, { name: 'bot', kind: 'euser', owner: 'alex', actions: { calc: {}, relay: {} } }]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), audit: (l) => audit.push(l), filesRoot: tmp('f') });
  return { bus, audit };
}
// the run line's `input` is caller text, JSON-encoded as sent: a stated limit (README, Known gaps), so (e) and (f) check every line without it
const noInput = (l) => { const j = JSON.parse(l); delete j.input; return JSON.stringify(j); };
const hand = (o) => ({ id: crypto.randomUUID(), trace: crypto.randomUUID(), from: 'bot', to: 'local', action: 'calc', input: { expr: '1+1' },
  time: new Date().toISOString(), hops: 8, labels: [], ctl: [], authority: ['bot'], ...o });

function host() {   // (a): act.js's route, with a stand-in host as dedupe-full.test.js builds it
  const actmod = require(path.join(ROOT, '..', 'act.js'));
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
  const audit = () => { try { return fs.readFileSync(path.join(appDir, 'logs', 'act.jsonl'), 'utf8'); } catch { return ''; } };
  return { A, call, audit };
}

test('FAIL-FIRST (a) act.route: an action that is not a name is refused 400 BAD_ENVELOPE and is in no reply or audit line', async () => {
  const h = host();
  try {
    for (const v of HOSTILE) {
      const r = await h.call({ action: v, input: {} });
      assert.equal(r.code, 400, show(v)); assert.equal(r.body.code, 'BAD_ENVELOPE', show(v));
      absent(v, [JSON.stringify(r.body)], 'the reply');
    }
    assert.ok(h.audit().includes('"where":"route"'), 'the refusals are audited');
    for (const v of HOSTILE) absent(v, [h.audit()], 'the audit');
  } finally { if (h.A.stop) h.A.stop(); }
});
test('GUARD (a) act.route: a refusal for an action that IS a name still records that action', async () => {
  const h = host();
  try {
    const r = await h.call({ action: 'calc', labels: 'not-a-list', input: {} });
    assert.equal(r.code, 400, JSON.stringify(r.body));
    const line = h.audit().trim().split('\n').map((l) => JSON.parse(l)).find((j) => j.where === 'route');
    assert.equal(line && line.action, 'calc', 'the named action is recorded: ' + h.audit());
  } finally { if (h.A.stop) h.A.stop(); }
});

test('FAIL-FIRST (b) the edge: an action that is not a name is refused 400 BAD_ENVELOPE and is in no reply or audit line', async () => {
  const { createEdge } = require(path.join(ROOT, 'core/edge'));
  const w = world();
  const srv = http.createServer(createEdge({ bus: w.bus, resolveKey: () => 'bot' }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    for (const v of HOSTILE) {
      const r = await fetch('http://127.0.0.1:' + srv.address().port + '/act', { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify({ action: v, input: {} }) });
      const text = await r.text();
      assert.equal(r.status, 400, show(v) + ': ' + show(text));
      absent(v, [text], 'the reply');
    }
    for (const v of HOSTILE) absent(v, w.audit, 'the audit');
  } finally { srv.close(); }
});

test('FAIL-FIRST (c) bus.ask from a name that is not a name: UNKNOWN_IDENTITY, the value in no reply, reason or audit line', async () => {
  const w = world();
  for (const v of HOSTILE) {
    const r = await w.bus.ask(v, 'calc', { expr: '1+1' });
    assert.equal(r.code, 'UNKNOWN_IDENTITY', show(v));
    absent(v, [JSON.stringify(r), r.error], 'the reply or its reason');
  }
  assert.equal(w.audit.length, HOSTILE.length, 'each refusal is audited');
  for (const v of HOSTILE) absent(v, w.audit, 'the audit');
});
test('FAIL-FIRST (c) bus.ask with an action that is not a name: BAD_ENVELOPE, the value in no reply, reason or audit line', async () => {
  const w = world();
  for (const v of HOSTILE) {
    const r = await w.bus.ask('bot', v, {});
    assert.equal(r.code, 'BAD_ENVELOPE', show(v));
    absent(v, [JSON.stringify(r), r.error], 'the reply or its reason');
  }
  for (const v of HOSTILE) absent(v, w.audit, 'the audit');
});
test('GUARD (c) bus.ask: an unknown identity that IS a name is still recorded and named in the reason', async () => {
  const w = world();
  const r = await w.bus.ask('nobody', 'calc', { expr: '1+1' });
  assert.equal(r.code, 'UNKNOWN_IDENTITY');
  assert.match(r.error, /"nobody"/);
  const j = JSON.parse(w.audit[0]);
  assert.equal(j.from, 'nobody'); assert.equal(j.action, 'calc');
});

for (const k of ['from', 'action']) {
  test('FAIL-FIRST (d) a hand-built dispatch, ' + k + ' not a name: BAD_ENVELOPE, the value in no reply, reason or audit line', async () => {
    const w = world();
    for (const v of HOSTILE) {
      const r = await w.bus.dispatch(hand(k === 'from' ? { from: v, authority: [v] } : { action: v }));
      assert.equal(r.code, 'BAD_ENVELOPE', show(v));
      absent(v, [JSON.stringify(r), r.error], 'the reply or its reason');
    }
    for (const v of HOSTILE) absent(v, w.audit, 'the audit');
  });
}
test('GUARD (d) a hand-built dispatch of an unknown action that IS a name: UNKNOWN_ACTION, and the audit records it', async () => {
  const w = world();
  const r = await w.bus.dispatch(hand({ action: 'nope' }));
  assert.equal(r.code, 'UNKNOWN_ACTION');
  assert.equal(JSON.parse(w.audit[w.audit.length - 1]).action, 'nope');
});

test('FAIL-FIRST (e) a native action\'s ctx.send of an action that is not a name: refused, the value in no audit line', async () => {
  const w = world();
  for (const v of HOSTILE) {
    const r = await w.bus.ask('bot', 'relay', { to: v });
    assert.equal(r.ok, true, show(v) + ': ' + show(JSON.stringify(r)));
    assert.equal(r.value.code, 'BAD_ENVELOPE', show(v) + ': the child call was refused');
    absent(v, [JSON.stringify(r)], 'the reply');
  }
  for (const v of HOSTILE) absent(v, w.audit.map(noInput), 'the audit (input aside)');
});
test('FAIL-FIRST (f) the hop limit: a ctx.send at hops 0 of an action that is not a name is refused HOP_LIMIT, the value in no audit line', async () => {
  const w = world();
  for (const v of HOSTILE) {
    const r = await w.bus.dispatch(hand({ action: 'relay', input: { to: v }, hops: 0 }));
    assert.equal(r.ok, true, show(v) + ': ' + show(JSON.stringify(r)));
    assert.equal(r.value.code, 'HOP_LIMIT', show(v));
  }
  assert.ok(w.audit.some((l) => JSON.parse(l).code === 'HOP_LIMIT'), 'the hop-limit refusals are audited');
  for (const v of HOSTILE) absent(v, w.audit.map(noInput), 'the audit (input aside)');
});
test('GUARD (e) a native action\'s ctx.send of a named action runs, and its audit line names it', async () => {
  const w = world();
  const r = await w.bus.ask('bot', 'relay', { to: 'calc' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(w.audit.some((l) => { const j = JSON.parse(l); return j.action === 'calc' && j.outcome === 'run'; }), 'the child run is audited by name');
});
test('GUARD (limit, stated) the run line records the input as caller text, JSON-encoded as sent: U+2028 stays raw there', async () => {
  const w = world();
  const r = await w.bus.ask('bot', 'relay', { to: 'c\u2028x' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const run = w.audit.map((l) => JSON.parse(l)).find((j) => j.action === 'relay' && j.outcome === 'run');
  assert.ok(run && run.input.includes('\u2028'), 'the input is recorded as sent (the limit README.md states): ' + show(run && run.input));
});
