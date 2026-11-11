// smtp.js — v1.1.0 · a minimal SMTP client with STARTTLS and no dependencies · changelog: act/CHANGELOG.md#actmailsmtpjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// our own minimal SMTP client, zero dependencies (slice 3: ACTBUS docs/capability-architecture.md §7 item 3) — the first mail delivery adapter
// One message, one recipient, text only:  220 → EHLO → STARTTLS → (TLS, certificate CHECKED) → EHLO → AUTH PLAIN → MAIL FROM →
// RCPT TO → DATA (RFC 5322 headers, UTF-8 subject encoded, body quoted-printable, CRLF line ends, dot-stuffed) → QUIT.
// Rules that do not bend:
//   · no STARTTLS offered → refused BEFORE any credential is sent (no plain-text fallback, ever);
//   · the server's certificate is verified by Node's default (rejectUnauthorized is never turned off; a test passes its own CA);
//   · the password is never written to the log: the AUTH line is logged as "AUTH PLAIN [redacted]".
// send(cfg, msg) → { ok, code, reply, stage, temporary }   — never throws for a mail failure
//   temporary: true for a 4xx reply or a network failure (the outbox retries), false for a 5xx or a security refusal (it does not)
// fromEnv(env, { productName }) → an adapter { name, send(record) } or null when the settings are not all there (null = delivery OFF)
//   settings: MAIL_HOST, MAIL_USER, MAIL_APP_PASSWORD, MAIL_FROM (all four needed); MAIL_PORT (default 587); MAIL_HELO (the name sent
//   with EHLO — a host name or an IPv4 address literal like [192.0.2.1]; default: this machine's host name, or [127.0.0.1] when it has none)
//   stated limit: an IPv6 address literal ([IPv6:…]) is refused at start
'use strict';
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const os = require('os');
const { DEFAULT, productName: checkProduct } = require('../core/product');

const ADDR = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;   // the same strict shape the email action checks
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const HELO = new RegExp('^(?:\\[(?:\\d{1,3}\\.){3}\\d{1,3}\\]|' + LABEL + '(?:\\.' + LABEL + ')*)$');   // 1.1.0: MAIL_HELO — a host name or an IPv4 address literal

// ── message building ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const crlf = (s) => String(s).replace(/\r\n|\r|\n/g, '\r\n');
function encodeHeader(s) {                                         // RFC 2047 for anything outside printable ASCII
  s = String(s).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const out = []; let chunk = '';
  for (const ch of s) {                                            // whole characters per encoded word (≤ 45 bytes → ≤ 75 chars)
    if (Buffer.byteLength(chunk + ch) > 45) { out.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk) out.push(chunk);
  return out.map((c) => '=?UTF-8?B?' + Buffer.from(c, 'utf8').toString('base64') + '?=').join('\r\n ');
}
function qp(text) {                                                // quoted-printable (RFC 2045), lines ≤ 76, soft breaks "="
  const lines = String(text).replace(/\r\n|\r/g, '\n').split('\n');
  return lines.map((line) => {
    const b = Buffer.from(line, 'utf8'); let enc = '';
    for (let i = 0; i < b.length; i++) {
      const c = b[i], last = i === b.length - 1;
      enc += (c >= 33 && c <= 126 && c !== 61) || ((c === 32 || c === 9) && !last) ? String.fromCharCode(c) : '=' + c.toString(16).toUpperCase().padStart(2, '0');
    }
    const parts = [];
    while (enc.length > 76) {
      let cut = 75; if (enc[cut - 1] === '=') cut -= 1; else if (enc[cut - 2] === '=') cut -= 2;   // never split an =XX
      parts.push(enc.slice(0, cut) + '='); enc = enc.slice(cut);
    }
    parts.push(enc);
    return parts.join('\r\n');
  }).join('\r\n');
}
function rfcDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()], M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return D + ', ' + p(d.getUTCDate()) + ' ' + M + ' ' + d.getUTCFullYear() + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' +0000';
}
function build({ from, to, subject, text, date = new Date(), messageId, product = DEFAULT }) {
  const dom = String(from).split('@')[1];
  const head = [
    'From: ' + from, 'To: ' + to, 'Subject: ' + encodeHeader(subject), 'Date: ' + rfcDate(date),
    'Message-ID: <' + (messageId || crypto.randomBytes(12).toString('hex')) + '@' + dom + '>',
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', 'X-Mailer: ' + product,
  ];
  return head.join('\r\n') + '\r\n\r\n' + qp(text);
}
const dotStuff = (data) => crlf(data).split('\r\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n');

