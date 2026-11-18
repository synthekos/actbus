// daemon-message.test.js — v1.0.0 · tests: a malformed label list from a script daemon is refused, not mapped to [] (C1) · changelog: act/CHANGELOG.md#acttestdaemon-messagetestjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// Tests marked FAIL-FIRST fail on ACTBUS v0.3.8 (supervisor.js 1.1.2): there a label list that was not a list, or held an unknown
// label, became [] (or was filtered) and the message went on. Tests marked GUARD hold on both.
// Each test drives the REAL supervisor, engine and bus with a stand-in daemon: a small child process that sends one message of the
// kind under test. For each refusal it checks that nothing ran, that the audit has a daemon-malformed line, and that no label the run
// had was lost from the reply. Run from anywhere: node --test act/test/daemon-message.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');   // the kernel's act/, found from this file's own location
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
const { Supervisor } = require(path.join(ROOT, 'daemon/supervisor'));
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'dmsg-' + t + '-'));

// A stand-in daemon. `onRun` is the body of a function (m, send) run on each 'run' message; `onReply` (optional) the body of a
// function (m, send, rid) run on each 'reply'. The source the real daemon would run is the script below, which is never run here.
function standIn(onRun, onReply = '') {
  const fdir = tmp('fake'), fake = path.join(fdir, 'fake.js');
  fs.writeFileSync(fake, `let rid;
  const send = (x) => process.send(x);
  process.on('message', (m) => {
    if (m.t === 'run') { rid = m.runId; (function (m, send) { ${onRun} })(m, send); }
    else if (m.t === 'reply') { (function (m, send, rid) { ${onReply} })(m, send, rid); }
  });
  process.send({ t: 'ready', pid: process.pid, permission: !!process.permission });`);
  return { daemonPath: fake, allowRead: fdir };
}

function world(daemon) {
  const dir = tmp('act'), box = tmp('box');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 's.pk'), '(do (remember k "v") (get (calc :expr "1") "result"))');
  const spec = [...SPEC, { name: 's', version: '1.0.0', kind: 'script', file: 's.pk', produces: 'computed', world: false, runsAs: 's', needs: [], input: {}, acceptWarnings: true }];
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  const audit = [];
  const sup = new Supervisor({ audit: (r) => audit.push(r), ...daemon });
  const engine = createEngine({ stateRoot: box, audit: (r) => audit.push(r), daemon: sup });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: { s: {}, calc: {} } },
    { name: 's', kind: 'script', owner: 'alex', actions: { s: {}, calc: {} } }]);
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), fetch: async () => ({ status: 404, text: async () => '' }), filesRoot: box, audit: (l) => audit.push(JSON.parse(l)) });
  const ask = () => bus.ask('alex', 's', {}, { labels: ['web'] });   // the caller's input carries web: no reply may lose it
  const calcRan = () => audit.some((r) => r.action === 'calc' && r.from === 's' && r.outcome === 'ok');
  const malformed = (t, field) => audit.some((r) => r.kind === 'daemon-malformed' && r.identity === 's' && r.t === t && r.why === field + ' is not a list of known labels');
  const stateWritten = () => fs.existsSync(path.join(box, '.pk-state', 's-s', 'state.json'));
  return { bus, audit, box, engine, ask, calcRan, malformed, stateWritten };
}
async function inWorld(daemon, fn) { const w = world(daemon); try { await fn(w); } finally { w.engine.close(); } }

// --- the call site (supervisor.js 1.1.2 line 120): labels and ctl ---------------------------------------------------------------
const CALL = (labels, ctl) => standIn(
  `send({ t: 'call', runId: m.runId, callId: 1, action: 'calc', input: { expr: '1' }${labels === undefined ? '' : ', labels: ' + JSON.stringify(labels)}${ctl === undefined ? '' : ', ctl: ' + JSON.stringify(ctl)} });`,
  `send({ t: 'done', runId: rid, ok: true, value: String(m.reply.code || m.reply.ok), labels: [], seen: [] });`);

