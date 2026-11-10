// minimal-host.js — v1.0.0 · the smallest host: one person, one EUser (machine) granted `calc`, one request through the kernel.
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// Run from the repository root: node examples/minimal-host.js
// It writes the audit log and the identities' files to a new temp folder (appDir), never into the repository.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { create } = require('../act.js');

// The host's user records. The kernel reads them through three calls of a Prisma-style handle; any store will do.
// An EUser (role 'euser') is a machine identity: its actions are in actGrants. A person (here an admin) owns it.
const users = [
  { uniqueId: '00000000-0000-4000-8000-000000000001', loginId: 'alex', role: 'admin', auth: 'login', actGrants: null },
  { uniqueId: '00000000-0000-4000-8000-000000000002', loginId: 'counter', role: 'euser', auth: 'key', actGrants: null },
];
const prisma = { user: {
  findMany: async () => users.slice(),
  findUnique: async ({ where }) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null,
  update: async ({ where, data }) => Object.assign(users.find((u) => u.uniqueId === where.uniqueId), data),
} };

const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'actbus-host-'));
const act = create({ prisma, productName: 'MyHost', appDir });

// The answer the kernel gives through act.route, an Express-style (req, res) handler: req.euser is the
// already-authenticated EUser record, req.body is { action, input, id? }.
const reply = () => ({ status(c) { this.code = c; return this; }, json(b) { console.log('HTTP ' + this.code + ' ' + JSON.stringify(b)); return this; }, set() {} });

(async () => {
  const counter = users[1];
  await act.route({ euser: counter, body: { action: 'calc', input: { expr: '6*7' } } }, reply());   // refused: nothing granted yet
  // An administrator grants an action: owner = the accountable person's login, actions = { name: options }.
  const g = await act.saveGrants(counter, JSON.stringify({ owner: 'alex', actions: { calc: {} } }), 'alex');
  console.log('grant saved: ' + g.ok);
  await act.route({ euser: counter, body: { action: 'calc', input: { expr: '6*7' } } }, reply());   // runs, and is audited first
  console.log('audit log: ' + act.LOG);
  act.stop();
})();
