// email.test.js — v1.0.1 · tests: the email action, the outbox and the SMTP client · changelog: act/CHANGELOG.md#acttestemailtestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// slice 3 step 3: the email action, the outbox and our SMTP client (ACTBUS docs/capability-architecture.md §7 item 3).
// On the old code the file fails to load (no mail/); with mail/ but the old bus 1.3.3, tests 9, 10 and 12 fail (no outbox seam);
// test 11 is a guard that holds on both (no other action may queue mail; no outbox = refuse). No real mail: a fake SMTP server on 127.0.0.1 with a
// test-only certificate (test/smtp-fixture.js). Run: node --test test/email.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), tls = require('tls');
const ROOT = path.join(__dirname, '..');
const { send, fromEnv } = require(path.join(ROOT, 'mail/smtp'));
const { Outbox, parseAllow, checkGrants } = require(path.join(ROOT, 'mail/outbox'));
const { CERT, KEY } = require('./smtp-fixture');
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'mail-' + t + '-'));
const PASS = 'S3cret-app-pass-XYZ';
const ME = 'alex@example.org';

// ── a fake SMTP server ───────────────────────────────────────────────────────────────────────────────────────────────────────
function fakeSmtp({ starttls = true, codes = {} } = {}) {
  const seen = { lines: [], data: null };
  const server = net.createServer((raw) => {
    let sock = raw, buf = '', inData = false, secure = false;
    const w = (s) => sock.write(s + '\r\n');
    const handle = (chunk) => {
      buf += chunk;
      for (;;) {
        if (inData) {
          const i = buf.indexOf('\r\n.\r\n'); if (i < 0) return;
          seen.data = buf.slice(0, i); buf = buf.slice(i + 5); inData = false; w(codes.message || '250 2.0.0 Ok: queued'); continue;
        }
        const i = buf.indexOf('\r\n'); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        seen.lines.push({ line, secure });
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') w(['250-fake.local', ...(starttls && !secure ? ['250-STARTTLS'] : []), '250-8BITMIME', '250 AUTH PLAIN LOGIN'].join('\r\n'));
        else if (verb === 'STARTTLS') {
          w('220 2.0.0 go ahead'); raw.removeAllListeners('data');
          const t = new tls.TLSSocket(raw, { isServer: true, key: KEY, cert: CERT });
          t.on('data', (d) => handle(d.toString('utf8'))); t.on('error', () => {}); sock = t; secure = true; buf = ''; return;
        } else if (verb === 'AUTH') w(codes.auth || '235 2.7.0 ok');
        else if (verb === 'MAIL') w(codes.mail || '250 2.1.0 ok');
        else if (verb === 'RCPT') w(codes.rcpt || '250 2.1.5 ok');
        else if (verb === 'DATA') { inData = true; w('354 end with .'); }
        else if (verb === 'QUIT') { w('221 bye'); sock.end(); }
        else w('502 no');
      }
    };
    raw.on('data', (d) => handle(d.toString('utf8'))); raw.on('error', () => {});
    w('220 fake.local ESMTP');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, seen, close: () => server.close() })));
}
const cfg = (port, extra = {}) => ({ host: '127.0.0.1', port, user: 'alex@example.net', pass: PASS, from: 'alex@example.com', tlsOptions: { ca: CERT }, timeoutMs: 5000, ...extra });
function unQP(s) {                                                   // an independent decoder for the check
  const bytes = []; s = s.replace(/=\r\n/g, '');
  for (let i = 0; i < s.length; i++) { if (s[i] === '=') { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; } else bytes.push(s.charCodeAt(i)); }
  return Buffer.from(bytes).toString('utf8');
}

