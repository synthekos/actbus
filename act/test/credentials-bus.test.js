// credentials-bus.test.js — v1.3.0 · tests: the `grounded` credential end to end through the bus, the envelope and the engine · changelog: act/CHANGELOG.md#acttestcredentials-bustestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// · F-B end to end: `grounded` through the BUS, the envelope and the script engine. Run: node --test test/credentials-bus.test.js
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
const E = require(path.join(ROOT, 'core/envelope'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');   // 0.53.2: shipped built-ins only — an installed script (staging: scout) is not part of this test
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'pkfb-' + t + '-'));

// a box with one extra native action that PRODUCES grounded (as a document-facts reader would) — the only door for the credential
const DOCFACT = { name: 'docfact', version: '1.0.0', kind: 'native', file: 'docfact.js', produces: 'grounded', world: false, needs: [], input: {}, timeoutMs: 2000 };
function world(scripts) {
  const dir = tmp('act'), box = tmp('box');                 // as on live: the state root IS the files root
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'docfact.js'), "module.exports = { run: () => ({ value: '38', unit: 'kg' }) };\n");
  const spec = [...SPEC, DOCFACT];
  for (const [name, src, extra] of scripts) {
    fs.writeFileSync(path.join(dir, name + '.pk'), src);
    spec.push({ name, version: '1.0.0', kind: 'script', file: name + '.pk', produces: 'computed', world: false, runsAs: name, needs: [], input: { x: 'string?' }, acceptWarnings: true, ...(extra || {}) });
  }
  const actions = spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) }));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions }));
  const audit = [];
  const engine = createEngine({ stateRoot: box, audit: (r) => audit.push(r) });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const g = { calc: {}, docfact: {}, 'file-append': {}, 'file-read': {} };
  for (const [name] of scripts) g[name] = {};
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: g }, ...scripts.map(([name]) => ({ name, kind: 'script', owner: 'alex', actions: g }))]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), fetch: async () => ({ status: 404, text: async () => '' }), filesRoot: box, audit: (l) => audit.push(JSON.parse(l)) });
  return { bus, audit, box };
}
const G = (r) => Array.isArray(r.labels) && r.labels.includes('grounded');
const ask = (w, a, input = {}, labels = []) => w.bus.ask('alex', a, input, { labels });
const sent = (w, action) => w.audit.filter((a) => a.action === action && a.outcome === 'run');

