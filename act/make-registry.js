#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// make-registry.js — v1.2.0 · the administrator's approval step: the loader's own check, then pin action files by their sha256 · changelog: act/CHANGELOG.md#actmake-registryjs
// (C) John Koperwas 2026
// the ADMIN's approval step: check every action as the loader will, then pin every action file by its sha256
//   node make-registry.js <actions folder>        reads registry.spec.json there, writes registry.json next to it
// The spec is registry.json without the sha256 fields. Running this IS the approval: from then on the loader refuses
// any action file whose bytes differ from what was approved. Re-run it (and review the diff) after changing a file.
// 1.2.0 (v0.54.2): the spec, with each file's sha256, goes through the loader's own check (core/registry.js check(), with the
// script engine act.js uses): every action it refuses is printed with the loader's reason, and then NOTHING is written — exit 1,
// and a registry.json already there is left as it was. For each script it prints what the admin approves: the actions it can
// reach, the targets written in its source, and every warning its acceptWarnings accepts.
// Approval runs each action file's top-level code, exactly as the server does at start: run make-registry.js as the user the server
// runs as, not as yourself.
'use strict';
const fs = require('fs'), path = require('path');
const registry = require('./core/registry');
const { createEngine } = require('./proteus/engine');
const { validate } = require('./scheduler');

const dir = process.argv[2];
if (!dir) { console.error('usage: node make-registry.js <actions folder>'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(path.join(dir, 'registry.spec.json'), 'utf8'));
if (!spec || !Array.isArray(spec.actions)) { console.error('  ✗ registry.spec.json must be { "actions": [ … ] }'); process.exit(1); }
// each entry's pin is its file's sha256 as it is now. An entry whose file is not a plain file it can read gets the pin 0…0 (64 zeros),
// and the check then refuses it for the loader's own reason (a symlink, a missing file) before any pin is compared. An entry that
// is not an object goes through as it is, and the check refuses it.
const NOPIN = '0'.repeat(64);
const pinOf = (e) => {
  if (typeof e.file !== 'string') return NOPIN;
  const file = path.join(dir, e.file);
  try { return fs.lstatSync(file).isFile() ? registry.sha256(fs.readFileSync(file)) : NOPIN; } catch { return NOPIN; }
};
const entries = spec.actions.map((e) => (e && typeof e === 'object' && !Array.isArray(e) ? { ...e, sha256: pinOf(e) } : e));
// the script engine act.js builds (createEngine): its prepare and warnings, which the check uses, read no option; no daemon here
const engine = createEngine({ daemon: false });
const checked = registry.check(dir, entries, { scriptEngine: engine });
engine.close();
const shown = new Set();
for (const e of entries) {
  if (!e || !checked.actions.has(e.name) || shown.has(e.name)) continue;
  shown.add(e.name);
  console.log('  ✓ ' + e.name.padEnd(12) + ' ' + e.version.padEnd(7) + ' ' + e.file.padEnd(14) + ' ' + e.sha256.slice(0, 12));
  if (!checked.reach.has(e.name)) continue;
  const r = checked.reach.get(e.name);
  console.log('    reach: ' + (r.actions.join(', ') || 'nothing') + (r.targets.length ? ' · targets ' + r.targets.join(', ') : ''));
  for (const w of checked.warnings.get(e.name)) console.log('    accepted warning: ' + w);
}
if (checked.refused.length) {
  for (const r of checked.refused) console.error('  ✗ ' + r.name + ': ' + r.reason);
  console.error('  ✗ registry.json NOT written (' + checked.refused.length + ' refused) — the loader would refuse ' + (checked.refused.length > 1 ? 'these' : 'this') + ' at start');
  process.exit(1);
}
const out = { approved: new Date().toISOString(), actions: entries };
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(out, null, 1) + '\n');
console.log('  ✓ registry.json written (' + out.actions.length + ' actions)');
// 1.1.0: triggers (slice 3: ACTBUS docs/capability-architecture.md §7 item 3) — the server reads ONLY triggers.json; no spec = no triggers.json = nothing is scheduled
const tspec = path.join(dir, 'triggers.spec.json'), tout = path.join(dir, 'triggers.json');
if (fs.existsSync(tspec)) {
  if (fs.lstatSync(tspec).isSymbolicLink()) { console.error('  ✗ triggers.spec.json is a symlink — refused'); process.exit(1); }
  const list = JSON.parse(fs.readFileSync(tspec, 'utf8')).triggers;
  const v = validate(list);
  const scripts = new Set(out.actions.filter((e) => e.kind === 'script').map((e) => e.name));
  for (const t of v.ok) if (!scripts.has(t.script)) v.refused.push({ id: t.id, reason: t.script + ' is not a registered script' });
  if (v.refused.length) { for (const r of v.refused) console.error('  ✗ trigger ' + r.id + ': ' + r.reason); console.error('  ✗ triggers.json NOT written (registry.json was)'); process.exit(1); }
  fs.writeFileSync(tout, JSON.stringify({ approved: out.approved, triggers: list }, null, 1) + '\n');
  for (const t of list) console.log('  ✓ trigger ' + t.id.padEnd(16) + ' ' + t.script + ' as ' + t.runsAs + ' · ' + (t.on ? 'on message, topic ' + t.topic : t.every ? 'every ' + t.every + ' s' : 'at ' + t.at + ' ' + t.tz + (t.days ? ' ' + t.days : '')));   // 1.1.1: on-message
  console.log('  ✓ triggers.json written (' + list.length + ' triggers)');
} else if (fs.existsSync(tout)) console.log('  · no triggers.spec.json — the existing triggers.json is left as it is (delete it to stop all triggers)');
