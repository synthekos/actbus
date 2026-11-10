// product.test.js — v1.2.0 · tests: the host's product name on the wire, three ways per site, and what create() refuses · changelog: act/CHANGELOG.md#acttestproducttestjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// The host's name on the wire, three ways per site — 'SYNTHEKOS' gives today's bytes, no name gives ACTBUS
// (these FAIL on act.js 1.6.2: the name was fixed), a supplied name ('HostApp') is used as given. Sites: W1 the fetch
// User-Agent (through the bus), W2 the mail footer, W3 X-Mailer, W4 the HELO name, W5 the DAEMON_PAUSED message; then
// create() carries productName to all of them; modelUrl is the model server's address (its old name is refused). No real network.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), tls = require('tls');
const ROOT = path.join(__dirname, '..');
const { DEFAULT, productName } = require(path.join(ROOT, 'core/product'));
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const { Outbox, footer } = require(path.join(ROOT, 'mail/outbox'));
const smtp = require(path.join(ROOT, 'mail/smtp'));
const { Supervisor } = require(path.join(ROOT, 'daemon/supervisor'));
const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
const { CERT, KEY } = require('./smtp-fixture');
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'product-' + t + '-'));
const ME = 'alex@example.org';
const WAYS = [['SYNTHEKOS', 'SYNTHEKOS'], [undefined, 'ACTBUS'], ['HostApp', 'HostApp']];   // [what the host passes, the name on the wire]

// a fake SMTP server (STARTTLS with the test certificate) that keeps the EHLO lines and the message
function fakeSmtp() {
  const seen = { lines: [], data: null };
  const server = net.createServer((raw) => {
    let sock = raw, buf = '', inData = false, secure = false;
    const w = (s) => sock.write(s + '\r\n');
    const handle = (chunk) => {
      buf += chunk;
      for (;;) {
        if (inData) { const i = buf.indexOf('\r\n.\r\n'); if (i < 0) return; seen.data = buf.slice(0, i); buf = buf.slice(i + 5); inData = false; w('250 ok'); continue; }
        const i = buf.indexOf('\r\n'); if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2); seen.lines.push(line);
        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO') w(['250-fake.local', ...(!secure ? ['250-STARTTLS'] : []), '250 AUTH PLAIN'].join('\r\n'));
        else if (verb === 'STARTTLS') {
          w('220 go ahead'); raw.removeAllListeners('data');
          const t = new tls.TLSSocket(raw, { isServer: true, key: KEY, cert: CERT });
          t.on('data', (d) => handle(d.toString('utf8'))); t.on('error', () => {}); sock = t; secure = true; buf = ''; return;
        } else if (verb === 'DATA') { inData = true; w('354 go'); }
        else if (verb === 'QUIT') { w('221 bye'); sock.end(); }
        else w(verb === 'AUTH' ? '235 ok' : '250 ok');
      }
    };
    raw.on('data', (d) => handle(d.toString('utf8'))); raw.on('error', () => {});
    w('220 fake.local ESMTP');
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, seen, close: () => server.close() })));
}
const mailEnv = (port, extra = {}) => ({ MAIL_HOST: '127.0.0.1', MAIL_PORT: String(port), MAIL_USER: 'alex@example.net', MAIL_APP_PASSWORD: 'x', MAIL_FROM: 'alex@example.com', ...extra });
const header = (data, name) => { const m = data.slice(0, data.indexOf('\r\n\r\n')).match(new RegExp('^' + name + ': (.*)$', 'm')); return m && m[1]; };

test('product.js: no name is ACTBUS; a plain token is kept; anything that could break a header is refused', () => {
  assert.equal(DEFAULT, 'ACTBUS'); assert.equal(productName(), 'ACTBUS');
  for (const ok of ['SYNTHEKOS', 'HostApp', 'a', 'x.y_z-1', 'A'.repeat(32)]) assert.equal(productName(ok), ok);
  for (const bad of ['', ' ', 'Host App', 'x\r\nBcc: all@example.com', 'x\n', '-lead', '.lead', 'A'.repeat(33), 'naïve', null, 42, {}]) {
    assert.throws(() => productName(bad), /productName must be/, JSON.stringify(String(bad)));
  }
});

