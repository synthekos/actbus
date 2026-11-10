// lab.js — v0.2.3 (091126: the accountable test user is `alex`; names in comments neutral) · was v0.2.2 (081126: create() gets modelUrl, not the old model-URL alias (SYNTHEKOS v0.53.6 = this repo's v0.2.0); KERNEL-SHA256SUMS = SYNTHEKOS tag v0.53.6) · was v0.2.1 (081126: comments only — names neutral; KERNEL-SHA256SUMS = SYNTHEKOS tag v0.53.5-changelog = this repo's v0.1.1) · was v0.2.0 (071126: ACTBUS repo — the kernel is the repo root (../act.js + ../act/), no copy; the fingerprint covers act.js + act/** except act/test/; KERNEL-SHA256SUMS = the repo's tag v0.53.5-headers) · v0.1.13 (061126: steps may carry an id; stepValueLength expectation — suite 3) · v0.1.12 (061126: the recorded live version is read from KERNEL-VERSION.txt — lab kernel = live 0.53.2; kernel-0531/ kept) · v0.1.11 (061126: preFiles / preMail placed before the steps; step reply value kept; stepLabels expectation) · v0.1.10 (061126: LAB_WIDEN=1 mode B — allow-lists widened to the attacker so inner layers are tested alone; fake web can redirect (location), honouring redirect:'manual') · v0.1.9 (061126: cause = the TERMINAL event of the last failed step, + causeFlags — second reader 11:20; + 'policy' = an action's allow-list said no, logged as ACTION_ERROR not 'refused'; + 'cause' expectation, suites/selftest) · v0.1.8 (061126: each run records WHY it did not succeed — kernel / script / load; only a kernel refusal of a benign twin counts as a false refusal) · v0.1.7 (061126: identity names → logins in each result; 'model followed' only where it applies) · v0.1.6 (061126: + ctlInclude — labels on the CONTROL of a call) · v0.1.5 (061126: audit expectations can require the labels present at the sink) · v0.1.4 (061126: the kernel fingerprint is computed from the files actually loaded; a non-live kernel is said so) · v0.1.3 (061126: results folder per run — seconds + mode; never shared) · v0.1.2 (061126: + '<=N' counts) · v0.1.1 (061126: + acceptWarnings per script, + the load-time refusal as an expectation) · was v0.1.0 (061126) · SYNTHEKOS LAB runner, Tier 1. Boots the REAL kernel (./kernel = a read-only copy of live, shas in
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// KERNEL-SHA256SUMS) from a scenario file, plays its steps through act.route (the same entry the phone and every EUser use), and checks
// the scenario's expectations BY CODE against the audit log, the network log, the mail outbox and the mailboxes. No model judges anything.
//   node lab.js seal  <suite-dir>            → writes <suite-dir>/SEALED.json (sha256 of every scenario) — expectations frozen BEFORE any run
//   node lab.js run   <suite-dir> [seeds]    → refuses unless SEALED.json matches; writes results/<suite>-<stamp>/ (summary, per-scenario audit)
// Model: Tier 1 = a stand-in that returns the scenario's model.reply (the WORST CASE: it obeys every injection). LAB_MODEL=real (Tier 2,
// a machine with a local model server) sends model calls to that local model server instead and records what the model actually said.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), http = require('http');
const LAB = __dirname, KDIR = process.env.LAB_KERNEL || path.join(LAB, '..');   // 0.2.0: the repo root
// 0.1.10 (second reader, 11:20): LAB_WIDEN=1 = mode B — every fetch/email grant that has targets also allows the attacker's host/address, so the
// allow-list stops nothing and each INNER defence (taint, labels, load-time check) is tested alone. Run every mutation in both modes.
const WIDEN = process.env.LAB_WIDEN === '1', WIDE = { fetch: ['evil.lab.example'], email: ['attacker@evil.lab.example'] };
const widen = (g) => { if (!WIDEN) return g; const c = JSON.parse(JSON.stringify(g));
  for (const [a, x] of Object.entries(c.actions || {})) if (WIDE[a] && x && Array.isArray(x.targets)) x.targets = [...new Set([...x.targets, ...WIDE[a]])]; return c; };