test('smtp: STARTTLS before AUTH, certificate checked, CRLF, dot-stuffing, a UTF-8 subject — and the password is in no log', async () => {
  const srv = await fakeSmtp(), log = [];
  try {
    const text = 'Rate 0,7312 ↑\n.hidden line starts with a dot\n..two\n' + 'long '.repeat(40) + '\nend';
    const r = await send(cfg(srv.port, { log: (l) => log.push(l) }), { to: ME, subject: 'Prix du dollar — 0,73 $ ✓', text });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.code, 250);
    const auth = srv.seen.lines.find((l) => /^AUTH /.test(l.line));
    assert.ok(auth && auth.secure, 'AUTH was sent only inside TLS');
    assert.ok(srv.seen.lines.findIndex((l) => l.line === 'STARTTLS') < srv.seen.lines.indexOf(auth));
    assert.equal(Buffer.from(auth.line.split(' ')[2], 'base64').toString(), '\0alex@example.net\0' + PASS, 'AUTH PLAIN carries user and password');
    const d = srv.seen.data;
    assert.ok(!/[^\r]\n/.test(d) && !/\r(?!\n)/.test(d), 'every line ends CRLF');
    assert.ok(d.split('\r\n').every((l) => Buffer.byteLength(l) <= 78), 'no line over 78 bytes');
    assert.match(d, /\r\n\.\.hidden line/, 'a line starting with a dot is dot-stuffed on the wire');
    assert.match(d, /\r\n\.\.\.two/);
    const cut = d.indexOf('\r\n\r\n'), head = d.slice(0, cut), body = d.slice(cut + 4);
    const subj = head.match(/^Subject: (.*(?:\r\n .*)*)/m)[1].split(/\r\n /).map((w) => Buffer.from(w.match(/^=\?UTF-8\?B\?(.*)\?=$/)[1], 'base64').toString()).join('');
    assert.equal(subj, 'Prix du dollar — 0,73 $ ✓');
    assert.match(head, /^From: alex@example\.com$/m); assert.match(head, /^To: alex@example\.org$/m); assert.match(head, /^Date: \w{3}, \d\d \w{3} \d{4} \d\d:\d\d:\d\d \+0000$/m);
    assert.equal(unQP(body.split('\r\n').map((l) => (l.startsWith('..') ? l.slice(1) : l)).join('\r\n')).replace(/\r\n/g, '\n'), text, 'the body arrives exactly');
    const all = log.join('\n');
    assert.ok(!all.includes(PASS) && !all.includes(auth.line.split(' ')[2]), 'neither the password nor its base64 is logged');
    assert.match(all, /AUTH PLAIN \[redacted\]/);
  } finally { srv.close(); }
});

test('smtp: a server that does not offer STARTTLS is refused BEFORE any credential is sent (not retried)', async () => {
  const srv = await fakeSmtp({ starttls: false });
  try {
    const r = await send(cfg(srv.port), { to: ME, subject: 's', text: 't' });
    assert.equal(r.ok, false); assert.equal(r.temporary, false); assert.match(r.reply, /does not offer STARTTLS/);
    assert.ok(!srv.seen.lines.some((l) => /^AUTH|^MAIL/.test(l.line)), 'no AUTH, no MAIL');
  } finally { srv.close(); }
});

test('smtp: a certificate we do not trust is refused — no AUTH (not retried)', async () => {
  const srv = await fakeSmtp();
  try {
    const r = await send(cfg(srv.port, { tlsOptions: {} }), { to: ME, subject: 's', text: 't' });
    assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.temporary, false, JSON.stringify(r));
    assert.ok(!srv.seen.lines.some((l) => /^AUTH/.test(l.line)));
  } finally { srv.close(); }
});