test('W1 fetch: the User-Agent the bus gives fetch.js — SYNTHEKOS-fetch/1.0 (today), ACTBUS-fetch/1.0 (default), HostApp-fetch/1.0', async () => {
  const loaded = registry.load(path.join(ROOT, 'actions'));
  assert.ok(loaded.actions.has('fetch'), 'the shipped fetch.js loads (its pin matches): ' + JSON.stringify(loaded.refused));
  for (const [given, wire] of WAYS) {
    const seen = [];
    const fetch = async (url, opts) => { seen.push(opts.headers['User-Agent']); return { status: 200, text: async () => 'ok' }; };
    const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: {} }, { name: 'bot', kind: 'euser', owner: 'alex', actions: { fetch: { targets: ['rates.example'] } } }]);
    const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), audit: () => {}, fetch, ...(given ? { productName: given } : {}) });
    const r = await bus.ask('bot', 'fetch', { url: 'https://rates.example/a' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(seen, [wire + '-fetch/1.0']);
  }
  assert.throws(() => new Bus({ registry: loaded.actions, identities: new Map(), names: new Names('local'), audit: () => {}, productName: 'two words' }), /productName must be/);
});

test('W2 footer: "Sent by SYNTHEKOS for …" exactly as today, "Sent by ACTBUS …" by default, "Sent by HostApp …" when given', () => {
  const today = (n) => ['', '', '-- ', 'Sent by ' + n + ' for alex (authority: alex → bot) · trace t-1', 'Labels: none'].join('\n');
  assert.equal(footer({ identity: 'alex', authority: ['alex', 'bot'], trace: 't-1', labels: [] }), today('ACTBUS'), 'footer() without product');
  for (const [given, wire] of WAYS) {
    assert.equal(footer({ identity: 'alex', authority: ['alex', 'bot'], trace: 't-1', labels: [], ...(given ? { product: given } : {}) }), today(wire));
    const ob = new Outbox({ dir: tmp('ob'), allow: [ME], ...(given ? { productName: given } : {}) });
    ob.enqueue({ to: ME, subject: 's', text: 'body', labels: [], identity: 'alex', authority: ['alex', 'bot'], trace: 't-1', targets: [ME] });
    assert.equal(ob.records()[0].text, 'body' + today(wire));
  }
  assert.throws(() => new Outbox({ dir: tmp('ob'), productName: 'x\r\nBcc: y' }), /productName must be/);
});

test('W3 X-Mailer: build() and a real send through fromEnv — SYNTHEKOS (today), ACTBUS (default), HostApp', async () => {
  const msg = { from: 'alex@example.com', to: ME, subject: 's', text: 't', date: new Date(0), messageId: 'm1' };
  for (const [given, wire] of WAYS) {
    assert.equal(header(smtp.build({ ...msg, ...(given ? { product: given } : {}) }), 'X-Mailer'), wire, 'build()');
    const srv = await fakeSmtp();
    try {
      const a = smtp.fromEnv(mailEnv(srv.port), { tlsOptions: { ca: CERT }, ...(given ? { productName: given } : {}) });
      const r = await a.send({ to: ME, subject: 's', text: 't', id: 'm-1' });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(header(srv.seen.data, 'X-Mailer'), wire, 'on the wire');
    } finally { srv.close(); }
  }
  assert.throws(() => smtp.fromEnv(mailEnv(1), { productName: '' }), /productName must be/);
});

