// timeline.js — v0.1.1 (111126: the page's live version is read from KERNEL-VERSION.txt, as lab.js reads it; it said 0.53.1 for every run) · was v0.1.0 (061126) · turns a lab results folder into ONE readable page (timeline.html): per scenario the verdict, what it
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// tested, each expectation (pass/fail) and the audit trail in plain words — who asked, what ran, what was REFUSED and why, which labels
// travelled. Reads only the audit lines (which never hold message bodies) and the result files. The same renderer is meant for the
// demo's Live audit screen.   node timeline.js <results-dir>
'use strict';
const fs = require('fs'), path = require('path');
const dir = process.argv[2]; if (!dir) { console.error('usage: node timeline.js <results-dir>'); process.exit(2); }
const KVER = (() => { try { return (/"version": "([^"]+)"/.exec(fs.readFileSync(path.join(__dirname, 'KERNEL-VERSION.txt'), 'utf8')) || [])[1] || '?'; } catch (_) { return '?'; } })();   // 0.1.1, as lab.js 0.1.12
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sum = JSON.parse(fs.readFileSync(path.join(dir, 'SUMMARY.json'), 'utf8'));
const results = fs.readdirSync(dir).filter((f) => f.endsWith('.result.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
const seen = new Set(), shown = results.filter((r) => { const k = r.scenario; if (seen.has(k)) return false; seen.add(k); return true; });   // one seed per scenario on the page
const time = (t) => String(t || '').slice(11, 23);
function line(j, who) {
  const w = (x) => esc(who[x] || x || '?'), act = esc(j.action || ''), L = (a) => (a && a.length ? ' <span class="lab">' + a.map(esc).join(' + ') + '</span>' : '');
  let inp = ''; try { const i = JSON.parse(j.input || '{}'); inp = ['url', 'to', 'subject', 'name', 'topic', 'model'].filter((k) => i[k] != null).map((k) => k + ' ' + esc(who[i[k]] || i[k])).join(' · '); } catch (_) { inp = ''; }
  switch (j.outcome) {
    case 'run': return ['run', w(j.from) + ' asks to run <b>' + act + '</b>' + (inp ? ' — ' + inp : '') + L(j.labels) + (j.ctl && j.ctl.length ? ' <span class="ctl">under control ' + j.ctl.map(esc).join('+') + '</span>' : '')];
    case 'ok': return ['ok', '<b>' + act + '</b> done' + (j.ms != null ? ' in ' + esc(j.ms) + ' ms' : '') + (j.labelsOut ? ' — its result carries' + L(j.labelsOut) : '')];
    case 'refused': return ['refused', '<b>' + act + ' REFUSED</b> · ' + esc(j.code) + ' — ' + esc(j.reason)];
    case 'error': return ['error', '<b>' + act + '</b> failed · ' + esc(j.code) + ' — ' + esc(j.reason)];
    case 'msg-sent': return ['msg', 'message from ' + w(j.from) + ' to ' + w(j.to) + ', topic ' + esc(j.topic) + ', ' + esc(j.bytes) + ' bytes' + L(j.labels)];
    case 'msg-read': case 'msg-done': return ['msg', esc(j.outcome === 'msg-read' ? 'message read' : 'message done') + (j.to ? ' by ' + w(j.to) : '')];
    case 'grants': return ['grants', 'rule change by ' + esc(j.by) + ' for ' + esc(j.for) + (j.grants && j.grants.actions ? ': may run ' + Object.keys(j.grants.actions).map(esc).join(', ') : ': all actions removed')];
    case 'state-set': return ['state', w(j.identity) + ' remembers ' + esc(j.key) + L(j.labels)];
    default: return ['other', esc(j.outcome) + (j.identity ? ' · ' + w(j.identity) : '') + (j.action ? ' · ' + act : '')];
  }
}
const cards = shown.map((r) => {
  const who = r.identities || {}, F = r.scenario + '.s' + r.seed + '.audit.jsonl', P = path.join(dir, F);
  const audit = fs.existsSync(P) ? fs.readFileSync(P, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const rows = audit.map((j) => { const [k, html] = line(j, who); return '<li class="' + k + '"><span class="t">' + time(j.t) + '</span>' + html + '</li>'; }).join('');
  const ex = r.expectations.map((x) => '<li class="' + (x.pass ? 'p' : 'f') + '">' + (x.pass ? '✓' : '✗') + ' ' + esc(x.what) + ' <span class="got">(got ' + esc(x.got) + ')</span></li>').join('')
    + r.invariants.map((i) => '<li class="f">✗ ' + esc(i) + '</li>').join('') + (r.loadRefused && r.loadRefused.length ? '<li class="p">refused at load: ' + r.loadRefused.map((x) => esc(x.name + ' — ' + x.reason)).join('; ') + '</li>' : '');
  return '<details class="card ' + (r.pass ? 'pass' : 'fail') + '"' + (r.pass ? '' : ' open') + '><summary><span class="v">' + (r.pass ? 'HELD' : 'BROKE') + '</span><span class="tw">' + esc(r.twin || '') + '</span><b>' + esc(r.scenario) + '</b> <span class="ab">' + esc(r.about || '') + '</span></summary>'
    + '<h4>Expected (sealed before the run)</h4><ul class="ex">' + ex + '</ul><h4>What happened (audit trail, ' + audit.length + ' lines)</h4><ol class="tl">' + rows + '</ol></details>';
}).join('\n');
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lab timeline · ${esc(sum.suite)}</title>
<style>:root{--bg:#f6f7f6;--fg:#17201b;--mut:#5c6a62;--card:#fff;--rule:#d6ddd9;--ok:#0b7a37;--bad:#b3261e;--amb:#9a5b00;--chip:#e6efe9}
@media (prefers-color-scheme:dark){:root{--bg:#0d1110;--fg:#e3ebe6;--mut:#95a59c;--card:#141b18;--rule:#26332d;--ok:#47d17b;--bad:#ff7b6b;--amb:#e8a94a;--chip:#1b2a22}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1000px;margin:0 auto;padding:24px 16px 60px}
h1{font-size:24px;margin:0 0 6px}.meta{color:var(--mut);font:12.5px/1.5 ui-monospace,Menlo,monospace}.big{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.big div{background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:10px 14px}.big b{display:block;font-size:22px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:6px;margin:8px 0;padding:8px 12px}.card.fail{border-color:var(--bad)}
summary{cursor:pointer;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}.v{font:600 11px ui-monospace,monospace;padding:2px 6px;border-radius:3px;background:var(--chip);color:var(--ok)}.fail .v{color:var(--bad)}
.tw{font:11px ui-monospace,monospace;color:var(--mut)}.ab{color:var(--mut);font-size:13.5px}h4{margin:12px 0 4px;font-size:13px;color:var(--mut)}
ul.ex,ol.tl{margin:0;padding-left:20px}ul.ex li.p{color:var(--ok)}ul.ex li.f{color:var(--bad)}.got{color:var(--mut)}
ol.tl li{margin:2px 0;font-size:13.5px}ol.tl .t{font:11.5px ui-monospace,monospace;color:var(--mut);margin-right:8px}
li.refused,li.error{color:var(--bad)}li.grants{color:var(--amb)}.lab{font:11px ui-monospace,monospace;background:var(--chip);padding:1px 5px;border-radius:3px}.ctl{font:11px ui-monospace,monospace;color:var(--amb)}</style></head><body><main>
<h1>Lab timeline · ${esc(sum.suite)}</h1>
<div class="meta">${esc(sum.version)} · ${esc(sum.stamp)} · ${esc(sum.host)} · node ${esc(sum.node)} · kernel ${esc(String(sum.kernelSums).slice(0, 12))}${sum.kernelIsLiveCopy === false ? ' (NOT the live copy)' : ' (copy of live ' + esc(KVER) + ')'} · model ${esc(sum.model)} · expectations sealed ${esc(sum.sealedAt)} (${esc(String(sum.sealSha).slice(0, 12))})</div>
<div class="big"><div>runs as expected<b>${sum.passed} / ${sum.runs}</b></div><div>attacks held<b>${sum.hostile.held} / ${sum.hostile.runs}</b></div><div>benign delivered<b>${sum.benign.passed} / ${sum.benign.runs}</b></div><div>silent failures<b>${sum.invariantViolations}</b></div></div>
<p class="meta">One seed per scenario is shown; every seed's audit file is in this folder. Message bodies are never in the audit, so none are shown. "HELD" = every sealed expectation true.</p>
${cards}
</main></body></html>`;
fs.writeFileSync(path.join(dir, 'timeline.html'), page); console.log('wrote ' + path.join(dir, 'timeline.html') + ' (' + shown.length + ' scenarios)');
