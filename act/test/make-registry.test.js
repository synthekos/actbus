// make-registry.test.js — v1.0.0 · tests: the administrator's approval step says what each trigger will do, and refuses a bad one · changelog: act/CHANGELOG.md#acttestmake-registrytestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// make-registry.js runs on a temp actions folder (one script file, three triggers: every, at, on message), never on act/actions/.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const MR = path.join(__dirname, '..', 'make-registry.js');
function folder(triggers) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mkreg-'));
  fs.writeFileSync(path.join(d, 'my-script.pk'), '(calc "6*7")\n');
  fs.writeFileSync(path.join(d, 'registry.spec.json'), JSON.stringify({ actions: [{ name: 'my-script', version: '1.0.0', kind: 'script', file: 'my-script.pk' }] }));
  fs.writeFileSync(path.join(d, 'triggers.spec.json'), JSON.stringify({ triggers }));
  return d;
}
const run = (d) => spawnSync(process.execPath, [MR, d], { encoding: 'utf8', cwd: os.tmpdir() });
const T = { script: 'my-script', runsAs: 'u-0002' };

test('FAIL-FIRST on-message trigger: the approval line says "on message, topic <topic>", never "undefined"', () => {
  const d = folder([{ id: 'hourly', ...T, every: 3600 }, { id: 'evening', ...T, at: '18:15', tz: 'America/Toronto', days: 'mon-fri' }, { id: 'on-mail', ...T, on: 'message', topic: 'inbox' }]);
  const r = run(d);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('undefined'), r.stdout);
  assert.match(r.stdout, /✓ trigger on-mail +my-script as u-0002 · on message, topic inbox$/m);
  assert.match(r.stdout, /✓ trigger hourly +my-script as u-0002 · every 3600 s$/m);
  assert.match(r.stdout, /✓ trigger evening +my-script as u-0002 · at 18:15 America\/Toronto mon-fri$/m);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'triggers.json'), 'utf8')).triggers.length, 3);
});

test('GUARD fail closed: a trigger naming a script that is not registered stops it — exit 1, no ✓ for it, no triggers.json', () => {
  const d = folder([{ id: 'hourly', ...T, script: 'no-such', every: 3600 }]);
  const r = run(d);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /✗ trigger hourly: no-such is not a registered script/);
  assert.ok(!r.stdout.includes('✓ trigger'), r.stdout);
  assert.ok(!fs.existsSync(path.join(d, 'triggers.json')));
});