test('W4 HELO: MAIL_HELO when set, else the host name, else [127.0.0.1] (was the name "synthekos"); a bad MAIL_HELO turns mail off', async () => {
  const ehlo = async (env, hostname) => {
    const real = os.hostname; if (hostname !== undefined) os.hostname = () => hostname;
    const srv = await fakeSmtp();
    try { const r = await smtp.fromEnv(mailEnv(srv.port, env), { tlsOptions: { ca: CERT } }).send({ to: ME, subject: 's', text: 't', id: 'm-1' }); assert.equal(r.ok, true, JSON.stringify(r)); }
    finally { srv.close(); os.hostname = real; }
    return srv.seen.lines.filter((l) => /^EHLO /.test(l));
  };
  assert.deepEqual(await ehlo({}), ['EHLO ' + os.hostname(), 'EHLO ' + os.hostname()], 'the host name, before and after STARTTLS');
  assert.deepEqual(await ehlo({}, ''), ['EHLO [127.0.0.1]', 'EHLO [127.0.0.1]'], 'no host name: an address literal');
  assert.deepEqual(await ehlo({ MAIL_HELO: 'mail.example.org' }, ''), ['EHLO mail.example.org', 'EHLO mail.example.org']);
  assert.deepEqual(await ehlo({ MAIL_HELO: '[192.0.2.1]' }), ['EHLO [192.0.2.1]', 'EHLO [192.0.2.1]']);
  for (const bad of ['two words', 'x\r\nRCPT TO:<a@b.example>', '-lead.example', 'a..b', '[1.2.3]', 'a'.repeat(64) + '.example', ('a'.repeat(60) + '.').repeat(5) + 'example'])
    assert.throws(() => smtp.fromEnv(mailEnv(1, { MAIL_HELO: bad })), /MAIL_HELO must be/, JSON.stringify(bad));
});

test('W5 DAEMON_PAUSED: "… until SYNTHEKOS starts again" / ACTBUS by default / HostApp — host-neutral, the old text is gone', async () => {
  for (const [given, wire] of WAYS) {
    const s = new Supervisor({ crashLimit: 1, ...(given ? { productName: given } : {}) });
    s.spawn = () => { throw new Error('no daemon is started in this test'); };
    s.crash('c', 'test');
    let e = null; try { await s.run('c', {}, {}); } catch (x) { e = x; }
    s.close();
    assert.equal(e && e.code, 'DAEMON_PAUSED', String(e && e.message));
    assert.equal(e.message.replace(/^DAEMON_PAUSED: /, ''), 'the script daemon for c is paused after 1 crashes in 10 minutes — it stays paused until ' + wire + ' starts again (check the audit log first)');
    assert.doesNotMatch(e.message, /an admin restarts/);
  }
  const eng = createEngine({ daemon: true, productName: 'HostApp' }); assert.equal(eng.supervisor.product, 'HostApp'); eng.close();
  const def = createEngine({ daemon: true }); assert.equal(def.supervisor.product, 'ACTBUS'); def.close();
  assert.throws(() => new Supervisor({ productName: 'a b' }), /productName must be/);
});

// ── through act.js create() ─────────────────────────────────────────────────────────────────────────────────────────────────
const actmod = require(path.join(ROOT, '..', 'act.js'));
const prisma = { user: { findMany: async () => [] } };
function make(opts, logged) {
  const log = { error: (m) => logged.push(['error', m]), warn: (m) => logged.push(['warn', m]) };
  return actmod.create({ prisma, models: { isInstalled: () => true }, modelUrl: 'http://127.0.0.1:9', appDir: tmp('app'), log, env: {}, daemon: true, ...opts });
}
test('create(): productName reaches the bus, the outbox and the supervisor; ACTBUS by default; a bad name refuses before anything is made', async () => {
  for (const [given, wire] of WAYS) {
    const A = make(given ? { productName: given } : {}, []);
    try { assert.deepEqual([A.bus.product, A.outbox.product, A.engine.supervisor.product], [wire, wire, wire]); } finally { await A.stop(); }
  }
  const app = path.join(tmp('bad'), 'app');
  assert.throws(() => actmod.create({ prisma, models: {}, modelUrl: 'http://127.0.0.1:9', appDir: app, log: { error() {} }, env: {}, productName: 'x\ny' }), /productName must be/);
  assert.equal(fs.existsSync(app), false, 'nothing was created');
});