test('smtp: a 4xx is temporary, a 5xx is permanent; fromEnv is OFF without every setting', async () => {
  const a = await fakeSmtp({ codes: { rcpt: '451 4.3.0 try later' } }), b = await fakeSmtp({ codes: { rcpt: '550 5.1.1 no such user' } });
  try {
    const ra = await send(cfg(a.port), { to: ME, subject: 's', text: 't' }), rb = await send(cfg(b.port), { to: ME, subject: 's', text: 't' });
    assert.deepEqual([ra.code, ra.temporary, ra.stage], [451, true, 'rcpt-to']);
    assert.deepEqual([rb.code, rb.temporary, rb.stage], [550, false, 'rcpt-to']);
  } finally { a.close(); b.close(); }
  assert.equal(fromEnv({ MAIL_HOST: 'h', MAIL_USER: 'u', MAIL_FROM: 'a@b.ca' }), null, 'no password → delivery off');
  const ad = fromEnv({ MAIL_HOST: 'smtp.example.com', MAIL_USER: 'u', MAIL_APP_PASSWORD: PASS, MAIL_FROM: 'alex@example.com' });
  assert.ok(!JSON.stringify(ad).includes(PASS) && !String(ad.name).includes(PASS), 'the adapter does not show its secret');
});

// ── the outbox ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const H = 3600000;
function box({ dir = tmp('ob'), adapter = null, perHour, perDay, clk = { t: Date.UTC(2026, 10, 3, 15) } } = {}) {
  const audit = [];
  const o = new Outbox({ dir, allow: parseAllow(ME + ', other@example.com'), clock: () => clk.t, audit: (r) => audit.push(r), adapter, perHour, perDay });
  return { o, audit, dir, clk };
}
const q = (o, extra = {}) => o.enqueue({ to: ME, subject: 'hi', text: 'body', labels: ['person'], identity: 'helper', authority: ['alex', 'helper'], trace: 't1', targets: [ME], ...extra });

