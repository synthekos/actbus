// fetch.js — v1.2.1 · read one web page from an allow-listed host · changelog: act/CHANGELOG.md#actactionsfetchjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// TENTACLE: read a web page from an allow-listed host (ACTBUS docs/capability-architecture.md §1 item 3)
// Input { url: "https://host/path" }. Only http(s); the host must be in the targets that EVERY identity in the chain was
// granted (intersection). Redirects are NOT followed (a redirect could leave the allow-list) — a 3xx is returned as is.
// No credentials, no cookies, GET only. Body capped at 1 MB. Output labelled "web": the bus will not let it reach a
// world action without an explicit rule. A world action itself: its URL may not come from model or web text unless
// allowed, because a URL can carry data out (exfiltration).
'use strict';
const MAX = 1024 * 1024;

async function run(input, ctx) {
  let u;
  try { u = new URL(String(input.url)); } catch { throw new Error('not a valid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('only http and https are allowed');
  if (u.username || u.password) throw new Error('URLs with credentials are refused');
  const host = u.hostname.toLowerCase();
  // 1.1.0: a target "host" allows only the scheme's default port; "host:port" allows that port (an allowed host's other
  // ports — an admin console, a database — are not reachable by default)
  const hp = u.port ? host + ':' + u.port : host;
  const want = u.protocol === 'http:' ? 'http://' + hp : hp;   // 1.2.0 (F09): plain http only where the grant says http:// explicitly
  const targets = (ctx.grant.targets || []).map((t) => String(t).toLowerCase());
  if (!targets.includes(want)) throw new Error((u.protocol === 'http:' ? 'plain http to ' : u.port ? 'host and port ' : 'host ') + want + ' is not on the allow-list for ' + ctx.authority.join(' → ') + ' (allowed: ' + (targets.join(', ') || 'none') + ')');
  const r = await ctx.fetch(u.toString(), { method: 'GET', redirect: 'manual', credentials: 'omit', headers: { 'User-Agent': ctx.product + '-fetch/1.0' } });   // 1.2.1 (v0.53.6): the host's name, from the bus
  let text = '';
  if (r.body && typeof r.body.getReader === 'function') {
    const reader = r.body.getReader(); const parts = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX) { try { reader.cancel(); } catch {} break; } parts.push(value); }
    text = Buffer.concat(parts.map((p) => Buffer.from(p))).toString('utf8').slice(0, MAX);
  } else text = String(await r.text()).slice(0, MAX);
  return { status: r.status, host, text, truncated: text.length >= MAX };
}

module.exports = { run };
