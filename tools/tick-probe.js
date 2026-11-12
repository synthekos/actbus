#!/usr/bin/env node
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// tick-probe.js — v1.0.0 (121126) · when a refused time trigger's retries are made (the README's Known gaps). It runs this repository's
// kernel, create() with its own scheduler on its own 15 s timer and the real clock, with one time trigger (every 60 s) whose identity is
// refused DEDUPE_FULL at every message (the bus's dedupeCap set to 0), and prints when the fire and its retries were made: the TICK line
// gives the gaps in seconds. It was the release kit's tick-v037.js 1.0.0. Writes only a temp folder. About 2 minutes.
//   usage: node tools/tick-probe.js <the repository>
'use strict';
const K = require('path').resolve(process.argv[2]);
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { create } = require(path.join(K, 'act.js'));
const U = (n) => '00000000-0000-4000-8000-00000000000' + n, name = (n) => 'u-' + U(n);
const users = [{ uniqueId: U(1), loginId: 'alex', role: 'admin', auth: 'login', actGrants: null }, { uniqueId: U(6), loginId: 'full', role: 'euser', auth: 'key', actGrants: null }];
const prisma = { user: { findMany: async () => users.slice(), findUnique: async ({ where }) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null, update: async ({ where, data }) => Object.assign(users.find((u) => u.uniqueId === where.uniqueId), data) } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tick-')), actionsDir = path.join(tmp, 'actions'), appDir = path.join(tmp, 'app');
fs.cpSync(path.join(K, 'act', 'actions'), actionsDir, { recursive: true }); fs.mkdirSync(appDir);
fs.writeFileSync(path.join(actionsDir, 'go.pk'), '(calc :expr "1+1")\n');
const spec = JSON.parse(fs.readFileSync(path.join(actionsDir, 'registry.spec.json'), 'utf8'));
spec.actions.push({ name: 'go', version: '1.0.0', kind: 'script', file: 'go.pk', produces: 'computed', world: false, runsAs: name(6), needs: [], acceptWarnings: false, input: {}, timeoutMs: 60000 });
fs.writeFileSync(path.join(actionsDir, 'registry.spec.json'), JSON.stringify(spec, null, 1) + '\n');
fs.writeFileSync(path.join(actionsDir, 'triggers.spec.json'), JSON.stringify({ triggers: [{ id: 't-full', script: 'go', runsAs: name(6), every: 60 }] }));
execFileSync(process.execPath, [path.join(K, 'act', 'make-registry.js'), actionsDir], { encoding: 'utf8' });
const quiet = { log() {}, error() {}, warn() {} };
const act = create({ prisma, productName: 'Lab', appDir, actionsDir, daemon: false, log: quiet });
(async () => {
  const r = await act.saveGrants(users[1], JSON.stringify({ owner: 'alex', actions: { go: {}, calc: {} }, rate: 120 }), 'alex'); if (!r.ok) throw new Error(JSON.stringify(r));
  act.bus.dedupeCap = 0;   // every message of this identity is refused DEDUPE_FULL (transient)
  const keep = setInterval(() => {}, 1000), t0 = Date.now();
  const rows = () => fs.readFileSync(act.LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((j) => j.id === 't-full' && /^trigger-(fire|done|retry-later|lost)$/.test(j.outcome));
  const iv = setInterval(() => {
    const L = rows(); const lost = L.find((j) => j.outcome === 'trigger-lost');
    if (lost || Date.now() - t0 > 240000) {
      clearInterval(iv); clearInterval(keep); act.stop();
      const fires = L.filter((j) => j.outcome === 'trigger-fire').map((j) => Date.parse(j.t));
      const gaps = fires.slice(1).map((x, i) => Math.round((x - fires[i]) / 1000));
      console.log('TICK ' + (lost ? 'lost' : 'NOT LOST') + ' · fires ' + fires.length + ' · gaps ' + gaps.join(',') + ' s · codes ' + L.filter((j) => j.outcome === 'trigger-done').map((j) => j.code).join(','));
      for (const j of L) console.log('  ' + j.t + ' ' + j.outcome + ' ' + (j.code || '') + (j.at ? ' at ' + j.at : ''));
      process.exit(0);
    }
  }, 500);
})().catch((e) => { console.error(e); process.exit(1); });
