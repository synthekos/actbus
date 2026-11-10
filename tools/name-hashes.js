// name-hashes.js — v1.0.0 · prints the sha256 of the three strings that README "What you can check here" publishes:
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// the mail footer, the built message with its X-Mailer header, and the fetch User-Agent, each built by this repository's kernel
// with productName 'SYNTHEKOS' from the fixed inputs below. These are the inputs of SYNTHEKOS's own release check, word for word.
// Read-only: nothing is written and nothing leaves the machine (the fetch goes to a stand-in). Run from the repository root:
//   node tools/name-hashes.js            exit 0 and "NAME-HASHES PASS" when all three equal the published values
'use strict';
const path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const PUBLISHED = { footer: 'c800d61e82e68d4e6a6326b53cd1e920e91cc843c5be4a3eb0a5f41602c03b17',
  message: '406f664154f3cbca953e6a20b47377bd8eb12fe3ad116fa7b6acfcd9b0c4e632',
  ua: '66195a057cb109fdf09fd113a11cf0597abd9f114754a8f3e14a629f669fb3c7' };
const I = 'zz-check-0536';
(async () => {
  const { footer } = require(path.join(ROOT, 'act/mail/outbox'));
  const smtp = require(path.join(ROOT, 'act/mail/smtp'));
  const registry = require(path.join(ROOT, 'act/core/registry')), caps = require(path.join(ROOT, 'act/core/capabilities'));
  const { Names } = require(path.join(ROOT, 'act/core/names')), { Bus } = require(path.join(ROOT, 'act/core/bus'));
  const f = footer({ identity: I, authority: [I, I + '-b'], trace: 't-0536', labels: ['model', 'web'], product: 'SYNTHEKOS' });
  const m = smtp.build({ from: 'check@example.org', to: 'check@example.org', subject: 'kit 2 after-check — ✓', text: 'line one\n.line two', date: new Date(0), messageId: I, product: 'SYNTHEKOS' });
  const seen = [];
  const bus = new Bus({ registry: registry.load(path.join(ROOT, 'act/actions')).actions,
    identities: caps.fromList([{ name: I, kind: 'person', owner: I, actions: { fetch: { targets: ['check.example'] } } }]),
    names: new Names('local'), audit: () => {}, productName: 'SYNTHEKOS',
    fetch: async (u, o) => { seen.push(o.headers['User-Agent']); return { status: 200, text: async () => 'ok' }; } });
  const r = await bus.ask(I, 'fetch', { url: 'https://check.example/' });
  const got = { footer: sha(f), message: sha(m), ua: r.ok && seen.length === 1 ? sha(seen[0]) : 'the fetch did not run: ' + (r.code || '?') };
  let bad = 0;
  for (const k of ['footer', 'message', 'ua']) { const same = got[k] === PUBLISHED[k]; if (!same) bad++;
    console.log((same ? 'same ' : 'DIFFERENT ') + k + ' ' + got[k]); }
  console.log(bad ? 'NAME-HASHES FAIL — ' + bad + ' of 3 differ' : 'NAME-HASHES PASS — 3 of 3 equal the published values');
  process.exit(bad ? 1 : 0);
})();
