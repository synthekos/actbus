#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// trigger-off.js — v1.0.0 · the trigger kill switch: turn one trigger off on this machine · changelog: act/CHANGELOG.md#acttrigger-offjs
// (C) John Koperwas 2026 · Koperwas Systems
// the trigger KILL SWITCH (slice 3: ACTBUS docs/capability-architecture.md §7 item 3): switch one trigger off, on this box
//   cd <app folder> && node act/trigger-off.js <trigger id>
// It drops act-files/.scheduler/off/<id>; the running server switches the trigger off at its next tick (within 15 s), keeps it off
// across restarts and writes "trigger-switched-off" to logs/act.jsonl. There is no switch-on: a trigger comes back only when its
// entry in act/actions/triggers.spec.json changes and make-registry.js approves the file again.
'use strict';
const fs = require('fs'), path = require('path');
const id = process.argv[2];
if (!/^[a-z][a-z0-9-]{0,47}$/.test(id || '')) { console.error('usage: node act/trigger-off.js <trigger id>   (a-z, 0-9, -)'); process.exit(1); }
const dir = path.join(__dirname, '..', 'act-files', '.scheduler', 'off');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(dir, id), new Date().toISOString() + '\n', { mode: 0o600 });
console.log('  ✓ ' + id + ': switched off within 15 s if the server is running (check logs/act.jsonl for trigger-switched-off)');
