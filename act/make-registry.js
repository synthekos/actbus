#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// make-registry.js — v1.1.0 · the administrator's approval step: pin action files by their sha256 · changelog: act/CHANGELOG.md#actmake-registryjs
// (C) John Koperwas 2026 · Koperwas Systems
// the ADMIN's approval step: pin every action file by its sha256
//   node make-registry.js <actions folder>        reads registry.spec.json there, writes registry.json next to it
// The spec is registry.json without the sha256 fields. Running this IS the approval: from then on the loader refuses
// any action file whose bytes differ from what was approved. Re-run it (and review the diff) after changing a file.
'use strict';
const fs = require('fs'), path = require('path');
const { sha256 } = require('./core/registry');
const { validate } = require('./scheduler');

const dir = process.argv[2];
if (!dir) { console.error('usage: node make-registry.js <actions folder>'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(path.join(dir, 'registry.spec.json'), 'utf8'));
const out = { approved: new Date().toISOString(), actions: [] };
for (const e of spec.actions) {
  const file = path.join(dir, e.file);
  if (fs.lstatSync(file).isSymbolicLink()) { console.error('  ✗ ' + e.file + ' is a symlink — refused'); process.exit(1); }
  const h = sha256(fs.readFileSync(file));
  out.actions.push({ ...e, sha256: h });
  console.log('  ✓ ' + e.name.padEnd(12) + ' ' + e.version.padEnd(7) + ' ' + e.file.padEnd(14) + ' ' + h.slice(0, 12));
}
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
  for (const t of list) console.log('  ✓ trigger ' + t.id.padEnd(16) + ' ' + t.script + ' as ' + t.runsAs + ' · ' + (t.every ? 'every ' + t.every + ' s' : 'at ' + t.at + ' ' + t.tz + (t.days ? ' ' + t.days : '')));
  console.log('  ✓ triggers.json written (' + list.length + ' triggers)');
} else if (fs.existsSync(tout)) console.log('  · no triggers.spec.json — the existing triggers.json is left as it is (delete it to stop all triggers)');
