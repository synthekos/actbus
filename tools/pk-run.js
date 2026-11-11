#!/usr/bin/env node
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// pk-run.js — v1.0.0 (111126) · runs PROTEUS-K expressions through the real kernel, one script per expression,
// so any example of docs/functions-and-mailboxes.md §2's reference table can be run end to end: each expression is written to
// its own .pk file in a temp copy of <repo>/act/actions/, registered as a script with no input that runs as the EUser `helper`, approved
// by <repo>/act/make-registry.js, and called by the EUser `caller` through act.route. Both EUsers hold every script and nothing else.
// It prints one line per expression, in the order given:   <expression>  →  <the reply's value as JSON>   or   →  <code>: <error>
// It exits 0 when every expression was called (a refused or failing expression is a printed result, not a failure of this tool), and
// exits 1, calling nothing, when make-registry.js refuses the scripts: it then prints NOT APPROVED and the tool's refusal.
//   usage, from the repository root: node tools/pk-run.js . '<expression>' …
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const [ROOT, ...EX] = process.argv.slice(2);
if (!ROOT || !EX.length) { console.error('usage: node pk-run.js <repo root> <expression> …'); process.exit(2); }
process.env.PK_DAEMON = '0';
const { create } = require(path.resolve(ROOT, 'act.js'));
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
const QUIET = { log() {}, warn() {}, error() {}, info() {} };
// a grant holds at most 50 actions (act.js), so the expressions run in batches of 45, each in its own temp folder and kernel
async function batch(ex, base) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'actbus-pkrun-'));
  const actionsDir = path.join(tmp, 'actions'), appDir = path.join(tmp, 'app');
  fs.cpSync(path.resolve(ROOT, 'act', 'actions'), actionsDir, { recursive: true }); fs.mkdirSync(appDir);
  const spec = JSON.parse(fs.readFileSync(path.join(actionsDir, 'registry.spec.json'), 'utf8'));
  const names = ex.map((x, i) => { const n = 'ex' + (base + i + 1); fs.writeFileSync(path.join(actionsDir, n + '.pk'), x + '\n');
    spec.actions.push({ name: n, version: '1.0.0', kind: 'script', file: n + '.pk', produces: 'computed', world: false,
      runsAs: 'u-' + users[2].uniqueId, needs: [], acceptWarnings: false, input: {}, timeoutMs: 60000 }); return n; });
  fs.writeFileSync(path.join(actionsDir, 'registry.spec.json'), JSON.stringify(spec, null, 1) + '\n');
  try { execFileSync(process.execPath, [path.resolve(ROOT, 'act', 'make-registry.js'), actionsDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { console.log('NOT APPROVED: ' + String(e.stderr || '').trim().split('\n').join(' | ')); process.exit(1); }
  for (const u of users) u.actGrants = null;
  const act = create({ prisma, productName: 'MyHost', appDir, actionsDir, log: QUIET });
  const grant = JSON.stringify({ owner: 'alex', actions: Object.fromEntries(names.map((n) => [n, {}])) });
  for (const u of users.slice(1)) { const g = await act.saveGrants(u, grant, 'alex'); if (!g.ok) { console.log('GRANT REFUSED: ' + JSON.stringify(g)); process.exit(1); } }
  for (let i = 0; i < ex.length; i++) {
    let out; const res = { status(c) { this.c = c; return this; }, json(b) { out = b; return this; }, set() {} };
    await act.route({ euser: users[1], body: { action: names[i], input: {} } }, res);
    console.log(ex[i] + '  →  ' + (out.ok ? JSON.stringify(out.value) : out.code + ': ' + out.error));
  }
  act.stop(); fs.rmSync(tmp, { recursive: true, force: true });
}
(async () => { for (let i = 0; i < EX.length; i += 45) await batch(EX.slice(i, i + 45), i); })();
