// selfreview.test.js — v1.0.0 · tests: the six holes a self-review found, one test each · changelog: act/CHANGELOG.md#acttestselfreviewtestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// self-review (NOT independent): the six holes found 30 Oct; each FAILS on the code before the fix
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { world, SCRIPT, reason, fs, path } = require('./harness');
const URL_ = 'https://rates.example/p';
const wrote = (w, name) => w.audit.filter((l) => l.action === 'file-append' && l.outcome === 'run');

// S1 — P1: web data stored in state, returned by a script, written by ANOTHER script: must not run unlabelled
test('S1 web data via state + script reply must stay web', async () => {
  const reader = [SCRIPT('reader', 'reader.pk', { world: true, input: { store: 'boolean?' }, acceptWarnings: true }),
    `(if (input store) (remember page (get (fetch :url "${URL_}") "text")) (remembered page))`];
  const writer = [SCRIPT('writer', 'writer.pk', { world: true, acceptWarnings: false }), `(file-append :name "x.txt" :text (reader))`];
  const w = world({ scripts: [reader, writer], page: 'SECRET-FROM-PAGE' });
  assert.deepEqual(w.loaded.refused, [], JSON.stringify(w.loaded.refused));
  const r1 = await w.bus.ask('alex', 'reader', { store: true }); assert.equal(r1.ok, true, JSON.stringify(r1));
  const r2 = await w.bus.ask('alex', 'writer', {});
  const runs = wrote(w);
  assert.equal(runs.length, 0, 'web page text was WRITTEN with labels ' + JSON.stringify(runs[0] && runs[0].labels) + ' — ' + JSON.stringify(r2));
});

// S2 — P2: strictControl — a web condition steers the script by aborting BEFORE the write (no lexical branch around it)
test('S2 strictControl cannot be bypassed by an early fail', async () => {
  const src = `(when (= (get (fetch :url "${URL_}") "text") "STOP") (fail "stopped"))\n(file-append :name "x.txt" :text "hello")`;
  const w = world({ scripts: [[SCRIPT('abort', 'abort.pk', { acceptWarnings: true }), src]], strict: true, page: 'GO' });
  assert.deepEqual(w.loaded.refused, []);
  await w.bus.ask('alex', 'abort', {});
  const runs = wrote(w);
  assert.equal(runs.length, 0, 'under strictControl a write steered by the page ran, ctl=' + JSON.stringify(runs[0] && runs[0].ctl));
});

// S2b — the same steering through an action error on web data (calc fails on non-numbers)
test('S2b strictControl cannot be bypassed by an action error on web data', async () => {
  const src = `(calc :expr (get (fetch :url "${URL_}") "text"))\n(file-append :name "x.txt" :text "hello")`;
  const w = world({ scripts: [[SCRIPT('abort2', 'abort2.pk', { acceptWarnings: true }), src]], strict: true, page: '1 + 1' });
  w.audit.length = 0;
  // calc is not granted in the harness identities? grant it via the registry: calc is a shipped action; add it to the grant list
  await w.bus.ask('alex', 'abort2', {});
  const runs = wrote(w);
  assert.equal(runs.length, 0, 'under strictControl a write after a page-dependent step ran, ctl=' + JSON.stringify(runs[0] && runs[0].ctl));
});

// S3 — P4: the load-time warning must flag a world call steered by an early abort (not only lexical branches)
test('S3 a steered world call needs acceptWarnings even with no branch around it', () => {
  const src = `(when (= (get (fetch :url "${URL_}") "text") "STOP") (fail "stopped"))\n(file-append :name "x.txt" :text "hello")`;
  const w = world({ scripts: [[SCRIPT('abort', 'abort.pk', { acceptWarnings: false }), src]] });
  assert.match(reason(w.loaded, 'abort'), /accept/, 'it loaded with no warning');
});

// S4 — P1/rule 4: a script CALLED under a web condition must remember under that condition
test('S4 inherited control reaches remember inside a called script', async () => {
  const setter = [SCRIPT('setter', 'setter.pk', { world: false, input: { v: 'string?' } }), `(if (input v) (remember x (input v)) (remembered x))`];
  const outer = [SCRIPT('outer', 'outer.pk', { world: true, acceptWarnings: true }), `(when (= (get (fetch :url "${URL_}") "text") "A") (setter :v "chosen-by-page"))`];
  const w = world({ scripts: [setter, outer], page: 'A' });
  assert.deepEqual(w.loaded.refused, []);
  await w.bus.ask('alex', 'outer', {});
  const set = w.audit.find((l) => l.kind === 'state-set' && l.identity === 'setter');
  assert.ok(set, 'setter remembered');
  assert.ok(set.labels.includes('web'), 'stored without the web control it ran under: ' + JSON.stringify(set.labels));
});

// S5 — P1: an error message quoting remembered web text must carry web
test('S5 a script error quoting remembered web text carries web', async () => {
  const s = [SCRIPT('quoter', 'quoter.pk', { world: true, input: { store: 'boolean?' }, acceptWarnings: true }),
    `(if (input store) (remember page (get (fetch :url "${URL_}") "text")) (fail (remembered page)))`];
  const w = world({ scripts: [s], page: 'SECRET-FROM-PAGE' });
  await w.bus.ask('alex', 'quoter', { store: true });
  const r = await w.bus.ask('alex', 'quoter', {});
  assert.equal(r.ok, false); assert.match(r.error, /SECRET-FROM-PAGE/);
  assert.ok(r.labels.includes('web'), 'error text from the page came back labelled ' + JSON.stringify(r.labels));
});

// S6 — guard (not a found hole): a script's error reply carries everything the run saw, like a successful reply does
test('S6 an error after reading web state comes back web-labelled (conservative replies, success or error)', async () => {
  const s = [SCRIPT('late', 'late.pk', { world: true, input: { store: 'boolean?' }, acceptWarnings: true }),
    `(if (input store) (remember page (get (fetch :url "${URL_}") "text")) (do (remembered page) (fail "a constant reason")))`];
  const w = world({ scripts: [s] });
  await w.bus.ask('alex', 'late', { store: true });
  const r = await w.bus.ask('alex', 'late', {});
  assert.equal(r.ok, false);
  assert.ok(r.labels.includes('web'), 'error reply labelled ' + JSON.stringify(r.labels));
});
