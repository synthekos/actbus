// native-host.js — v1.0.0 · a host with one native action of its own: written, registered, approved, run (docs/host.md, "A native action").
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// Run from the repository root: node examples/native-host.js
// It writes the actions folder, the audit log and the identities' files to a new temp folder, never into the repository.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const { create } = require('../act.js');

const users = [
  { uniqueId: '00000000-0000-4000-8000-000000000001', loginId: 'alex', role: 'admin', auth: 'login', actGrants: null },
  { uniqueId: '00000000-0000-4000-8000-000000000002', loginId: 'counter', role: 'euser', auth: 'key', actGrants: null },
];
const prisma = { user: {
  findMany: async () => users.slice(),
  findUnique: async ({ where }) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null,
  update: async ({ where, data }) => Object.assign(users.find((u) => u.uniqueId === where.uniqueId), data),
} };

// 1. The action file and its registry entry, in a copy of act/actions/ (never in act/actions/ itself).
const GREET = `// greet.js — v1.0.0 · a native action: a greeting for a name; it reaches nothing outside the kernel
'use strict';
exports.run = async (input, ctx) => {
  const name = input.name.trim();
  if (!name) throw new Error('name is empty');
  return { text: 'hello, ' + name, for: ctx.identity };
};
`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'actbus-native-'));
const actionsDir = path.join(tmp, 'actions'), appDir = path.join(tmp, 'app');
fs.cpSync(path.join(__dirname, '..', 'act', 'actions'), actionsDir, { recursive: true });
fs.mkdirSync(appDir);
fs.writeFileSync(path.join(actionsDir, 'greet.js'), GREET);
const spec = JSON.parse(fs.readFileSync(path.join(actionsDir, 'registry.spec.json'), 'utf8'));
spec.actions.push({ name: 'greet', version: '1.0.0', kind: 'native', file: 'greet.js', produces: 'computed',
  world: false, needs: [], input: { name: 'string' }, timeoutMs: 2000 });
fs.writeFileSync(path.join(actionsDir, 'registry.spec.json'), JSON.stringify(spec, null, 1) + '\n');

// 2. The approval: make-registry.js checks every entry as the loader will and pins every file's sha256 into registry.json.
const approved = execFileSync(process.execPath, [path.join(__dirname, '..', 'act', 'make-registry.js'), actionsDir], { encoding: 'utf8' });
console.log('approved: ' + approved.split('\n').find((l) => /✓ greet /.test(l)).trim().replace(/\s+/g, ' '));

// 3. The kernel, a grant of greet, and three calls: it runs; it throws; its input is refused before it runs.
const act = create({ prisma, productName: 'MyHost', appDir, actionsDir });
const reply = (what) => ({ status(c) { this.code = c; return this; }, json(b) { console.log(what + ' → HTTP ' + this.code + ' ' + JSON.stringify(b)); return this; }, set() {} });
(async () => {
  const counter = users[1];
  await act.saveGrants(counter, JSON.stringify({ owner: 'alex', actions: { greet: {} } }), 'alex');
  await act.route({ euser: counter, body: { action: 'greet', input: { name: ' Ada ' } } }, reply('name " Ada "'));
  await act.route({ euser: counter, body: { action: 'greet', input: { name: ' ' } } }, reply('name " "'));
  await act.route({ euser: counter, body: { action: 'greet', input: { name: 7 } } }, reply('name 7'));
  console.log('audit log: ' + act.LOG);
  act.stop();
})();