test('F-B bus keeps: a value read from the documents (docfact) comes back grounded through a script', async () => {
  const w = world([['read', '(get (docfact) "value")']]);
  const r = await ask(w, 'read');
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, '38'); assert.equal(G(r), true, 'labels ' + r.labels);
});
test('F-B bus: a script that has READ a fact but returns a literal is not grounded', async () => {
  const w = world([['lit', '(do (docfact) "38")'], ['lit2', '(and (docfact) "38")']]);
  for (const s of ['lit', 'lit2']) { const r = await ask(w, s); assert.equal(r.value, '38'); assert.equal(G(r), false, s + ' labels ' + r.labels); }
});
test('F-B bus: a native action\'s reply never carries its input\'s credential (calc on a document value is computed)', async () => {
  const w = world([['c', '(get (calc :expr (get (docfact) "value")) "result")']]);
  const r = await ask(w, 'c');
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, '38');
  assert.equal(G(r), false, 'labels ' + r.labels); assert.ok(r.labels.includes('computed'));
  assert.ok(sent(w, 'calc')[0].labels.includes('grounded'), 'calc WAS sent a grounded value (per value): ' + sent(w, 'calc')[0].labels);
});
test('F-B bus: grounded text kept in a file does not come back grounded (file-read is a native reply)', async () => {
  const w = world([['fw', '(let ((n (get (docfact) "value"))) (file-append :name n :text n) (get (file-read :name n) "text"))', { world: true }]]);
  const r = await ask(w, 'fw');
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, '38');
  assert.equal(G(r), false, 'labels ' + r.labels);
});
test('F-B bus: control sent to an action never carries the credential', async () => {
  const w = world([['k', '(when (get (docfact) "value") (calc :expr "1+1"))']]);
  await ask(w, 'k');
  const c = sent(w, 'calc')[0];
  assert.ok(c && !c.labels.includes('grounded') && !(c.ctl || []).includes('grounded'), 'calc was sent ' + (c && c.labels) + ' ctl ' + (c && c.ctl));
});
test('F-B edge: a caller cannot declare a credential (warnings it may)', async () => {
  const w = world([['echo', '(input x)']]);
  const r = await ask(w, 'echo', { x: '38' }, ['grounded', 'web']);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(G(r), false, 'labels ' + r.labels); assert.ok(r.labels.includes('web'));
  assert.equal(E.root({ from: 'alex', action: 'x', labels: ['grounded'], kindLabel: 'person', time: new Date().toISOString() }).labels.includes('grounded'), false);
});
test('F-B bus: a hand-built message carrying the credential is refused — null, missing or invented replyTo', async () => {
  const w = world([['echo', '(input x)']]);
  for (const [k, replyTo] of [['null', null], ['missing', undefined], ['invented', 'nope']]) {
    const env = { id: 'fb-' + k + '-' + Date.now(), from: 'alex', to: 'local', action: 'echo', input: { x: 'FORGED 999' }, time: new Date().toISOString(),
      trace: 'fb-' + k + '-' + Date.now(), hops: E.DEFAULT_HOPS, labels: ['person', 'grounded'], ctl: [], authority: ['alex'] };
    if (k !== 'missing') env.replyTo = replyTo;
    const r = await w.bus.dispatch(env);
    assert.equal(r.ok, false, k + ': ' + JSON.stringify(r)); assert.equal(r.code, 'BAD_ENVELOPE', k);
  }
});
test('F-B bus: an identity named s-<script> cannot write that script\'s state (state root = files root, as on live)', async () => {
  const forged = JSON.stringify({ v: 1, keys: { r: { value: { k: 'str', v: 'FORGED 999' }, labels: ['grounded'] } }, absent: [] });
  const w = world([['victim', '(remembered r)'], ['s-victim', '(file-append :name "state.json" :text ' + JSON.stringify(forged) + ')', { world: true }]]);
  const a = await ask(w, 's-victim'); assert.equal(a.ok, true, JSON.stringify(a));
  const r = await ask(w, 'victim');
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, null, 'the victim read ' + JSON.stringify(r.value)); assert.equal(G(r), false);
});
test('F-B bus: an error never carries a credential; a child does not inherit one', async () => {
  const w = world([['f', '(do (docfact) (fail "38"))']]);
  const r = await ask(w, 'f');
  assert.equal(r.ok, false); assert.equal(G(r), false, 'labels ' + r.labels);
  const p = { ...E.root({ from: 'x', action: 'a', kindLabel: 'person', time: new Date().toISOString() }), labels: ['person', 'grounded'] };
  assert.equal(E.child(p, { action: 'b', labels: ['person'], from: 'x', authority: ['x'], time: new Date().toISOString() }).labels.includes('grounded'), false);
});
test('F-B bus unchanged: warnings still travel — a declared web label reaches the reply and the child', async () => {
  const w = world([['c', '(get (calc :expr (input x)) "result")']]);
  const r = await ask(w, 'c', { x: '1+1' }, ['web']);
  assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.labels.includes('web'), 'labels ' + r.labels);
  assert.ok(sent(w, 'calc')[0].labels.includes('web'), 'calc was sent ' + sent(w, 'calc')[0].labels);
});

test('F-B bus: a hand-built envelope whose label list lies to the check (Array subclass, getter) gets no credential through', async () => {
  const w = world([['echo', '(input x)']]);
  class L extends Array { some() { return false; } }
  const base = () => ({ id: 'fb-lie-' + Math.random(), from: 'alex', to: 'local', action: 'echo', input: { x: 'FORGED 999' }, replyTo: null,
    time: new Date().toISOString(), trace: 'fb-lie-' + Math.random(), hops: E.DEFAULT_HOPS, ctl: [], authority: ['alex'] });
  const a = { ...base(), labels: L.from(['person', 'grounded']) };
  let n = 0; const b = base(); Object.defineProperty(b, 'labels', { enumerable: true, get: () => (++n <= 4 ? ['person'] : ['person', 'grounded']) });
  for (const env of [a, b]) {
    const r = await w.bus.dispatch(env);
    assert.ok(!r.ok || !G(r), 'forged through: ' + JSON.stringify(r));
  }
});