test('outbox: both lists must allow; the rate caps hold per hour and per day, counted from the files (across a restart)', () => {
  const b = box({ perHour: 6, perDay: 8 });
  assert.throws(() => q(b.o, { to: 'stranger@example.com', targets: ['stranger@example.com'] }), /not on this box's mail allow-list/);
  assert.throws(() => q(b.o, { to: 'other@example.com' }), /not among the recipients granted to alex → helper/);
  for (let i = 0; i < 6; i++) assert.equal(q(b.o).status, 'queued');
  assert.throws(() => q(b.o), /reached 6 mails this hour/);
  assert.equal(q(b.o, { identity: 'someone-else' }).status, 'queued', 'the cap is per identity');
  b.clk.t += H; q(b.o); q(b.o);
  const again = box({ dir: b.dir, perHour: 6, perDay: 8, clk: b.clk });          // a restart
  assert.throws(() => q(again.o), /reached 8 mails today/);
  assert.ok(b.audit.some((r) => r.kind === 'mail-refused'));
});

test('outbox: delivery OFF keeps mail queued; a 4xx is retried at most 3 times (1/5/15 min), a 5xx never; records survive a restart', async () => {
  const off = box(); const { id } = q(off.o);
  assert.deepEqual(await off.o.deliver(), { off: true });
  assert.equal(off.o.list().find((r) => r.id === id).status, 'queued');

  const calls = []; let answer = { ok: false, code: 451, reply: '451 later', temporary: true };
  const b = box({ adapter: { send: async (rec) => { calls.push(rec.id); return answer; } } });
  const m1 = q(b.o).id;
  const at = (ms) => { b.clk.t += ms; return b.o.deliver(); };
  await at(0); await at(30000); assert.equal(calls.length, 1, 'not before the 1-minute retry');
  await at(30000); assert.equal(calls.length, 2);
  await at(5 * 60000); assert.equal(calls.length, 3);
  await at(15 * 60000); assert.equal(calls.length, 4, 'the first try plus 3 retries');
  await at(60 * 60000); assert.equal(calls.length, 4, 'then it stops');
  assert.equal(b.o.list().find((r) => r.id === m1).status, 'failed');

  answer = { ok: false, code: 550, reply: '550 no', temporary: false };
  const m2 = q(b.o).id; await at(0);
  assert.equal(calls.filter((c) => c === m2).length, 1); assert.equal(b.o.list().find((r) => r.id === m2).status, 'failed', 'a 5xx is not retried');

  answer = { ok: true, code: 250, reply: '250 ok' };
  const m3 = q(b.o, { text: 'UNIQUE-BODY-7731' }).id; await at(0);
  const restarted = box({ dir: b.dir, clk: b.clk });
  assert.equal(restarted.o.list().find((r) => r.id === m3).status, 'sent', 'the record survives a restart');
  const all = JSON.stringify(b.audit);
  assert.ok(!all.includes('UNIQUE-BODY-7731'), 'the audit never holds the body');
  assert.ok(b.audit.some((r) => r.kind === 'mail-sent' && /^[a-f0-9]{64}$/.test(r.sha256)));
});

test('outbox: a grant naming an address outside MAIL_ALLOW is refused at start; MAIL_ALLOW must be plain addresses', () => {
  const ids = new Map([['helper', { actions: { email: { targets: [ME, 'boss@elsewhere.com'] } } }], ['ok', { actions: { email: { targets: [ME] } } }]]);
  assert.throws(() => checkGrants(ids, [ME]), /helper → boss@elsewhere\.com/);
  assert.doesNotThrow(() => checkGrants(new Map([['ok', ids.get('ok')]]), [ME]));
  assert.throws(() => parseAllow('a@b.com, "Evil" <x@y.com>'), /not a plain address/);
});

test('smtp + outbox end to end: a queued mail goes out through the fake server; the secret is in no record, audit or log', async () => {
  const srv = await fakeSmtp(), log = [];
  try {
    const adapter = fromEnv({ MAIL_HOST: '127.0.0.1', MAIL_PORT: String(srv.port), MAIL_USER: 'alex@example.net', MAIL_APP_PASSWORD: PASS, MAIL_FROM: 'alex@example.com' }, { log: (l) => log.push(l), tlsOptions: { ca: CERT } });
    const b = box({ adapter });
    const { id } = q(b.o, { labels: ['model', 'person'] });
    await b.o.deliver();
    assert.equal(b.o.list().find((r) => r.id === id).status, 'sent', JSON.stringify(b.audit));
    const d = srv.seen.data, body = d.slice(d.indexOf('\r\n\r\n') + 4).split('\r\n').map((l) => (l.startsWith('..') ? l.slice(1) : l)).join('\r\n');
    assert.match(unQP(body), /Contains text written by a language model \(label: model\)/);
    const files = fs.readdirSync(b.dir).map((f) => fs.readFileSync(path.join(b.dir, f), 'utf8')).join('\n');
    for (const where of [files, JSON.stringify(b.audit), log.join('\n')]) assert.ok(!where.includes(PASS));
  } finally { srv.close(); }
});

// ── through the real bus ─────────────────────────────────────────────────────────────────────────────────────────────────────
function world({ outbox = true, scripts = [] } = {}) {
  const registry = require(path.join(ROOT, 'core/registry')), caps = require(path.join(ROOT, 'core/capabilities'));
  const { Names } = require(path.join(ROOT, 'core/names')), { Bus } = require(path.join(ROOT, 'core/bus'));
  const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
  const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');   // 0.53.2: shipped built-ins only — an installed script (staging: scout) is not part of this test
  const dir = tmp('act'), files = tmp('files');
  for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'sneak.js'), "module.exports = { run: (input, ctx) => ({ has: typeof ctx.queueMail }) };");
  const spec = [...SPEC, { name: 'sneak', version: '1.0.0', kind: 'tentacle', file: 'sneak.js', produces: 'computed', world: true, needs: [], input: {}, timeoutMs: 2000 }];
  for (const [name, src] of scripts) { fs.writeFileSync(path.join(dir, name + '.pk'), src); spec.push({ name, version: '1.0.0', kind: 'script', file: name + '.pk', produces: 'computed', world: true, runsAs: name, needs: [], input: {}, acceptWarnings: true }); }
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  const engine = createEngine({ stateRoot: files });
  const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
  if (loaded.refused.length) throw new Error('refused: ' + JSON.stringify(loaded.refused));
  const ids = caps.fromList([
    { name: 'alex', kind: 'person', owner: 'alex', actions: { email: { targets: [ME, 'other@example.com', 'outside@nowhere.com'] }, sneak: {}, ...Object.fromEntries(scripts.map(([n]) => [n, {}])) } },
    { name: 'jane', kind: 'person', owner: 'jane', actions: { email: { targets: [ME], allowTainted: true } } },
    ...scripts.map(([name]) => ({ name, kind: 'script', owner: 'alex', actions: { [name]: {}, email: { targets: [ME] } } }))]);   // a script identity holds its own script
  const audit = [], ob = outbox ? new Outbox({ dir: path.join(files, 'outbox'), allow: [ME, 'other@example.com'], audit: (r) => audit.push(r) }) : null;
  const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), filesRoot: files, outbox: ob, audit: () => {} });
  return { bus, ob, engine, audit };
}
const mail = (w, who, input, labels = []) => w.bus.ask(who, 'email', { to: ME, subject: 'hello', text: 'the rate went up', ...input }, { labels });