// ── the conversation ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function send(cfg, msg) {
  const { host, port = 587, user, pass, from, timeoutMs = 30000, tlsOptions = {}, log = () => {}, product = DEFAULT } = cfg;
  const helo = cfg.helo || os.hostname() || '[127.0.0.1]';   // 1.1.0 (v0.53.6): MAIL_HELO, else the host name, else an address literal (RFC 5321 §4.1.3)
  return new Promise((resolve) => {
    let sock = net.connect({ host, port });
    let buf = '', waiting = null, stage = 'connect', finished = false;
    const timer = setTimeout(() => finish({ ok: false, code: 0, reply: 'no answer within ' + timeoutMs + ' ms', temporary: true }), timeoutMs);
    function finish(r) {
      if (finished) return; finished = true; clearTimeout(timer);
      try { sock.destroy(); } catch { /* gone */ }
      resolve({ stage, ...r });
    }
    function onData(d) {
      buf += d.toString('utf8');
      if (buf.length > 65536) return finish({ ok: false, code: 0, reply: 'the server sent more than 64 KB without ending a reply', temporary: true });
      for (;;) {                                                   // a reply ends at a line "NNN text" (not "NNN-text")
        const m = buf.match(/^(?:\d{3}-[^\r\n]*\r?\n)*(\d{3})(?: [^\r\n]*)?\r?\n/);
        if (!m) return;
        const reply = m[0].replace(/\r?\n$/, ''); buf = buf.slice(m[0].length);
        log('S: ' + reply.replace(/\r?\n/g, ' | '));
        if (waiting) { const w = waiting; waiting = null; w({ code: +m[1], reply }); }
      }
    }
    const listen = (s) => { s.on('data', onData); s.on('error', (e) => finish({ ok: false, code: 0, reply: String(e.message || e), temporary: !/certificate|self.signed|CERT|UNABLE_TO|hostname/i.test(String(e.code || '') + ' ' + e.message) })); s.on('close', () => finish({ ok: false, code: 0, reply: 'the server closed the connection', temporary: true })); };
    listen(sock);
    const next = () => new Promise((r) => { waiting = r; });
    const say = (line, shown) => { log('C: ' + (shown || line)); sock.write(line + '\r\n'); return next(); };
    const want = (r, ok, st) => { stage = st; if (ok.includes(r.code)) return true; finish({ ok: false, code: r.code, reply: r.reply, temporary: r.code >= 400 && r.code < 500 }); return false; };

    (async () => {
      if (!ADDR.test(String(msg.to || '')) || !ADDR.test(String(from || ''))) { stage = 'check'; return finish({ ok: false, code: 0, reply: 'not a plain address (to or from) — nothing was sent', temporary: false }); }
      if (!want(await next(), [220], 'greeting')) return;
      let r = await say('EHLO ' + helo);
      if (!want(r, [250], 'ehlo')) return;
      if (!/^250[ -]STARTTLS\b/im.test(r.reply)) { stage = 'starttls'; return finish({ ok: false, code: 0, reply: 'the server does not offer STARTTLS — refused before any credential was sent', temporary: false }); }
      if (!want(await say('STARTTLS'), [220], 'starttls')) return;
      sock.removeAllListeners('data'); sock.removeAllListeners('error'); sock.removeAllListeners('close');
      buf = ''; stage = 'tls';
      const plain = sock;
      await new Promise((ok) => {
        sock = tls.connect({ ...tlsOptions, socket: plain, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: true }, ok);
        listen(sock); sock.once('close', ok);                       // a failed handshake: finish() has already answered
      });
      if (finished) return;
      log('C: [TLS ' + sock.getProtocol() + ', certificate verified]');
      if (!want(await say('EHLO ' + helo), [250], 'ehlo-tls')) return;
      const token = Buffer.from('\0' + user + '\0' + pass, 'utf8').toString('base64');
      if (!want(await say('AUTH PLAIN ' + token, 'AUTH PLAIN [redacted]'), [235], 'auth')) return;
      if (!want(await say('MAIL FROM:<' + from + '>'), [250], 'mail-from')) return;
      if (!want(await say('RCPT TO:<' + msg.to + '>'), [250, 251], 'rcpt-to')) return;
      if (!want(await say('DATA'), [354], 'data')) return;
      const body = dotStuff(build({ from, ...msg, product }));
      log('C: [message, ' + Buffer.byteLength(body) + ' bytes]');
      sock.write(body + '\r\n.\r\n');
      const end = await next();
      if (!want(end, [250], 'message')) return;
      try { await Promise.race([say('QUIT'), new Promise((r) => setTimeout(r, 2000))]); } catch { /* the message is already accepted */ }
      finish({ ok: true, code: end.code, reply: end.reply, temporary: false });
    })().catch((e) => finish({ ok: false, code: 0, reply: String(e && e.message || e), temporary: true }));
  });
}

// the adapter the outbox uses; the secret lives only in this closure (never in a record, an audit line or a log)
function fromEnv(env = process.env, { log, tlsOptions, productName } = {}) {
  const product = checkProduct(productName);
  const need = ['MAIL_HOST', 'MAIL_USER', 'MAIL_APP_PASSWORD', 'MAIL_FROM'];
  if (need.some((k) => !env[k])) return null;
  if (!ADDR.test(env.MAIL_FROM)) throw new Error('MAIL_FROM is not a plain address');
  const port = env.MAIL_PORT ? Number(env.MAIL_PORT) : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MAIL_PORT must be a port number');
  const helo = env.MAIL_HELO || undefined;
  if (helo !== undefined && (helo.length > 253 || !HELO.test(helo))) throw new Error('MAIL_HELO must be a host name or an address literal like [192.0.2.1]');
  const cfg = Object.freeze({ host: env.MAIL_HOST, port, user: env.MAIL_USER, pass: env.MAIL_APP_PASSWORD, from: env.MAIL_FROM, log, tlsOptions, product, helo });
  return Object.freeze({ name: 'smtp ' + cfg.host + ':' + port, from: cfg.from, send: (rec) => send(cfg, { to: rec.to, subject: rec.subject, text: rec.text, messageId: rec.id }) });
}

module.exports = { send, fromEnv, build, qp, encodeHeader, dotStuff, rfcDate, ADDR };
