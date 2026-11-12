// edge.js — v1.0.3 · POST /api/act: where outside callers enter the bus · changelog: act/CHANGELOG.md#actcoreedgejs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// POST /api/act — where outside callers (EUsers, devices, apps) enter the bus
//   POST /api/act   Authorization: Bearer <key>   { "action": "calc", "input": { "expr": "4837 * 2919" }, "labels": [], "id": "…" }
// The key decides the identity (resolveKey: key → identity name, or null). The caller may ADD labels (e.g. declare that
// its text came from the web) but can never remove the label its identity kind earns. "id" is optional; sending the same
// id twice runs once (the second is refused DUPLICATE — safe retries). The reply is the bus reply, as JSON:
//   { ok: true, action, basis, labels, value, sha256, id, trace }   or   { ok: false, code, error, id, trace }
// Works as a plain node:http handler and as an Express handler (it reads the body itself unless req.body is set).
'use strict';
const crypto = require('crypto');
const { ERR } = require('./bus');

const RETRY_AFTER_S = 5;   // 1.0.2: seconds an EUser client should wait after a transient refusal (= the scheduler's first rung)
// 1.0.3 (v0.54.3): a refusal that knows when it clears (DEDUPE_FULL: when the identity's oldest id leaves the window) says so —
// whole seconds, rounded up, at least 1; one that does not keeps 5 s
const retryAfter = (r) => String(Number.isFinite(r && r.retryAfterMs) ? Math.max(1, Math.ceil(r.retryAfterMs / 1000)) : RETRY_AFTER_S);
const STATUS = { [ERR.BAD_ENVELOPE]: 400, [ERR.BAD_INPUT]: 400, [ERR.UNKNOWN_IDENTITY]: 401, [ERR.NOT_PERMITTED]: 403, [ERR.TAINTED]: 403, [ERR.NO_TARGET]: 403,
  [ERR.UNKNOWN_ACTION]: 404, [ERR.DUPLICATE]: 409, [ERR.ACTION_ERROR]: 422, [ERR.RATE]: 429, [ERR.BUDGET]: 429, [ERR.HOP_LIMIT]: 429,
  [ERR.AUDIT]: 500, [ERR.NO_ROUTE]: 502, [ERR.TIMEOUT]: 504,
  [ERR.DAEMON_FULL]: 503, [ERR.DAEMON_EVICTING]: 503, [ERR.DAEMON_OVERLAP]: 503, [ERR.DAEMON_PAUSED]: 503, [ERR.DAEMON_RESTARTING]: 503, [ERR.DEDUPE_FULL]: 503 };   // 1.0.2
const MAX_BODY = 300 * 1024;

// key → identity, by the key's sha256 (the box stores hashes, never keys — like a host that stores only key hashes)
function keyResolver(hashToIdentity) {
  const m = new Map(Object.entries(hashToIdentity));
  return (key) => (key ? m.get(crypto.createHash('sha256').update(String(key)).digest('hex')) || null : null);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(req.body);
    let n = 0; const parts = [];
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('body larger than 300 KB'), { status: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('body must be JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function createEdge({ bus, resolveKey }) {
  const send = (res, status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); if (obj && obj.transient === true) res.setHeader('Retry-After', retryAfter(obj)); res.end(JSON.stringify(obj)); };
  return async function act(req, res) {
    if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'METHOD', error: 'POST only' });
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    const who = resolveKey(m && m[1]);
    if (!who) return send(res, 401, { ok: false, code: ERR.UNKNOWN_IDENTITY, error: 'a valid key is required (Authorization: Bearer <key>)' });
    let body;
    try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { ok: false, code: ERR.BAD_ENVELOPE, error: e.message }); }
    if (!body || typeof body !== 'object' || typeof body.action !== 'string') return send(res, 400, { ok: false, code: ERR.BAD_ENVELOPE, error: 'body must be { "action": "…", "input": { … } }' });
    const r = await bus.ask(who, body.action, body.input === undefined ? {} : body.input, { labels: Array.isArray(body.labels) ? body.labels : [], id: typeof body.id === 'string' ? body.id : undefined });
    return send(res, r.ok ? 200 : (STATUS[r.code] || 400), r);
  };
}

module.exports = { createEdge, keyResolver, STATUS, RETRY_AFTER_S, retryAfter };
