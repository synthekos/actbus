#!/usr/bin/env node
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// measure-memory-bus.js — v1.0.0 (121126) · the memory of the ids the bus keeps, by the second of the two methods in docs/host.md ("The dedupe
// check"). It was the release kit's measure-v035.js 1.0.0 (kit actbus-v035-111126); only this header and the name in its usage lines
// changed. It measures what one remembered id costs on THIS machine: bytes of heap
// per id, and per identity at the cap. It is a measurement, not a check: it prints the numbers and fails only if it could not measure.
// The method: the tree's own bus.js, one identity, N ids, sent through the real path (calc) with a clock that moves 1 s per call so the
// grant's rate never refuses one; then the heap is read (after a full gc) with that identity's set held, and again after the set alone is
// dropped. The difference over N is the cost of one entry of the set: the id string and its time. Everything else the run made (audit,
// traces, rates) is held in both readings, so it cancels out. A fall of 16 bytes per id or less is not a measurement, and fails.
// The kinds: uuid (no id from the caller: the bus makes a 36-character one, as the route does); ascii80, latin80, cyr80 and astral80
// (the caller's id, 80 UTF-16 code units, the most check 1 lets in: 72 of x, é, ж, or 36 of the emoji U+1F600 at two units each, then
// an 8-digit counter). V8 keeps a string whose characters are all Latin-1 at one byte per unit, and any other at two.
// Writes only into a temp folder.   usage: node --expose-gc tools/measure-memory-bus.js <tree> <uuid|ascii80|latin80|cyr80|astral80> [N, default 50000]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const [T0, KIND, N0] = process.argv.slice(2);
const FILL = { ascii80: 'x'.repeat(72), latin80: 'é'.repeat(72), cyr80: 'ж'.repeat(72), astral80: '\u{1F600}'.repeat(36) };
if (!T0 || !(KIND === 'uuid' || KIND in FILL) || typeof global.gc !== 'function') { console.error('usage: node --expose-gc tools/measure-memory-bus.js <tree> <uuid|ascii80|latin80|cyr80|astral80> [N]'); process.exit(2); }
const mk = (k) => KIND === 'uuid' ? null : FILL[KIND] + String(k).padStart(8, '0');
const R = path.join(path.resolve(T0), 'act'), N = Number(N0 || 50000);
const registry = require(R + '/core/registry'), caps = require(R + '/core/capabilities'), { Names } = require(R + '/core/names'), { Bus } = require(R + '/core/bus');
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'ms035-'));
const SPEC = JSON.parse(fs.readFileSync(R + '/actions/registry.json', 'utf8')).actions.filter((e) => e.name === 'calc');
const d = path.join(W, 'acts'); fs.mkdirSync(d); for (const e of SPEC) fs.copyFileSync(path.join(R, 'actions', e.file), path.join(d, e.file));
fs.writeFileSync(path.join(d, 'registry.json'), JSON.stringify({ actions: SPEC }));
const acts = registry.load(d, 'registry.json', {}).actions;
const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} }, { name: 'bot', kind: 'euser', owner: 'alex', actions: { calc: {} } }]);
const clk = { t: Date.UTC(2026, 10, 11, 12) };
const bus = new Bus({ registry: acts, identities: ids, names: new Names('local'), audit: () => {}, filesRoot: path.join(W, 'f'), clock: () => clk.t, dedupeCap: N + 1 });
fs.mkdirSync(path.join(W, 'f'));
const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed; };
(async () => {
  const t0 = Date.now();
  for (let k = 0; k < N; k++) { const id = mk(k); const r = await bus.ask('bot', 'calc', { expr: '1+1' }, id ? { id } : {}); if (!r.ok) { console.log('MEASURE FAIL ' + KIND + ' — call ' + k + ' was refused: ' + r.code); process.exit(1); } clk.t += 1000; }
  let held = bus.seen.get('bot'); const n = held ? held.size : 0;
  if (n !== N) { console.log('MEASURE FAIL ' + KIND + ' — the set holds ' + n + ' ids, not ' + N); process.exit(1); }
  const sample = String(held.keys().next().value); held = null;   // no reference to the set is kept here, so dropping it from the bus frees it
  const withSet = heap(); bus.seen.delete('bot'); const without = heap();
  const per = (withSet - without) / N, atCap = per * 50000 / 1e6;
  if (!(per > 16)) { console.log('MEASURE FAIL ' + KIND + ' — the heap fell by ' + (withSet - without) + ' bytes when the set was dropped: it was not freed, nothing was measured'); process.exit(1); }
  console.log('MEASURED ' + KIND + ' — ' + Math.round(per) + ' bytes per id (' + N + ' ids of ' + sample.length + ' UTF-16 code units), about ' + atCap.toFixed(1) + ' MB per identity at the default cap of 50 000 · node ' + process.version + ' ' + os.platform() + '-' + os.arch() + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  fs.rmSync(W, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.log('MEASURE FAIL ' + KIND + ' — ' + String(e && e.message || e).slice(0, 160)); process.exit(1); });
