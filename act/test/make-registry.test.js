// make-registry.test.js — v1.1.0 · tests: the administrator's approval step refuses what the loader refuses, shows each script's reach and warnings, and says what each trigger will do; the bus tests' opt-out stays out of act.js and make-registry.js · changelog: act/CHANGELOG.md#acttestmake-registrytestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// make-registry.js runs on temp actions folders (copies of the shipped actions, plus the scripts each test writes), never on act/actions/.
// 1.1.0 (v0.54.2, the fourth cold read's #1): the tool calls the loader's own check (registry.check), so it refuses exactly the set
// create() refuses. The old one-script fixture called calc with no calc in its folder and had no produces/world/runsAs: a script
// the loader refuses. The fixture is now a script the loader loads.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const MR = path.join(ROOT, 'make-registry.js');
const registry = require(path.join(ROOT, 'core/registry'));
const { create } = require(path.join(ROOT, '..', 'act.js'));
const SHIPPED = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions;
const CALLER = 'u-00000000-0000-4000-8000-000000000002';
const SCRIPT = (name, extra = {}) => ({ name, version: '1.0.0', kind: 'script', file: name + '.pk', produces: 'computed', world: false, runsAs: 'svc-' + name, needs: [], input: {}, ...extra });

// a folder: the shipped actions' files and spec entries, then the given [entry, source] scripts and extra entries
function folder(scripts = [], { triggers, extra = [] } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mkreg-'));
  for (const f of new Set(SHIPPED.map((e) => e.file))) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(d, f));   // file.js serves two actions: one copy (a read-only source makes a read-only copy)
  const actions = [...SHIPPED, ...extra];
  for (const [e, src] of scripts) { fs.writeFileSync(path.join(d, e.file), src); actions.push(e); }
  fs.writeFileSync(path.join(d, 'registry.spec.json'), JSON.stringify({ actions }));
  if (triggers) fs.writeFileSync(path.join(d, 'triggers.spec.json'), JSON.stringify({ triggers }));
  return d;
}
const run = (d) => spawnSync(process.execPath, [MR, d], { encoding: 'utf8', cwd: os.tmpdir() });
const refusedLines = (r) => r.stderr.split('\n').map((l) => /^  ✗ ([a-z][a-z0-9-]*): (.*)$/.exec(l)).filter(Boolean).map((m) => m[1] + ' — ' + m[2]).sort();

// the reader's three scripts (cold read v0.3.3 #1), each approved with ✓ and exit 0 by v0.54.1's tool, each refused by its loader
const NOSUCH = [SCRIPT('t-nosuch'), '(nosuch :x 1)\n'];
const WORLD = [SCRIPT('t-world'), '(file-append :name "x.txt" :text (get (fetch :url "https://example.org/") "text"))\n'];
const WARN = [SCRIPT('t-warn', { world: true }), '(when (get (fetch :url "https://example.org/") "text") (file-append :name "x.txt" :text "hi\\n"))\n'];
const GOOD = [SCRIPT('my-script', { runsAs: CALLER }), '(calc :expr "6*7")\n'];

for (const [label, s, why] of [['an unregistered call (nosuch)', NOSUCH, /t-nosuch: script t-nosuch\.pk: no action named "nosuch"/],
  ['world: false reaching fetch and file-append', WORLD, /t-world: declares world: false but it reaches the world actions fetch, file-append/],
  ['a world action under web data, no acceptWarnings', WARN, /t-warn: needs the admin to accept \(acceptWarnings: true\): world action file-append/]]) {
  test('FAIL-FIRST approval refuses what the loader refuses: ' + label + ' — exit 1, a ✗ line with the loader\'s reason, no registry.json', () => {
    const d = folder([GOOD, s]);
    const r = run(d);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, why);
    assert.ok(!/✓ registry\.json written/.test(r.stdout), r.stdout);
    assert.ok(!fs.existsSync(path.join(d, 'registry.json')), 'no registry.json is written');
  });
}

test('FAIL-FIRST an input field named with a dash: refused at approval, and the message names the field-name rule, not the type', () => {
  const d = folder([[SCRIPT('t-dash', { input: { 'old-rate': 'string' } }), '(calc :expr (input old-rate))\n']]);
  const r = run(d);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /t-dash: registry entry "t-dash": input field old-rate: a field name must match \^\[a-z\]\[a-zA-Z0-9\]\{0,31\}\$/);
  assert.ok(!/type must be/.test(r.stderr), r.stderr);
});