for (const [what, labels, ctl, field] of [
  ['labels that are not a list', 'web', [], 'labels'],
  ['labels holding a label that is not known', ['Web'], [], 'labels'],
  ['no labels at all', undefined, [], 'labels'],
  ['ctl that is not a list', [], 'model', 'ctl'],
  ['no ctl at all', [], undefined, 'ctl'],
]) {
  test('FAIL-FIRST a call with ' + what + ' is refused BAD_MESSAGE: nothing runs, the audit says so, the run goes on', async () => {
    await inWorld(CALL(labels, ctl), async (w) => {
      const r = await w.ask();
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.value, 'BAD_MESSAGE', 'the daemon was answered BAD_MESSAGE: ' + JSON.stringify(r));
      assert.equal(w.calcRan(), false, 'calc did not run');
      assert.ok(w.malformed('call', field), 'audited daemon-malformed call ' + field);
      assert.ok(r.labels.includes('web'), 'the input label web is not lost: ' + JSON.stringify(r.labels));
    });
  });
}

test('GUARD a well-formed call runs, and the run carries its reply', async () => {
  await inWorld(CALL(['web'], []), async (w) => {
    const r = await w.ask();
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, 'true');
    assert.equal(w.calcRan(), true, 'calc ran');
    assert.equal(w.audit.some((x) => x.kind === 'daemon-malformed'), false);
    assert.ok(r.labels.includes('web') && r.labels.includes('computed'), JSON.stringify(r.labels));
  });
});

// --- the state-set site (line 124) ----------------------------------------------------------------------------------------------
const STATE = (labels) => standIn(
  `send({ t: 'state-set', runId: m.runId, key: 'k', value: 'v'${labels === undefined ? '' : ', labels: ' + JSON.stringify(labels)} });
   send({ t: 'done', runId: m.runId, ok: true, value: 'x', labels: [], seen: [] });`);

for (const [what, labels] of [['labels that are not a list', 'web'], ['a label that is not known', ['WEB']], ['no labels at all', undefined]]) {
  test('FAIL-FIRST a state-set with ' + what + ' fails the run: nothing is written, the audit says so', async () => {
    await inWorld(STATE(labels), async (w) => {
      const r = await w.ask();
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.match(r.error, /BAD_MESSAGE/);
      assert.equal(w.stateWritten(), false, 'no state was written');
      assert.ok(w.malformed('state-set', 'labels'));
      assert.ok(r.labels.includes('web'), 'the input label web is not lost: ' + JSON.stringify(r.labels));
    });
  });
}

test('GUARD a well-formed state-set is written', async () => {
  await inWorld(STATE(['web']), async (w) => {
    const r = await w.ask();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(w.stateWritten(), true);
  });
});

// --- the end of a run: done ok (line 127) and done failed (line 129) -----------------------------------------------------------
const DONE = (fields) => standIn(`send(Object.assign({ t: 'done', runId: m.runId }, ${JSON.stringify(fields)}));`);
const DONE_AFTER_CALL = (fields) => standIn(
  `send({ t: 'call', runId: m.runId, callId: 1, action: 'calc', input: { expr: '1' }, labels: [], ctl: [] });`,
  `send(Object.assign({ t: 'done', runId: rid }, ${JSON.stringify(fields)}));`);

for (const [what, fields, field] of [
  ['labels that are not a list', { ok: true, value: 'x', labels: 'web', seen: [] }, 'labels'],
  ['a label that is not known', { ok: true, value: 'x', labels: ['web', 'secret'], seen: [] }, 'labels'],
  ['no labels at all', { ok: true, value: 'x', seen: [] }, 'labels'],
  ['seen that is not a list', { ok: true, value: 'x', labels: [], seen: 'model' }, 'seen'],
  ['no seen at all', { ok: true, value: 'x', labels: [] }, 'seen'],
]) {
  test('FAIL-FIRST a finished run with ' + what + ' fails: no value is returned, the audit says so', async () => {
    await inWorld(DONE(fields), async (w) => {
      const r = await w.ask();
      assert.equal(r.ok, false, 'the value is not returned: ' + JSON.stringify(r));
      assert.match(r.error, /BAD_MESSAGE/);
      assert.ok(w.malformed('done', field));
      assert.ok(r.labels.includes('web'), 'the input label web is not lost: ' + JSON.stringify(r.labels));
    });
  });
}

