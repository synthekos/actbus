// harness.js — v1.0.0 · not a test: builds the script world that `selfreview.test.js` uses · changelog: act/CHANGELOG.md#acttestharnessjs
'use strict';
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus, ERR } = require(path.join(ROOT, 'core/bus'));
const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');   // 0.53.2: shipped built-ins only
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'pk-' + t + '-'));

const DOLLAR = `; dollar watch (ACTBUS docs/capability-architecture.md §6 test 2): if the rate fell since last time, write "hello"
(let ((rate (number (get (read-number :text (get (fetch :url "https://rates.example/usdcad") "text") :after "USD/CAD") "number"))))
  (when (and (remembered rate-before) (< rate (remembered rate-before)))
    (file-append :name "xxx.txt" :text "hello\\n"))
  (remember rate-before rate))`;
const SCRIPT = (name, file, extra = {}) => ({ name, version: '1.0.0', kind: 'script', file, produces: 'computed', world: true, runsAs: name, needs: [], input: {}, acceptWarnings: true, ...extra });

function build(scripts, { tamper } = {}) {
  const dir = tmp('act');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  const spec = [...SPEC];
  for (const [entry, src] of scripts) { fs.writeFileSync(path.join(dir, entry.file), src); spec.push(entry); }
  const actions = spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) }));
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions }));
  if (tamper) fs.appendFileSync(path.join(dir, tamper), '\n; changed after approval\n');
  return dir;
}
function world({ scripts = [[SCRIPT('dollar-watch', 'dollar-watch.pk'), DOLLAR]], strict = false, page, tamper } = {}) {
  const audit = [], pages = { 'rates.example': page || 'USD/CAD 1.3725' };
  const stateRoot = tmp('state');
  const engine = createEngine({ stateRoot, audit: (r) => audit.push(r) });
  const loaded = registry.load(build(scripts, { tamper }), 'registry.json', { scriptEngine: engine });
  const g = { fetch: { targets: ['rates.example'] }, 'read-number': {}, calc: {}, 'file-append': strict ? { strictControl: true } : {}, 'file-read': {} };
  for (const [e] of scripts) g[e.name] = {};
  const ids = caps.fromList([
    { name: 'alex', kind: 'person', owner: 'alex', actions: g },
    ...scripts.map(([e]) => ({ name: e.name, kind: 'script', owner: 'alex', actions: g })),
  ]);
  const fetch = async (url) => ({ status: 200, text: async () => pages[new URL(url).hostname] || '' });
  const filesRoot = tmp('files');
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), fetch, filesRoot, audit: (l) => audit.push(JSON.parse(l)) });
  return { bus, loaded, audit, pages, filesRoot, stateRoot, engine };
}

const reason = (loaded, name) => (loaded.refused.find((r) => r.name === name) || {}).reason || '';
module.exports = { world, SCRIPT, reason, fs, path, ERR };