test('FAIL-FIRST a script that calls a native action with runsAs is refused at load, not left loaded to fail at run', () => {
  const d = folder([[SCRIPT('wrap', { runsAs: CALLER }), '(calc :expr "6*7")\n']]);
  const spec = JSON.parse(fs.readFileSync(path.join(d, 'registry.spec.json'), 'utf8'));
  spec.actions.find((e) => e.name === 'calc').runsAs = 'svc-calc';
  fs.writeFileSync(path.join(d, 'registry.spec.json'), JSON.stringify(spec));
  pin(d);
  const r = registry.load(d, 'registry.json', { scriptEngine: engine() });
  assert.ok(!r.actions.has('calc') && !r.actions.has('wrap'), [...r.actions.keys()].join(' '));
  assert.match(reasonOf(r, 'calc'), /runsAs \(service identities\) is enabled for scripts only/);
  assert.match(reasonOf(r, 'wrap'), /no action named "calc"/);
});

// the registry.json a careful admin would write by hand from the spec: every pin taken from the file as it is now
function pin(d) {
  const spec = JSON.parse(fs.readFileSync(path.join(d, 'registry.spec.json'), 'utf8'));
  const pinned = (f) => { try { return fs.lstatSync(f).isFile() ? registry.sha256(fs.readFileSync(f)) : '0'.repeat(64); } catch { return '0'.repeat(64); } };
  const actions = spec.actions.map((e) => ({ ...e, sha256: pinned(path.join(d, e.file)) }));   // a symlink or a missing file: any pin
  fs.writeFileSync(path.join(d, 'registry.json'), JSON.stringify({ actions }));
}
const engine = () => require(path.join(ROOT, 'proteus/engine')).createEngine({ daemon: false });
const reasonOf = (r, n) => (r.refused.find((x) => x.name === n) || {}).reason || '';
function createRefused(d) {
  const lines = [], log = { log() {}, info() {}, warn() {}, error: (...a) => lines.push(a.join(' ')) };
  const users = [{ uniqueId: '00000000-0000-4000-8000-000000000001', loginId: 'alex', role: 'admin', auth: 'login', actGrants: null }];
  const prisma = { user: { findMany: async () => users.slice(), findUnique: async () => null, update: async () => null } };
  const act = create({ prisma, appDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mkreg-app-')), actionsDir: d, log, daemon: false });
  act.stop();
  return lines.map((l) => /^\[act\] action refused: (.*)$/.exec(l)).filter(Boolean).map((m) => m[1]).sort();
}

test('FAIL-FIRST the approval and create() refuse the same set, for the same reasons (one folder, ten kinds of refusal)', () => {
  const d = folder([GOOD, NOSUCH, WORLD, WARN,
    [SCRIPT('t-dash', { input: { 'old-rate': 'string' } }), '(calc :expr (input old-rate))\n'],
    [SCRIPT('t-loop-a'), '(t-loop-b)\n'], [SCRIPT('t-loop-b'), '(t-loop-a)\n'],
    [SCRIPT('t-calls-svc', { runsAs: CALLER }), '(svc :expr "1")\n'],
    [SCRIPT('t-calls-bad'), '(t-nosuch)\n']],
  { extra: [{ ...SHIPPED.find((e) => e.name === 'calc'), name: 'svc', runsAs: 'svc-calc' },
    { ...SHIPPED.find((e) => e.name === 'calc'), name: 'linked', file: 'linked.js' },
    { ...SHIPPED.find((e) => e.name === 'calc'), name: 'gone', file: 'gone.js' }] });
  fs.symlinkSync(path.join(d, 'calc.js'), path.join(d, 'linked.js'));
  const tool = run(d);
  assert.strictEqual(tool.status, 1, tool.stdout + tool.stderr);
  const fromTool = refusedLines(tool);
  pin(d);                                    // the same files, pinned as they are: the loader's view of the same folder
  const fromCreate = createRefused(d);
  assert.deepStrictEqual(fromTool, fromCreate);
  assert.deepStrictEqual(fromTool.map((l) => l.split(' — ')[0]).sort(),
    ['gone', 'linked', 'svc', 't-calls-bad', 't-calls-svc', 't-dash', 't-loop-a', 't-loop-b', 't-nosuch', 't-warn', 't-world']);
});

test('FAIL-FIRST the approval prints each script\'s reach and accepted warnings, writes registry.json, and create() then refuses nothing', () => {
  const ok = [SCRIPT('t-warn', { world: true, acceptWarnings: true }), WARN[1]];
  const d = folder([GOOD, ok]);
  const r = run(d);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^    reach: calc$/m);
  assert.match(r.stdout, /^    reach: fetch, file-append · targets name:x\.txt, url:https:\/\/example\.org\/$/m);
  assert.match(r.stdout, /^    accepted warning: world action file-append \(line 1\) runs inside a condition or loop/m);
  assert.match(r.stdout, /✓ registry\.json written \(13 actions\)/);
  assert.deepStrictEqual(createRefused(d), []);
});

test('GUARD the shipped act/actions folder is approved as it is: exit 0, nothing refused, the same 11 actions', () => {
  const d = folder();
  const r = run(d);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.strictEqual(r.stderr, '');
  assert.match(r.stdout, /✓ registry\.json written \(11 actions\)/);
  const got = JSON.parse(fs.readFileSync(path.join(d, 'registry.json'), 'utf8')).actions;
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.json'), 'utf8')).actions;
  assert.deepStrictEqual(got, shipped, 'the same entries and pins as the shipped registry.json');
});

test('FAIL-FIRST fail closed: on a refusal the registry.json already in the folder is left byte for byte as it was', () => {
  const d = folder([GOOD]);
  assert.strictEqual(run(d).status, 0);
  const before = fs.readFileSync(path.join(d, 'registry.json'));
  const spec = JSON.parse(fs.readFileSync(path.join(d, 'registry.spec.json'), 'utf8'));
  fs.writeFileSync(path.join(d, NOSUCH[0].file), NOSUCH[1]); spec.actions.push(NOSUCH[0]);
  fs.writeFileSync(path.join(d, 'registry.spec.json'), JSON.stringify(spec));
  const r = run(d);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /✗ registry\.json NOT written \(1 refused\)/);
  assert.ok(fs.readFileSync(path.join(d, 'registry.json')).equals(before));
});