test('FAIL-FIRST a finished run with bad labels after a call fails, and the call\'s label is not lost', async () => {
  await inWorld(DONE_AFTER_CALL({ ok: true, value: 'x', labels: 'computed', seen: [] }), async (w) => {
    const r = await w.ask();
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.ok(w.calcRan(), 'the call before the end ran');
    assert.ok(r.labels.includes('web') && r.labels.includes('computed'), 'the reply keeps the input\'s and the call\'s labels: ' + JSON.stringify(r.labels));
  });
});

for (const [what, fields] of [
  ['no labels at all', { ok: false, script: true, code: 'RUN', message: 'boom' }],
  ['labels that are not a list', { ok: false, script: true, code: 'RUN', message: 'boom', labels: 'web' }],
  ['a label that is not known', { ok: false, script: true, code: 'RUN', message: 'boom', labels: ['x'] }],
]) {
  test('FAIL-FIRST a script error with ' + what + ' is refused BAD_MESSAGE, and the audit says so', async () => {
    await inWorld(DONE(fields), async (w) => {
      const r = await w.ask();
      assert.equal(r.ok, false, JSON.stringify(r));
      assert.match(r.error, /BAD_MESSAGE/, 'the error names the malformed message: ' + r.error);
      assert.ok(w.malformed('done', 'labels'));
      assert.ok(r.labels.includes('web'), JSON.stringify(r.labels));
    });
  });
}

test('FAIL-FIRST a failure that is not a script error, with labels that are not a list, is refused BAD_MESSAGE', async () => {
  await inWorld(DONE({ ok: false, script: false, message: 'boom', labels: 'web' }), async (w) => {
    const r = await w.ask();
    assert.equal(r.ok, false); assert.match(r.error, /BAD_MESSAGE/); assert.ok(w.malformed('done', 'labels'));
  });
});

test('GUARD a failure that is not a script error and has no labels field is well formed (pkd.js:59): it fails with its own message', async () => {
  await inWorld(DONE({ ok: false, script: false, message: 'the daemon broke' }), async (w) => {
    const r = await w.ask();
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.match(r.error, /the daemon broke/); assert.doesNotMatch(r.error, /BAD_MESSAGE/);
    assert.equal(w.audit.some((x) => x.kind === 'daemon-malformed'), false);
  });
});

test('GUARD a script error with a list of labels fails with its own code, and its labels are added', async () => {
  await inWorld(DONE({ ok: false, script: true, code: 'RUN', message: 'boom', labels: ['model'] }), async (w) => {
    const r = await w.ask();
    assert.equal(r.ok, false); assert.match(r.error, /RUN: boom/); assert.doesNotMatch(r.error, /BAD_MESSAGE/);
    assert.ok(r.labels.includes('model') && r.labels.includes('web'), JSON.stringify(r.labels));
  });
});

test('GUARD a well-formed end returns its value; a credential in it is dropped, not refused', async () => {
  await inWorld(DONE({ ok: true, value: 'x', labels: ['model', 'grounded'], seen: ['web'] }), async (w) => {
    const r = await w.ask();
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, 'x');
    assert.equal(r.labels.includes('grounded'), false, 'a daemon cannot claim a credential: ' + JSON.stringify(r.labels));
    assert.ok(r.labels.includes('model'));
    assert.equal(w.audit.some((x) => x.kind === 'daemon-malformed'), false);
  });
});
