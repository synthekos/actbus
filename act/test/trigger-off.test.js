// trigger-off.test.js — v1.1.0 · tests: the trigger kill switch reaches the host's appDir and switches off only a trigger the scheduler loaded · changelog: act/CHANGELOG.md#acttesttrigger-offtestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// The script runs from a temp copy of the kernel (act.js + act/), so nothing is written next to this repository's act.js. The end-to-end
// test checks what matters to a host: after the switch, the trigger does not fire, and the audit says so. Every refusal the script's
// header names has its own test here (failure path): no act-files/, no state, an unreadable state, a state with no list, an id the
// scheduler did not load (mistyped, or refused at start). Each refusal must exit 2, print no ✓ and write nothing.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const { create } = require(path.join(ROOT, 'act.js'));
const quiet = { error() {}, log() {} };
const prisma = { user: { findMany: async () => [], findUnique: async () => null, update: async () => null } };
const OK = '✓ wrote the off-file for t-one; the scheduler applies it at its next tick, audited as trigger-switched-off';

function kernelCopy() {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-k-'));
  fs.copyFileSync(path.join(ROOT, 'act.js'), path.join(k, 'act.js'));
  fs.cpSync(path.join(ROOT, 'act'), path.join(k, 'act'), { recursive: true, filter: (s) => !s.includes(path.sep + 'act-files') });
  return k;
}
const run = (k, args, env = {}) => spawnSync(process.execPath, [path.join(k, 'act', 'trigger-off.js'), ...args], { encoding: 'utf8', cwd: os.tmpdir(), env: { ...process.env, ...env } });
// a host with a running kernel: one time trigger t-one, and one entry the scheduler refuses at start (every < 60 s)
function host() {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-app-'));
  fs.writeFileSync(path.join(app, 'triggers.json'), JSON.stringify({ triggers: [{ id: 't-one', script: 'nope', runsAs: 'nobody-x', every: 60 },
    { id: 't-bad', script: 'nope', runsAs: 'nobody-x', every: 30 }] }));
  const c = { now: Date.parse('2026-11-10T12:00:00Z') };
  const act = create({ prisma, appDir: app, triggersFile: path.join(app, 'triggers.json'), clock: () => c.now, daemon: false, log: quiet });
  return { app, c, act };
}
const audit = (act) => fs.readFileSync(act.LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).outcome);
function refused(r, where, msg) {
  assert.strictEqual(r.status, 2, 'exit ' + r.status + ': ' + r.stdout + r.stderr);
  assert.ok(!r.stdout.includes('✓') && !r.stderr.includes('✓'), 'it printed ✓: ' + r.stdout);
  assert.match(r.stderr, msg);
  assert.ok(!fs.existsSync(path.join(where, 'act-files', '.scheduler', 'off')), 'it wrote an off-file');
}

test('FAIL-FIRST end to end: with --app-dir, a loaded trigger is switched off — it does not fire, and the audit says trigger-switched-off', async () => {
  const k = kernelCopy(), { app, c, act } = host();
  try {
    assert.deepStrictEqual(await act.schedTick(), []);                                   // not due yet
    const r = run(k, ['t-one', '--app-dir', app]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(OK), 'the ✓ line does not say what the kernel will do: ' + r.stdout);
    c.now += 61000;                                                                      // now due: it fires unless it was switched off
    assert.deepStrictEqual(await act.schedTick(), [], 'the trigger still fired after the kill switch said ✓');
    assert.strictEqual(act.scheduler.status().find((t) => t.id === 't-one').on, false);
    const log = audit(act);
    assert.ok(log.includes('trigger-switched-off'), 'no trigger-switched-off line in the host\'s audit log: ' + log);
    assert.ok(!log.includes('trigger-off-unknown'), 'the kernel did not know the id the script accepted');
    assert.ok(!fs.existsSync(path.join(k, 'act-files')), 'the script wrote beside act.js instead of into the host\'s appDir');
  } finally { act.stop(); }
});