// second-reader review of v0.54.2, round 1: the opt-out is for the bus's own tests; a host that passed it would reopen what check() refuses
test('GUARD the bus tests\' opt-out never reaches production: act.js and make-registry.js never name runsAsAnyKind, and each makes one registry call with exactly { scriptEngine: engine }', () => {
  for (const [f, call] of [[path.join(ROOT, '..', 'act.js'), "registry.load(actionsDir, 'registry.json', { scriptEngine: engine })"],
    [MR, 'registry.check(dir, entries, { scriptEngine: engine })']]) {
    const src = fs.readFileSync(f, 'utf8'), name = path.basename(f);
    assert.ok(!/runsAsAnyKind/i.test(src), name + ' names the bus tests\' opt-out');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');   // the call count reads code lines; the name check reads all
    assert.strictEqual((code.match(/\bregistry\s*(\.\s*|\[\s*['"`])(load|check)\b/g) || []).length, 1, name + ' makes exactly one registry load or check call');
    assert.ok(src.includes(call), name + ' passes the registry exactly { scriptEngine: engine }');
  }
});

const T = { script: 'my-script', runsAs: 'u-0002' };

test('FAIL-FIRST on-message trigger: the approval line says "on message, topic <topic>", never "undefined"', () => {
  const d = folder([GOOD], { triggers: [{ id: 'hourly', ...T, every: 3600 }, { id: 'evening', ...T, at: '18:15', tz: 'America/Toronto', days: 'mon-fri' }, { id: 'on-mail', ...T, on: 'message', topic: 'inbox' }] });
  const r = run(d);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('undefined'), r.stdout);
  assert.match(r.stdout, /✓ trigger on-mail +my-script as u-0002 · on message, topic inbox$/m);
  assert.match(r.stdout, /✓ trigger hourly +my-script as u-0002 · every 3600 s$/m);
  assert.match(r.stdout, /✓ trigger evening +my-script as u-0002 · at 18:15 America\/Toronto mon-fri$/m);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'triggers.json'), 'utf8')).triggers.length, 3);
});

test('GUARD fail closed: a trigger naming a script that is not registered stops it — exit 1, no ✓ for it, no triggers.json', () => {
  const d = folder([GOOD], { triggers: [{ id: 'hourly', ...T, script: 'no-such', every: 3600 }] });
  const r = run(d);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /✗ trigger hourly: no-such is not a registered script/);
  assert.ok(!r.stdout.includes('✓ trigger'), r.stdout);
  assert.ok(!fs.existsSync(path.join(d, 'triggers.json')));
});
