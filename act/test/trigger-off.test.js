// trigger-off.test.js — v1.0.0 · tests: the trigger kill switch reaches the host's appDir and never reports a switch-off it did not make · changelog: act/CHANGELOG.md#acttesttrigger-offtestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// The script runs from a temp copy of the kernel (act.js + act/), so nothing is written next to this repository's act.js. The end-to-end
// test checks what matters to a host: after the switch, the trigger does not fire. A ✓ that changed nothing fails it.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const { create } = require(path.join(ROOT, 'act.js'));
const quiet = { error() {}, log() {} };
const prisma = { user: { findMany: async () => [], findUnique: async () => null, update: async () => null } };

function kernelCopy() {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-k-'));
  fs.copyFileSync(path.join(ROOT, 'act.js'), path.join(k, 'act.js'));
  fs.cpSync(path.join(ROOT, 'act'), path.join(k, 'act'), { recursive: true, filter: (s) => !s.includes(path.sep + 'act-files') });
  return k;
}
const run = (k, args) => spawnSync(process.execPath, [path.join(k, 'act', 'trigger-off.js'), ...args], { encoding: 'utf8', cwd: os.tmpdir() });

test('FAIL-FIRST end to end: with --app-dir, a host that passes its own appDir gets the trigger switched off — it does not fire', async () => {
  const k = kernelCopy(), app = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-app-'));
  fs.writeFileSync(path.join(app, 'triggers.json'), JSON.stringify({ triggers: [{ id: 't-one', script: 'nope', runsAs: 'nobody-x', every: 60 }] }));
  let now = Date.parse('2026-11-10T12:00:00Z');
  const act = create({ prisma, appDir: app, triggersFile: path.join(app, 'triggers.json'), clock: () => now, daemon: false, log: quiet });
  try {
    assert.deepStrictEqual(await act.schedTick(), []);                                   // not due yet
    const r = run(k, ['t-one', '--app-dir', app]);
    assert.strictEqual(r.status, 0, r.stderr);
    now += 61000;                                                                        // now due: it fires unless it was switched off
    const fired = await act.schedTick();
    assert.deepStrictEqual(fired, [], 'the trigger still fired after the kill switch said ✓');
    assert.strictEqual(act.scheduler.status()[0].on, false);
    const log = fs.readFileSync(act.LOG, 'utf8');
    assert.ok(/"outcome":"trigger-switched-off"/.test(log), 'no trigger-switched-off line in the host\'s audit log');
    assert.ok(!fs.existsSync(path.join(k, 'act-files')), 'the script wrote beside act.js instead of into the host\'s appDir');
  } finally { act.stop(); }
});

test('FAIL-FIRST fail closed: a folder where no kernel has run is refused — exit 2, no ✓, nothing written anywhere', () => {
  const k = kernelCopy(), empty = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-none-'));
  const r = run(k, ['t-one', '--app-dir', empty]);
  assert.strictEqual(r.status, 2, 'exit ' + r.status + ': ' + r.stdout + r.stderr);
  assert.ok(!r.stdout.includes('✓'), 'it printed ✓: ' + r.stdout);
  assert.deepStrictEqual(fs.readdirSync(empty), [], 'it wrote into the folder it should have refused');
  assert.ok(!fs.existsSync(path.join(k, 'act-files')), 'it wrote beside act.js');
});

test('GUARD default unchanged: with no --app-dir it writes into the folder that holds act.js (create()\'s default appDir)', () => {
  const k = kernelCopy();
  fs.mkdirSync(path.join(k, 'act-files'), { mode: 0o700 });                              // what create() makes on first start
  const r = run(k, ['t-one']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(k, 'act-files', '.scheduler', 'off', 't-one')));
  assert.ok(r.stdout.includes('✓'));
});