test('create(): modelUrl is where the model is asked, and no log line is written', async () => {
  const urls = [], logged = [];
  const A = make({ modelUrl: 'http://127.0.0.1:9/', fetchImpl: async (u) => { urls.push(u); return { ok: true, json: async () => ({ response: 'hi' }) }; } }, logged);
  try { assert.equal(await A.bus.names.resolve('model', 'm').handler({ model: 'm', prompt: 'p' }), 'hi'); } finally { await A.stop(); }
  assert.deepEqual(urls, ['http://127.0.0.1:9/api/generate']);
  assert.deepEqual(logged, []);
});

test('FAIL-FIRST create(): the removed option ollamaUrl is refused before anything is created — alone and next to modelUrl', () => {
  for (const opts of [{ ollamaUrl: 'http://127.0.0.1:9' }, { modelUrl: 'http://127.0.0.1:9', ollamaUrl: 'http://127.0.0.1:9' }]) {
    const app = path.join(tmp('removed'), 'app');
    assert.throws(() => actmod.create({ prisma, models: {}, modelUrl: 'http://127.0.0.1:9', appDir: app, log: { error() {}, warn() {} }, env: {}, ...opts }),
      { message: 'create(): ollamaUrl was removed in 0.53.7 — pass modelUrl' });
    assert.equal(fs.existsSync(app), false, 'nothing was created');
  }
});

test('FAIL-FIRST create(): if models is given, modelUrl is required — refused before anything is created', () => {
  for (const extra of [{}, { modelUrl: '' }, { modelUrl: '   ' }, { modelUrl: 42 }, { modelUrl: undefined }]) {
    const app = path.join(tmp('nourl'), 'app');
    assert.throws(() => actmod.create({ prisma, models: { isInstalled: () => true }, appDir: app, log: { error() {}, warn() {} }, env: {}, ...extra }),
      { message: "create(): models is given, so modelUrl is required — pass the model server's URL as modelUrl" });
    assert.equal(fs.existsSync(app), false, 'nothing was created');
  }
});

test('GUARD create(): with no models there is no model action, and no modelUrl is needed', async () => {
  const A = actmod.create({ prisma, appDir: tmp('nomodels'), log: { error() {}, warn() {} }, env: {}, daemon: true });
  try { assert.equal(A.bus.names.resolve('model', 'm'), null); } finally { await A.stop(); }
});

const KNOWN = 'prisma, models, modelUrl, productName, appDir, fetchImpl, log, actionsDir, env, daemon, mailTls, triggersFile, clock';
test('FAIL-FIRST create(): an option name it does not know is refused, with the list of known names, before anything is created', () => {
  for (const [name, shown] of [['modelURL', 'modelURL'], ['temperature', 'temperature'], ['__proto__', '__proto__'], ['a\nb\u2028' + 'x'.repeat(200), 'ab' + 'x'.repeat(38)], ['"; rm -rf /', 'rmrf']]) {
    const app = path.join(tmp('unknown'), 'app');
    assert.throws(() => actmod.create({ prisma, models: {}, modelUrl: 'http://127.0.0.1:9', appDir: app, log: { error() {}, warn() {} }, env: {}, [name]: 1 }),
      { message: 'create(): unknown option "' + shown + '" — the options are ' + KNOWN });
    assert.equal(fs.existsSync(app), false, 'nothing was created');
  }
  assert.throws(() => actmod.create(null), { message: 'create(): the options must be an object' });
});

test('GUARD the model action with no usable modelUrl answers a plain refusal, not a TypeError, and makes no request — reached without create()', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; throw new Error('no request may be made'); };
  for (const modelUrl of [undefined, '', '   ', 42]) {
    await assert.rejects(actmod.modelAdapter({ modelUrl, fetchImpl })({ model: 'm', prompt: 'p' }),
      (e) => e.constructor === Error && e.message === 'the model action has no model server address: the host did not pass modelUrl to create()');
  }
  assert.equal(calls, 0, 'no request was made');
});
