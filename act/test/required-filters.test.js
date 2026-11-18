// required-filters.test.js — v1.0.0 · tests: the mailbox's read and ack filters are required (C4); `:to` is in a script's reach (B5) · changelog: act/CHANGELOG.md#acttestrequired-filterstestjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// Tests marked FAIL-FIRST fail on ACTBUS v0.3.8 (mailbox.js 1.2.2, engine.js 1.6.0): there read's filters defaulted to () => true and own to
// accept, ack's to () => true, and a literal :to was left out of the reach list. Tests marked GUARD hold on both.
// Run from anywhere: node --test act/test/required-filters.test.js — the test finds the kernel by its own location (act/test/..)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');   // the kernel's act/, found from this file's own location
const { Mailbox } = require(path.join(ROOT, 'mailbox'));
const { survey } = require(path.join(ROOT, 'proteus/engine'));
const { read } = require(path.join(ROOT, 'proteus/reader'));

function mk() {
  const mb = new Mailbox({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'rf-')), clock: () => Date.UTC(2026, 10, 17, 16, 0), audit: () => {} });
  const send = (from) => mb.send({ from, authority: [from], to: 'b', topic: 'job', body: 'hi', labels: [], trace: 't-' + from, msgId: 'm-' + from });
  return { mb, send };
}
const ALL = () => true;

// --- C4: read ----------------------------------------------------------------------------------------------------------------------
test('FAIL-FIRST read with no filters throws, and claims nothing', () => {
  const { mb, send } = mk(); send('a');
  assert.throws(() => mb.read('b', 'job', 'r1'), /two filters/);
  assert.deepEqual(mb.list('b').map((m) => m.status), ['new'], 'the message is still waiting');
});

test('FAIL-FIRST read with accept but no own throws — it no longer marks a sender the recipient still accepts DEAD', () => {
  const { mb, send } = mk(); send('a'); send('c');
  assert.throws(() => mb.read('b', 'job', 'r1', (from) => from === 'c'), /two filters/);
  assert.deepEqual(mb.list('b').map((m) => m.status).sort(), ['new', 'new'], 'neither message was claimed or marked dead');
});

test('FAIL-FIRST read with a filter that is not a function throws', () => {
  const { mb, send } = mk(); send('a');
  assert.throws(() => mb.read('b', 'job', 'r1', true, ALL), /two filters/);
  assert.throws(() => mb.read('b', 'job', 'r1', ALL, 'a'), /two filters/);
});

test('GUARD read with both filters: a narrow accept leaves the other sender waiting; own decides who is dead', () => {
  const { mb, send } = mk(); send('a'); send('c');
  const got = mb.read('b', 'job', 'r1', (from) => from === 'c', ALL);
  assert.deepEqual(got.map((m) => m.from), ['c']);
  assert.deepEqual(mb.list('b').map((m) => [m.from, m.status]).sort(), [['a', 'new'], ['c', 'claimed']]);
  const { mb: mb2, send: send2 } = mk(); send2('a');
  mb2.read('b', 'job', 'r2', ALL, (from) => from !== 'a');
  assert.deepEqual(mb2.list('b').map((m) => m.status), ['dead'], 'own rejected a: dead');
});

// --- C4: ack -----------------------------------------------------------------------------------------------------------------------
test('FAIL-FIRST ack with no filter throws, and removes nothing', () => {
  const { mb, send } = mk(); send('a');
  const [m] = mb.read('b', 'job', 'r1', ALL, ALL); mb.hold('r1');   // held for a key holder: what ack may remove
  assert.throws(() => mb.ack('b', [m.id]), /needs a filter/);
  assert.equal(mb.list('b').length, 1, 'the message is still there');
});

test('GUARD ack with a filter removes only what it allows', () => {
  const { mb, send } = mk(); send('a'); send('c');
  const got = mb.read('b', 'job', 'r1', ALL, ALL); mb.hold('r1');
  assert.equal(mb.ack('b', got.map((m) => m.id), (from) => from === 'c'), 1);
  assert.deepEqual(mb.list('b').map((m) => m.from), ['a']);
});

// --- B5: :to in the reach list -----------------------------------------------------------------------------------------------------
test('FAIL-FIRST a literal :to (send, email) is in the reach list', () => {
  assert.deepEqual(survey(read('(send :to "bob" :topic "t" :body "hi")')).targets, ['to:bob']);
  assert.deepEqual(survey(read('(email :to "ann@example.com" :subject "s" :text "x")')).targets, ['to:ann@example.com']);
});

test('GUARD :url and :name are still listed; a :to that is not a literal string is not', () => {
  assert.deepEqual(survey(read('(do (fetch :url "https://a.example") (file-append :name "n.txt" :text "x"))')).targets, ['name:n.txt', 'url:https://a.example']);
  assert.deepEqual(survey(read('(send :to (input who) :topic "t" :body "hi")')).targets, []);
});