test('bus: email queues for a granted recipient; refuses one not granted, one off MAIL_ALLOW, a header break, two recipients', async () => {
  const w = world();
  try {
    const ok = await mail(w, 'alex', {});
    assert.equal(ok.ok, true, JSON.stringify(ok)); assert.equal(ok.value.status, 'queued');
    const rec = w.ob.records()[0];
    assert.equal(rec.identity, 'alex'); assert.deepEqual(rec.authority, ['alex']); assert.equal(rec.trace, ok.trace);
    assert.match(rec.text, /Sent by ACTBUS for alex/);   // 1.0.1 (v0.53.6): this Outbox is given no name — the default; the three ways: product.test.js
    const no = async (input, re) => { const r = await mail(w, 'alex', input); assert.equal(r.ok, false, JSON.stringify(input)); assert.match(r.error, re); };
    await no({ to: 'stranger@example.com' }, /not among the recipients granted to alex/);
    await no({ to: 'outside@nowhere.com' }, /not on this box's mail allow-list/);
    await no({ subject: 'hi\r\nBcc: all@example.com' }, /line breaks/);
    await no({ to: ME + ', other@example.com' }, /ONE plain address/);
    assert.equal(w.ob.records().length, 1, 'nothing else was queued');
  } finally { w.engine.close(); }
});

test('bus: a web/model-labelled body is refused without allowTainted, queued WITH it — and the footer says where the text came from', async () => {
  const w = world();
  try {
    const r = await mail(w, 'alex', {}, ['web']);
    assert.equal(r.ok, false); assert.equal(r.code, 'TAINTED');
    const j = await mail(w, 'jane', {}, ['web', 'model']);
    assert.equal(j.ok, true, JSON.stringify(j));
    const rec = w.ob.records()[0];
    assert.match(rec.text, /Contains text read from the web \(label: web\)/); assert.match(rec.text, /written by a language model/);
    assert.deepEqual(rec.labels.filter((l) => l === 'model' || l === 'web'), ['model', 'web']);
  } finally { w.engine.close(); }
});

test('bus: only the email action gets the outbox; with no outbox email refuses', async () => {
  const w = world();
  try { const s = await w.bus.ask('alex', 'sneak', {}); assert.equal(s.ok, true); assert.equal(s.value.has, 'undefined'); } finally { w.engine.close(); }
  const n = world({ outbox: false });
  try { const r = await mail(n, 'alex', {}); assert.equal(r.ok, false); assert.match(r.error, /not set up on this box/); } finally { n.engine.close(); }
});

test('a PROTEUS-K script mails as ITSELF: the record names the script identity and the whole chain', async () => {
  const w = world({ scripts: [['mailer', '(get (email :to "alex@example.org" :subject "from a script" :text "hello") "status")']] });
  try {
    const r = await w.bus.ask('alex', 'mailer', {}, {});
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.value, 'queued');
    const rec = w.ob.records()[0];
    assert.equal(rec.identity, 'mailer'); assert.deepEqual(rec.authority, ['alex', 'mailer']);
  } finally { w.engine.close(); }
});
