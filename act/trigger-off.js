#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// trigger-off.js — v1.2.0 · the trigger kill switch: turn one trigger off on this machine · changelog: act/CHANGELOG.md#acttrigger-offjs
// (C) John Koperwas 2026
// the trigger KILL SWITCH (slice 3: ACTBUS docs/capability-architecture.md §7 item 3): switch one trigger off, on this box
//   node act/trigger-off.js <trigger id> [--app-dir <dir>]
// <dir> is the appDir the host passed to create(); without --app-dir it is the folder that holds act.js (create()'s default).
// It reads the kernel's own state, <dir>/act-files/.scheduler/scheduler.json, where the scheduler writes the trigger ids it loaded at
// every start (scheduler.js 1.3.0), and writes <dir>/act-files/.scheduler/off/<id> only for one of those ids. The scheduler applies the
// file at its next tick, audits "trigger-switched-off" in <dir>/logs/act.jsonl, and keeps the trigger off across restarts. There is no
// switch-on: a trigger comes back only when its entry in triggers.spec.json changes and make-registry.js approves the file again.
// Fail closed — it writes nothing and exits 2 when:
//   · <dir>/act-files/ does not exist (create() makes it): no kernel has run with that appDir;
//   · the state file is absent, unreadable or has no list of loaded ids: no scheduler has started there (no triggers file), or it
//     was started by a kernel before 1.3.0 of scheduler.js (restart it);
//   · the id is not in the list: a mistyped id, or a trigger refused at start. The message lists the ids that are loaded.
// The list is the one written at the scheduler's last start; the script cannot tell whether that kernel is running now.
// It never reads the environment: a stale variable could reach another kernel on the same machine.
'use strict';
const fs = require('fs'), path = require('path');
const usage = 'usage: node act/trigger-off.js <trigger id> [--app-dir <dir>]   (id: a-z, 0-9, -; dir: the appDir given to create())';
const args = process.argv.slice(2);
const id = args[0];
let appDir = path.join(__dirname, '..');
if (args.length === 3 && args[1] === '--app-dir' && args[2]) appDir = path.resolve(args[2]);
else if (args.length !== 1) { console.error(usage); process.exit(1); }
if (!/^[a-z][a-z0-9-]{0,47}$/.test(id || '')) { console.error(usage); process.exit(1); }
const refuse = (why) => { console.error('  ✗ ' + id + ': nothing switched off — ' + why); process.exit(2); };
const files = path.join(appDir, 'act-files');
let isDir = false; try { isDir = fs.statSync(files).isDirectory(); } catch (_) {}
if (!isDir) refuse(files + ' does not exist, so no kernel has run with appDir ' + appDir + '. Pass the host\'s appDir: --app-dir <dir>');
const stateFile = path.join(files, '.scheduler', 'scheduler.json');
let loaded = null;
try { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (s && s.loaded && Array.isArray(s.loaded.ids)) loaded = s.loaded; } catch (_) {}
if (!loaded) refuse((fs.existsSync(stateFile) ? stateFile + ' has no list of loaded triggers (a scheduler before scheduler.js 1.3.0 wrote it — restart the kernel)'
  : 'there is no ' + stateFile + ', so no scheduler has started with appDir ' + appDir + ' (it starts only when there is a triggers file)'));
if (!loaded.ids.includes(id)) refuse('the scheduler that started at ' + loaded.at + ' did not load a trigger "' + id + '". Loaded: ' + (loaded.ids.length ? loaded.ids.join(', ') : '(none)'));
const dir = path.join(files, '.scheduler', 'off');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = path.join(dir, id);
fs.writeFileSync(file, new Date().toISOString() + '\n', { mode: 0o600 });
console.log('  ✓ wrote the off-file for ' + id + '; the scheduler applies it at its next tick, audited as trigger-switched-off');
console.log('    file: ' + file + ' · audit log: ' + path.join(appDir, 'logs', 'act.jsonl') + ' · the list it was checked against: the scheduler start at ' + loaded.at);
