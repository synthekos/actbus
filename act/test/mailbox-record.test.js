// mailbox-record.test.js — v1.0.1 · tests: a mailbox record without a labels list is damaged, not a message · changelog: act/CHANGELOG.md#acttestmailbox-recordtestjs
// 1.0.1 (C4, mailbox 1.3.0): read's two filters are required; each call passes what the defaults gave, () => true for both.
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// The kernel always writes a labels list (act/mailbox.js send). A record without one is damaged or hand-made: reading it unlabelled would
// hand its body to a script with no provenance. Tests marked FAIL-FIRST fail on ACTBUS v0.3.7 (mailbox.js 1.2.1); GUARD tests hold on both.
// Run from anywhere: node --test act/test/mailbox-record.test.js — the test finds the kernel by its own location (act/test/..)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');   // the kernel's act/, found from this file's own location
const { Mailbox } = require(path.join(ROOT, 'mailbox'));

function mk() {
  const lines = [];
  const mb = new Mailbox({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'mbr-')), clock: () => Date.UTC(2026, 10, 16, 21, 0), audit: (l) => lines.push(l) });
  return { mb, lines };
}
// a real record, sent by the kernel, copied under a new id with its labels field changed
function forged(mb, labels) {
  mb.send({ from: 'a', to: 'b', topic: 'job', body: 'from a', labels: ['web'], trace: 't-real' });
  const real = mb.list('b')[0];
  const rec = JSON.parse(fs.readFileSync(path.join(mb.dir, 'b', real.id + '.json'), 'utf8'));
  const id = 'g-0-forged';
  if (labels === undefined) delete rec.labels; else rec.labels = labels;
  fs.writeFileSync(path.join(mb.dir, 'b', id + '.json'), JSON.stringify({ ...rec, id, body: 'no provenance' }));
  return { realId: real.id, id };
}

for (const [label, labels] of [['no labels field', undefined], ['labels that are not a list (a string)', 'web'], ['labels: null', null]]) {
  test('FAIL-FIRST a record with ' + label + ' is not delivered: it is moved to .corrupt/ once, logged once, and the real message still reads', () => {
    const { mb, lines } = mk();
    const { realId, id } = forged(mb, labels);
    const got = mb.read('b', 'job', 'run-1', () => true, () => true);
    assert.deepEqual(got.map((m) => m.id), [realId], 'only the kernel-written message is delivered');
    assert.deepEqual(got[0].labels, ['web']);
    assert.equal(fs.existsSync(path.join(mb.dir, 'b', id + '.json')), false, 'the damaged file left the mailbox');
    assert.equal(fs.existsSync(path.join(mb.dir, '.corrupt', 'b--' + id + '.json')), true, 'it is kept in .corrupt/');
    const bad = lines.filter((l) => l.kind === 'msg-corrupt');
    assert.equal(bad.length, 1); assert.equal(bad[0].file, id + '.json'); assert.match(bad[0].why, /not a message record/); assert.equal(bad[0].moved, true);
    mb.read('b', 'job', 'run-2', () => true, () => true);
    assert.equal(lines.filter((l) => l.kind === 'msg-corrupt').length, 1, 'reported once, not on every look');
  });
}

test('GUARD a record whose labels list is empty is a message, and is delivered', () => {
  const { mb, lines } = mk();
  const { realId, id } = forged(mb, []);
  assert.deepEqual(mb.read('b', 'job', 'run-1', () => true, () => true).map((m) => m.id).sort(), [id, realId].sort());
  assert.equal(lines.filter((l) => l.kind === 'msg-corrupt').length, 0);
});

test('GUARD a message the kernel sends with no labels given still carries a list, and is delivered', () => {
  const { mb } = mk();
  mb.send({ from: 'a', to: 'b', topic: 'job', body: 'plain', labels: [], trace: 't' });
  const got = mb.read('b', 'job', 'run-1', () => true, () => true);
  assert.equal(got.length, 1); assert.deepEqual(got[0].labels, []);
});
