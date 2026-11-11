// script-host.js — v1.0.0 · a host with one PROTEUS-K script: registered, approved, refused, then run (docs/proteus-k.md §7).
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// Run from the repository root: node examples/script-host.js
// It writes the actions folder, the audit log and the identities' files to a new temp folder, never into the repository.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { create } = require('../act.js');

// Three records: a person who owns both EUsers; the EUser that calls the script; the EUser the script runs as.
const users = [
  { uniqueId: '00000000-0000-4000-8000-000000000001', loginId: 'alex', role: 'admin', auth: 'login', actGrants: null },
  { uniqueId: '00000000-0000-4000-8000-000000000002', loginId: 'caller', role: 'euser', auth: 'key', actGrants: null },
  { uniqueId: '00000000-0000-4000-8000-000000000003', loginId: 'helper', role: 'euser', auth: 'key', actGrants: null },
];
const prisma = { user: {
  findMany: async () => users.slice(),
  findUnique: async ({ where }) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null,
  update: async ({ where, data }) => Object.assign(users.find((u) => u.uniqueId === where.uniqueId), data),
} };
const [, caller, helper] = users;

// 1. The script and its registry entry, in a copy of act/actions/ (never in act/actions/ itself). The script runs as helper.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'actbus-script-'));
const actionsDir = path.join(tmp, 'actions'), appDir = path.join(tmp, 'app');
fs.cpSync(path.join(__dirname, '..', 'act', 'actions'), actionsDir, { recursive: true });
fs.mkdirSync(appDir);
fs.writeFileSync(path.join(actionsDir, 'answer.pk'), '(calc :expr "6*7")\n');
const spec = JSON.parse(fs.readFileSync(path.join(actionsDir, 'registry.spec.json'), 'utf8'));
spec.actions.push({ name: 'answer', version: '1.0.0', kind: 'script', file: 'answer.pk', produces: 'computed',
  world: false, runsAs: 'u-' + helper.uniqueId, needs: [], acceptWarnings: false, input: {}, timeoutMs: 60000 });
fs.writeFileSync(path.join(actionsDir, 'registry.spec.json'), JSON.stringify(spec, null, 1) + '\n');

// 2. The approval: make-registry.js pins every file's sha256 into registry.json; the kernel loads only what it pinned.
const approved = execFileSync(process.execPath, [path.join(__dirname, '..', 'act', 'make-registry.js'), actionsDir], { encoding: 'utf8' });
console.log('approved: ' + approved.split('\n').find((l) => /✓ answer /.test(l)).trim().replace(/\s+/g, ' '));

const act = create({ prisma, productName: 'MyHost', appDir, actionsDir });
const reply = (what) => ({ status(c) { this.code = c; return this; }, json(b) { console.log(what + ' → HTTP ' + this.code + ' ' + JSON.stringify(b)); return this; }, set() {} });

// 3. One call per line: the grants the administrator saved for each EUser, then caller asks for the script.
async function attempt(callerHolds, helperHolds) {
  for (const [u, names] of [[caller, callerHolds], [helper, helperHolds]]) {
    const g = await act.saveGrants(u, JSON.stringify({ owner: 'alex', actions: Object.fromEntries(names.map((n) => [n, {}])) }), 'alex');
    if (!g.ok) throw new Error('grants refused: ' + g.errors.join('; '));
  }
  await act.route({ euser: caller, body: { action: 'answer', input: {} } }, reply('caller holds ' + callerHolds.join(', ') + ' · helper holds ' + helperHolds.join(', ')));
}

(async () => {
  await attempt(['answer', 'calc'], ['calc']);             // refused: the script's own identity must hold the script too
  await attempt(['answer', 'calc'], ['answer', 'calc']);   // runs as helper, audited first
  await attempt(['calc'], ['answer', 'calc']);             // refused: the caller must hold the script
  await attempt(['answer'], ['answer', 'calc']);           // the script runs; its calc is refused: the caller must hold calc
  await attempt(['answer', 'calc'], ['answer']);           // the script runs; its calc is refused: helper must hold calc
  console.log('audit log: ' + act.LOG);
  act.stop();
})();