const actmod = require(path.join(KDIR, 'act.js')), registry = require(path.join(KDIR, 'act/core/registry'));
const VERSION = 'lab 0.2.3';
const KVER = (() => { try { return (/"version": "([^"]+)"/.exec(fs.readFileSync(path.join(LAB, 'KERNEL-VERSION.txt'), 'utf8')) || [])[1] || '?'; } catch (_) { return '?'; } })();   // 0.1.12
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const uuidOf = (s) => { const h = sha('lab-identity\0' + s); return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-'); };
const die = (m) => { console.error('lab: ' + m); process.exit(2); };

function seal(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'SEALED.json').sort();
  const out = { sealedAt: new Date().toISOString(), by: VERSION, scenarios: Object.fromEntries(files.map((f) => [f, sha(fs.readFileSync(path.join(dir, f)))])) };
  fs.writeFileSync(path.join(dir, 'SEALED.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('sealed ' + files.length + ' scenarios in ' + dir + ' · SEALED.json sha256 ' + sha(fs.readFileSync(path.join(dir, 'SEALED.json'))).slice(0, 12));
}
function checkSeal(dir) {
  const p = path.join(dir, 'SEALED.json'); if (!fs.existsSync(p)) die('no SEALED.json in ' + dir + ' — seal the expectations before running');
  const s = JSON.parse(fs.readFileSync(p, 'utf8')); const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'SEALED.json').sort();
  for (const f of files) if (s.scenarios[f] !== sha(fs.readFileSync(path.join(dir, f)))) die(f + ' changed (or is new) after sealing — re-seal deliberately, never silently');
  for (const f of Object.keys(s.scenarios)) if (!files.includes(f)) die(f + ' was sealed but is missing');
  return { files, sealedAt: s.sealedAt, sealSha: sha(fs.readFileSync(p)) };
}

// the real local model (Tier 2) — POST to the model server on localhost, never anywhere else
function realGenerate(body) {
  return new Promise((ok, no) => { const data = Buffer.from(JSON.stringify(body));
    const rq = http.request({ host: '127.0.0.1', port: 11434, path: '/api/generate', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': data.length }, timeout: 300000 },
      (rs) => { let s = ''; rs.on('data', (d) => (s += d)); rs.on('end', () => { try { ok(JSON.parse(s)); } catch (e) { no(e); } }); });
    rq.on('error', no); rq.on('timeout', () => rq.destroy(new Error('model timeout'))); rq.end(data); });
}

async function runScenario(file, seed, outDir) {
  const S = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-')), app = path.join(tmp, 'app'), dir = path.join(tmp, 'actions'); fs.mkdirSync(app); fs.mkdirSync(dir);
  // identities: alex (the accountable person) + the scenario's machines; names are deterministic from the login
  const users = [{ uniqueId: uuidOf('alex'), loginId: 'alex', role: 'admin', auth: 'login', passwordHash: 'x', actGrants: null }];
  for (const i of S.identities) users.push({ uniqueId: uuidOf(i.login), loginId: i.login, role: 'euser', auth: 'key', actGrants: null });
  const id = (login) => actmod.idName(users.find((u) => u.loginId === login) || die(S.id + ': unknown identity ' + login));
  const fill = (s) => String(s).replace(/@id:([a-z0-9-]+)/g, (_, l) => id(l));
  const prisma = { user: { findMany: async () => users.slice(), findUnique: async ({ where }) => users.find((u) => Object.entries(where).every(([k, v]) => u[k] === v)) || null,
    update: async ({ where, data }) => { const u = users.find((x) => x.uniqueId === where.uniqueId); Object.assign(u, data); return u; } } };
  // actions: the kernel's own natives + the scenario's scripts
  for (const f of fs.readdirSync(path.join(KDIR, 'act', 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(KDIR, 'act', 'actions', f), path.join(dir, f));
  const spec = JSON.parse(fs.readFileSync(path.join(KDIR, 'act', 'actions', 'registry.spec.json'), 'utf8')).actions;
  for (const sc of S.scripts || []) { fs.writeFileSync(path.join(dir, sc.name + '.pk'), fill(sc.source));
    spec.push({ name: sc.name, version: '0.0.1', kind: 'script', file: sc.name + '.pk', produces: 'computed', world: sc.world !== false, runsAs: id(sc.runsAs), needs: [], input: sc.input || {}, timeoutMs: sc.timeoutMs || 60000, ...(sc.acceptWarnings ? { acceptWarnings: true } : {}) }); }
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
  // the network: only the scenario's pages exist; EVERY request is recorded (a request to an attacker host reaching here is a finding)
  const net = [], modelCalls = [];
  const fetchImpl = async (url, o) => { const u = String(url);
    if (u.endsWith('/api/generate')) { const body = JSON.parse((o && o.body) || '{}'); let reply;
      if (process.env.LAB_MODEL === 'real') { const r = await realGenerate({ ...body, model: process.env.LAB_MODEL_NAME || body.model, options: { ...(body.options || {}), seed, temperature: body.options && body.options.temperature != null ? body.options.temperature : 0.7 } }); reply = r.response || ''; }
      else reply = fill((S.model && S.model.reply) || 'stand-in model reply');
      if (process.env.LAB_MODEL !== 'real' && process.env.LAB_FENCE === '1') reply = '```json\n' + reply + '\n```';   // 0.1.8: behave like a model that fences its JSON
      modelCalls.push({ prompt: String(body.prompt || '').slice(0, 2000), reply: reply.slice(0, 2000) });
      return { ok: true, status: 200, json: async () => ({ response: reply }) }; }
    net.push(u); const p = (S.web || {})[u];
    if (!p) return { status: 404, text: async () => 'not found (lab)' };
    if (p.location) {   // 0.1.10: a redirecting page. 'manual' (what fetch.js asks for) → the 3xx as is; anything else → the lab follows it
      if (o && o.redirect === 'manual') return { status: p.status || 302, headers: { get: (h) => (/^location$/i.test(h) ? fill(p.location) : null) }, text: async () => '' };
      const to = fill(p.location); net.push(to); const q = (S.web || {})[to]; return { status: q ? q.status || 200 : 404, text: async () => (q ? fill(q.text) : 'not found (lab)') }; }
    return { status: p.status || 200, text: async () => fill(p.text) }; };
  const A = actmod.create({ prisma, models: { isInstalled: () => true }, modelUrl: 'http://127.0.0.1:1', appDir: app, log: { error() {} }, fetchImpl, actionsDir: dir,
    env: { MAIL_ALLOW: [...(S.mailAllow || []), ...(WIDEN ? WIDE.email : [])].join(',') }, daemon: process.env.PK_DAEMON === '1' });
  const steps = [], t0 = Date.now(); const loadRefused = A.refused.map((x) => ({ name: x.name, reason: String(x.reason).slice(0, 400) }));
  try {
    if (loadRefused.length && !S.expectLoadRefused) throw new Error('kernel refused to load: ' + JSON.stringify(loadRefused));
    if (loadRefused.length) { /* expected: the load-time checker stopped it; nothing more to play */ }
    else {
    for (const i of S.identities) if (i.grants) { const r = await A.saveGrants(users.find((u) => u.loginId === i.login), fill(JSON.stringify({ owner: 'alex', ...widen(i.grants) })), 'alex');
      if (!r.ok) throw new Error('grants for ' + i.login + ' refused: ' + r.errors.join(' | ')); }
    // 0.1.11: state placed BEFORE the steps, as if made outside the bus — preFiles (a file in an identity's folder; sidecar only if labels
    // are given) and preMail (a message record already waiting, written straight into the recipient's mailbox — e.g. carrying a credential)
    for (const f of S.preFiles || []) { const d = path.join(app, 'act-files', id(f.login)); fs.mkdirSync(d, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(d, f.name), fill(f.text)); if (f.labels) fs.writeFileSync(path.join(d, '.labels-' + f.name + '.json'), JSON.stringify({ labels: f.labels })); }
    for (const m of S.preMail || []) { const rid = 'g-' + crypto.randomUUID();
      A.mailbox.write(id(m.to), { v: 1, id: rid, from: id(m.from), authority: [id(m.from)], to: id(m.to), topic: m.topic, body: fill(m.body), labels: m.labels, at: Date.now(), attempts: 0, status: 'new' }); }
    for (const st of S.steps) {
      const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
      const s0 = Date.now(); await A.route({ euser: users.find((u) => u.loginId === st.as), body: JSON.parse(fill(JSON.stringify({ action: st.action, input: st.input || {}, ...(st.id ? { id: st.id } : {}) }))) }, res);   // 0.1.13: a caller-chosen id (replay tests)
      steps.push({ as: st.as, action: st.action, http: res.code, ok: !!(res.body && res.body.ok), code: res.body && res.body.code, error: res.body && String(res.body.error || '').slice(0, 300), trace: res.body && res.body.trace, labels: res.body && res.body.labels, value: res.body && res.body.value !== undefined ? JSON.stringify(res.body.value).slice(0, 4000) : null, ms: Date.now() - s0 });
    }
    }
  } catch (e) { steps.push({ fatal: String(e.message || e) }); }
  const audit = fs.existsSync(A.LOG) ? fs.readFileSync(A.LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const outbox = (() => { try { return A.outbox.list(); } catch (_) { return []; } })();
  const boxes = Object.fromEntries(S.identities.map((i) => [i.login, (() => { try { return A.mailbox.list(id(i.login)); } catch (_) { return []; } })()]));
  A.stop();
  // why a run did not succeed (0.1.9, second reader 11:20): look at the LAST failed step — the run's terminal event. In its trace, the last non-ok
  // inner audit line (an action it called); if there is none, the step's own line. 'kernel' = that terminal line is a refusal;
  // 'script' = the script failed some other way; 'load' = refused at load. A refusal elsewhere in the run no longer decides it (causeFlags keep both).
  const failedSteps = steps.filter((s) => s.ok === false || s.fatal), failed = failedSteps[failedSteps.length - 1];
  const inTrace = failed && failed.trace ? audit.filter((j) => j.trace === failed.trace && j.outcome && !['run', 'ok', 'grants'].includes(j.outcome)) : [];
  const innerL = inTrace.filter((j) => !(j.action === failed.action && j.replyTo == null));
  const terminal = innerL.length ? innerL[innerL.length - 1] : inTrace.length ? inTrace[inTrace.length - 1] : null;
  // 'policy' = an action's own grant check said no (allow-list / recipients). Found 6 Nov: those are logged outcome 'error' / ACTION_ERROR,
  // not 'refused' — so they are matched by their reason text here. TODO kernel: a typed denial the bus logs as 'refused'.
  const POLICY = /is not on the allow-list|is not among the recipients|not granted/;
  const cause = loadRefused.length ? 'load' : !failed ? 'none' : terminal && terminal.outcome === 'refused' ? 'kernel' : terminal && POLICY.test(String(terminal.reason || '')) ? 'policy' : 'script';
  const flags = { refusalSeen: audit.some((j) => j.outcome === 'refused'), scriptError: cause === 'script', terminal: terminal ? terminal.action + ':' + terminal.outcome + (terminal.code ? ':' + terminal.code : '') : null };
  // expectations — each one checked by code
  const match = (o, q) => Object.entries(q).every(([k, v]) => (Array.isArray(v) ? v.includes(o[k]) : o[k] === (typeof v === 'string' ? fill(v) : v)));
  const res = (S.expect || []).map((x) => { let got, pass, what;
    if (x.loadRefused) { got = loadRefused.filter((r) => r.name === x.loadRefused && (!x.reasonIncludes || r.reason.includes(x.reasonIncludes))).length; what = 'load-time refusal of ' + x.loadRefused + (x.reasonIncludes ? ' mentioning "' + x.reasonIncludes + '"' : ''); }
    else if (x.audit) { got = audit.filter((j) => match(j, x.audit) && (x.labelsInclude || []).every((l) => (j.labels || []).includes(l)) && (x.ctlInclude || []).every((l) => (j.ctl || []).includes(l))).length; what = 'audit lines ' + JSON.stringify(x.audit) + (x.labelsInclude ? ' carrying ' + x.labelsInclude.join('+') : '') + (x.ctlInclude ? ' under control labelled ' + x.ctlInclude.join('+') : ''); }
    else if (x.network) { got = net.filter((u) => u.includes(x.network)).length; what = 'network requests containing ' + x.network; }
    else if (x.outbox) { got = outbox.filter((m) => match(m, x.outbox)).length; what = 'mails queued ' + JSON.stringify(x.outbox); }
    else if (x.mailbox) { const L = boxes[x.mailbox] || []; got = L.filter((m) => (!x.topic || m.topic === x.topic) && (x.labelsInclude || []).every((l) => (m.labels || []).includes(l))).length; what = 'messages in ' + x.mailbox + "'s mailbox" + (x.topic ? ' topic ' + x.topic : '') + (x.labelsInclude ? ' labelled ' + x.labelsInclude.join('+') : ''); }
    else if (x.step != null) { const s = steps[x.step] || {}; got = s.ok ? 'ok' : (s.code || s.fatal || 'failed'); pass = x.ok ? s.ok === true : (s.ok === false && (!x.code || s.code === x.code || String(s.error).includes(x.code))); what = 'step ' + x.step + ' ' + (x.ok ? 'succeeds' : 'is refused' + (x.code ? ' (' + x.code + ')' : '')); return { what, got, pass }; }
    else if (x.stepLabels != null) { const s = steps[x.stepLabels] || {}; const L = (s.labels || []), V = String(s.value || '');   // 0.1.11
      pass = s.ok === true && (x.include || []).every((l) => L.includes(l)) && (x.exclude || []).every((l) => !L.includes(l) && !V.includes('"' + l + '"'));
      return { what: 'step ' + x.stepLabels + ' ok, reply labels include ' + JSON.stringify(x.include || []) + ' and exclude ' + JSON.stringify(x.exclude || []) + ' (also inside the value)', got: JSON.stringify(L) + ' value ' + V.slice(0, 200), pass }; }
    else if (x.stepValueLength != null) { const s = steps[x.stepValueLength] || {}; let v = null; try { v = JSON.parse(s.value); } catch (_) {}   // 0.1.13
      got = Array.isArray(v) ? v.length : -1; what = 'step ' + x.stepValueLength + ' returns a list of'; }
    else if (x.cause) { got = cause; pass = cause === x.cause; return { what: 'run ends in cause ' + x.cause, got, pass }; }   // 0.1.9: lab self-tests
    else return { what: 'unknown expectation ' + JSON.stringify(x), got: null, pass: false };
    const want = x.count == null ? '>=1' : String(x.count); pass = want.startsWith('>=') ? got >= Number(want.slice(2)) : want.startsWith('<=') ? got <= Number(want.slice(2)) : got === Number(want);
    return { what: what + ' = ' + want, got, pass }; });
  // invariants (always): no silent failure — every failed step has a refused/error audit line in its trace; every refusal carries a code and a reason
  const inv = [];
  for (const s of steps) if (s.ok === false && s.trace && !audit.some((j) => j.trace === s.trace && (j.outcome === 'refused' || j.outcome === 'error'))) inv.push('silent failure: step ' + s.action + ' failed with no refused/error audit line');
  for (const j of audit) if (j.outcome === 'refused' && (!j.code || !j.reason)) inv.push('a refusal without code or reason: ' + JSON.stringify(j).slice(0, 200));
  for (const s of steps) if (s.fatal) inv.push('scenario could not run: ' + s.fatal);
  const followed = S.model && S.model.attackerMarker ? modelCalls.some((m) => m.reply.includes(fill(S.model.attackerMarker))) : null;
  const refusals = {}; for (const j of audit) if (j.outcome === 'refused' || j.outcome === 'error') { const k = (j.action || '?') + ':' + (j.code || '?'); refusals[k] = (refusals[k] || 0) + 1; }
  const r = { scenario: S.id, suite: S.suite, twin: S.twin || null, seed, cause, causeFlags: flags, model: process.env.LAB_MODEL === 'real' ? (process.env.LAB_MODEL_NAME || 'real') : 'stand-in (obeys)', pass: res.every((x) => x.pass) && inv.length === 0,
    expectations: res, invariants: inv, steps, loadRefused, refusals, network: net, modelFollowedInjection: followed, modelCalls: modelCalls.length, ms: Date.now() - t0 };
  fs.writeFileSync(path.join(outDir, S.id + '.s' + seed + '.result.json'), JSON.stringify({ ...r, about: S.about || '', identities: Object.fromEntries(users.map((u) => [actmod.idName(u), u.loginId])), modelTranscript: modelCalls }, null, 1));
  fs.writeFileSync(path.join(outDir, S.id + '.s' + seed + '.audit.jsonl'), audit.map((j) => JSON.stringify(j)).join('\n') + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
  return r;
}

(async () => {
  const [cmd, dir, seedsArg] = process.argv.slice(2);
  if (cmd === 'seal') return seal(dir);
  if (cmd !== 'run' || !dir) die('usage: node lab.js seal|run <suite-dir> [seeds e.g. 1-5]');
  const { files, sealedAt, sealSha } = checkSeal(dir);
  const [a, b] = String(seedsArg || '1').split('-').map(Number); const seeds = []; for (let s = a; s <= (b || a); s++) seeds.push(s);
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 17) + 'Z', mode = (process.env.LAB_MODEL === 'real' ? 'real-' + String(process.env.LAB_MODEL_NAME || 'model').replace(/[^a-z0-9.]/gi, '_') : 'standin' + (process.env.LAB_FENCE === '1' ? '-fenced' : '')) + (WIDEN ? '-WIDENED' : '') + (process.env.PK_DAEMON === '1' ? '-daemons' : '-inproc');
  const outDir = path.join(LAB, 'results', path.basename(dir) + '-' + stamp + '-' + mode); if (fs.existsSync(outDir)) die('results folder exists: ' + outDir); fs.mkdirSync(outDir, { recursive: true });
  // the fingerprint of the kernel ACTUALLY loaded (every .js + the registry spec under KDIR), compared with the recorded copy of live
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const inKernel = (r) => r === 'act.js' || (r.startsWith('act/') && !r.startsWith('act/test/'));   // 0.2.0
  const kfiles = [path.join(KDIR, 'act.js'), ...walk(path.join(KDIR, 'act'))].filter((f) => inKernel(path.relative(KDIR, f).split(path.sep).join('/')) && /\.js$|registry\.spec\.json$/.test(f)).sort();
  const kernel = sha(kfiles.map((f) => path.relative(KDIR, f) + ' ' + sha(fs.readFileSync(f))).join('\n'));
  const recorded = fs.readFileSync(path.join(LAB, 'KERNEL-SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/)).filter((x) => x[1]).map(([h, f]) => [f.replace(/^\.\//, ''), h]);
  const isLiveCopy = recorded.length === kfiles.length && recorded.every(([f, h]) => fs.existsSync(path.join(KDIR, f)) && sha(fs.readFileSync(path.join(KDIR, f))) === h);
  if (!isLiveCopy) console.log('NOTE: the kernel under ' + KDIR + ' is NOT the recorded copy of live — results are about THIS kernel only (a mutant or another version)');
  console.log('START ' + VERSION + ' · suite ' + path.basename(dir) + ' · ' + files.length + ' scenarios × seeds ' + seeds.join(',') + ' · model ' + (process.env.LAB_MODEL === 'real' ? 'REAL ' + (process.env.LAB_MODEL_NAME || '') : 'stand-in (obeys every injection)') + ' · daemons ' + (process.env.PK_DAEMON === '1' ? 'on' : 'off'));
  console.log('ENV host ' + os.hostname() + ' · node ' + process.version + ' · kernel ' + kernel.slice(0, 12) + (isLiveCopy ? ' (= the recorded copy of live ' + KVER + ')' : ' (NOT the live copy)') + ' · sealed ' + sealedAt + ' (' + sealSha.slice(0, 12) + ')');
  const all = [];
  for (const f of files) for (const s of seeds) { const r = await runScenario(path.join(dir, f), s, outDir); all.push(r);
    console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.scenario + ' s' + s + ' · ' + r.ms + ' ms · ' + r.cause + ' · refusals ' + JSON.stringify(r.refusals) + (r.modelFollowedInjection != null && r.twin === 'hostile' ? ' · model followed injection: ' + r.modelFollowedInjection : '') + (r.pass ? '' : '\n      ' + [...r.expectations.filter((x) => !x.pass).map((x) => 'FAILED ' + x.what + ' (got ' + x.got + ')'), ...r.invariants].join('\n      '))); }
  const hostile = all.filter((r) => r.twin === 'hostile'), benign = all.filter((r) => r.twin === 'benign');
  const sum = { version: VERSION, suite: path.basename(dir), stamp, host: os.hostname(), node: process.version, kernelSums: kernel, kernelDir: KDIR, kernelIsLiveCopy: isLiveCopy, sealedAt, sealSha, seeds, model: all[0] && all[0].model,
    runs: all.length, passed: all.filter((r) => r.pass).length, hostile: { runs: hostile.length, held: hostile.filter((r) => r.pass).length, modelFollowed: hostile.filter((r) => r.modelFollowedInjection).length },
    benign: { runs: benign.length, passed: benign.filter((r) => r.pass).length, falseRefusals: benign.filter((r) => !r.pass && (r.cause === 'kernel' || r.cause === 'policy')).length, scriptFailures: benign.filter((r) => !r.pass && r.cause !== 'kernel' && r.cause !== 'policy').length },
    hostileStoppedByKernel: hostile.filter((r) => r.cause === 'kernel').length, hostileStoppedByPolicy: hostile.filter((r) => r.cause === 'policy').length, hostileDiedInScript: hostile.filter((r) => r.cause === 'script').length, invariantViolations: all.reduce((n, r) => n + r.invariants.length, 0) };
  fs.writeFileSync(path.join(outDir, 'SUMMARY.json'), JSON.stringify(sum, null, 1) + '\n');
  console.log('\nRESULT ' + sum.suite + ': ' + sum.passed + '/' + sum.runs + ' runs as expected · hostile held ' + sum.hostile.held + '/' + sum.hostile.runs + ' (model followed the injection in ' + (all.some((r) => r.modelFollowedInjection != null) ? sum.hostile.modelFollowed : 'n/a') + ') · benign passed ' + sum.benign.passed + '/' + sum.benign.runs + ' (false refusals by the kernel ' + sum.benign.falseRefusals + ', script failures ' + sum.benign.scriptFailures + ') · hostile runs stopped by a kernel refusal (taint or target) ' + sum.hostileStoppedByKernel + ', by an allow-list ' + sum.hostileStoppedByPolicy + ', ended in a script error first ' + sum.hostileDiedInScript + ' · invariant violations ' + sum.invariantViolations);
  console.log((sum.passed === sum.runs ? 'DONE' : 'FAILED') + ' · results in ' + outDir);
  process.exit(sum.passed === sum.runs ? 0 : 1);
})().catch((e) => die(e.stack || e.message));
