#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// trigger-off.js — v1.1.0 · the trigger kill switch: turn one trigger off on this machine · changelog: act/CHANGELOG.md#acttrigger-offjs
// (C) John Koperwas 2026 · Koperwas Systems
// the trigger KILL SWITCH (slice 3: ACTBUS docs/capability-architecture.md §7 item 3): switch one trigger off, on this box
//   node act/trigger-off.js <trigger id> [--app-dir <dir>]
// <dir> is the appDir the host passed to create(); without --app-dir it is the folder that holds act.js (create()'s default).
// It drops <dir>/act-files/.scheduler/off/<id>; the running server switches the trigger off at its next tick (within 15 s), keeps it
// off across restarts and writes "trigger-switched-off" to <dir>/logs/act.jsonl. There is no switch-on: a trigger comes back only when
// its entry in act/actions/triggers.spec.json changes and make-registry.js approves the file again.
// Fail closed: it writes nothing and exits 2 unless <dir>/act-files/ already exists (create() makes it), so a wrong folder is
// refused, never "switched off". It never reads the environment: a stale variable could reach another kernel on the same machine.
'use strict';
const fs = require('fs'), path = require('path');
const usage = 'usage: node act/trigger-off.js <trigger id> [--app-dir <dir>]   (id: a-z, 0-9, -; dir: the appDir given to create())';
const args = process.argv.slice(2);
const id = args[0];
let appDir = path.join(__dirname, '..');
if (args.length === 3 && args[1] === '--app-dir' && args[2]) appDir = path.resolve(args[2]);
else if (args.length !== 1) { console.error(usage); process.exit(1); }
if (!/^[a-z][a-z0-9-]{0,47}$/.test(id || '')) { console.error(usage); process.exit(1); }
const files = path.join(appDir, 'act-files');
let isDir = false; try { isDir = fs.statSync(files).isDirectory(); } catch (_) {}
if (!isDir) { console.error('  ✗ ' + id + ': nothing switched off — ' + files + ' does not exist, so no kernel has run with appDir ' + appDir + '. Pass the host\'s appDir: --app-dir <dir>'); process.exit(2); }
const dir = path.join(files, '.scheduler', 'off');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, id);
fs.writeFileSync(file, new Date().toISOString() + '\n', { mode: 0o600 });
console.log('  ✓ ' + id + ': wrote ' + file + ' — the server running with appDir ' + appDir + ' switches it off within 15 s (check ' + path.join(appDir, 'logs', 'act.jsonl') + ' for trigger-switched-off)');