test('FAIL-FIRST unknown id: a mistyped id, or one the scheduler refused at start, is refused — exit 2, no ✓, no off-file, the trigger still fires', async () => {
  const k = kernelCopy(), { app, c, act } = host();
  try {
    refused(run(k, ['t-onee', '--app-dir', app]), app, /did not load a trigger "t-onee"\. Loaded: t-one$/m);
    refused(run(k, ['t-bad', '--app-dir', app]), app, /did not load a trigger "t-bad"/);
    c.now += 61000;
    assert.strictEqual((await act.schedTick()).length, 1, 't-one was not switched off, so it fires');
    assert.ok(!audit(act).includes('trigger-off-unknown'), 'an off-file reached the kernel');
  } finally { act.stop(); }
});

test('FAIL-FIRST no state: act-files/ exists but no scheduler has started there (no triggers file) — refused, nothing written', () => {
  const k = kernelCopy(), app = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-app-'));
  const act = create({ prisma, appDir: app, daemon: false, log: quiet });               // makes act-files/, no scheduler
  try {
    assert.ok(fs.existsSync(path.join(app, 'act-files')));
    refused(run(k, ['t-one', '--app-dir', app]), app, /there is no .*scheduler\.json, so no scheduler has started/);
  } finally { act.stop(); }
});

test('FAIL-FIRST unusable state: an unreadable state file, or one with no list of loaded ids (a scheduler before 1.3.0), is refused', () => {
  const k = kernelCopy();
  for (const [body, msg] of [['{ not json', /no list of loaded triggers/], [JSON.stringify({ v: 1, last: {}, off: {}, first: {} }), /no list of loaded triggers/],
    [JSON.stringify({ v: 1, last: {}, off: {}, loaded: { at: 'x', ids: 't-one' } }), /no list of loaded triggers/]]) {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-app-'));
    fs.mkdirSync(path.join(app, 'act-files', '.scheduler'), { recursive: true });
    fs.writeFileSync(path.join(app, 'act-files', '.scheduler', 'scheduler.json'), body);
    refused(run(k, ['t-one', '--app-dir', app]), app, msg);
  }
});

test('FAIL-FIRST fail closed: a folder where no kernel has run is refused — exit 2, no ✓, nothing written anywhere', () => {
  const k = kernelCopy(), empty = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-none-'));
  const r = run(k, ['t-one', '--app-dir', empty]);
  assert.strictEqual(r.status, 2, 'exit ' + r.status + ': ' + r.stdout + r.stderr);
  assert.ok(!r.stdout.includes('✓'), 'it printed ✓: ' + r.stdout);
  assert.deepStrictEqual(fs.readdirSync(empty), [], 'it wrote into the folder it should have refused');
  assert.ok(!fs.existsSync(path.join(k, 'act-files')), 'it wrote beside act.js');
});

test('GUARD default unchanged: with no --app-dir it reads and writes in the folder that holds act.js (create()\'s default appDir)', () => {
  const k = kernelCopy();
  fs.mkdirSync(path.join(k, 'act-files', '.scheduler'), { recursive: true, mode: 0o700 });   // what create() and the scheduler make on first start
  fs.writeFileSync(path.join(k, 'act-files', '.scheduler', 'scheduler.json'), JSON.stringify({ v: 1, last: {}, off: {}, first: {}, loaded: { at: '2026-11-10T12:00:00.000Z', ids: ['t-one'] } }));
  const r = run(k, ['t-one']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(k, 'act-files', '.scheduler', 'off', 't-one')));
  assert.ok(r.stdout.includes('✓'));
});

test('GUARD no environment: ACT_APP_DIR and APP_DIR pointing at another kernel are ignored — without --app-dir it is the default folder', () => {
  const k = kernelCopy(), other = fs.mkdtempSync(path.join(os.tmpdir(), 'trigoff-other-'));
  fs.mkdirSync(path.join(other, 'act-files', '.scheduler'), { recursive: true });
  fs.writeFileSync(path.join(other, 'act-files', '.scheduler', 'scheduler.json'), JSON.stringify({ v: 1, last: {}, off: {}, loaded: { at: 'x', ids: ['t-one'] } }));
  const r = run(k, ['t-one'], { ACT_APP_DIR: other, APP_DIR: other });
  assert.strictEqual(r.status, 2, 'the default folder has no act-files/, so it must refuse: ' + r.stdout);
  assert.ok(!fs.existsSync(path.join(other, 'act-files', '.scheduler', 'off')), 'it followed the environment to another kernel');
});
