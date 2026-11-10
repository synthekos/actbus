// capabilities.js — v1.1.0 · who may do what; authority shrinks along a chain · changelog: act/CHANGELOG.md#actcorecapabilitiesjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// who may do what, and authority that SHRINKS along a chain (ACTBUS docs/capability-architecture.md §1 item 1, §9 item 3)
// 1.1.0 (ACTBUS docs/proteus-k.md §5): grant flag strictControl — this identity wants rule (a) for this action: a call made under a
// model/web-labelled condition (ctl) is treated as tainted. If ANY identity in the chain sets it, the chain is strict.
// identities.json (admin-written):
//   { "identities": [ { "name": "dollar-watch", "kind": "euser", "owner": "alex",
//       "actions": { "fetch": { "targets": ["www.example.com"] }, "file-append": {}, "calc": {} },
//       "models": ["<model>"], "rate": 60 } ] }
//   kind     person · euser · device · script · node    owner  the PERSON accountable for it (every chain ends at a human)
//   actions  action → grant. A grant may carry:
//              targets       allow-list for tentacles (hosts for fetch, addresses for email); absent = no targets
//              allowTainted  true = this identity accepts model- or web-labelled input for this world action (explicit rule)
//   models   language models it may use (the model action)       rate  messages per minute (default 120)
// effective(chain, action): the grant that EVERY identity in the chain holds — targets intersected, allowTainted AND-ed,
// models intersected. If any identity in the chain lacks the action, there is no grant (the confused-deputy rule).
'use strict';
const fs = require('fs');
const { NAME } = require('./envelope');

const KINDS = ['person', 'euser', 'device', 'script', 'node'];
const KIND_LABEL = { person: 'person', euser: 'device', device: 'device', script: 'person', node: 'device' };

function checkIdentity(i) {
  const bad = (m) => { throw new Error('identity ' + JSON.stringify(i && i.name) + ': ' + m); };
  if (!i || !NAME.test(i.name || '')) bad('name must be a-z, 0-9, - (starts with a letter)');
  if (!KINDS.includes(i.kind)) bad('kind must be ' + KINDS.join(' | '));
  if (!NAME.test(i.owner || '')) bad('owner (the accountable person) is required');
  if (i.actions && typeof i.actions !== 'object') bad('actions must be an object');
  for (const [a, g] of Object.entries(i.actions || {})) {
    if (!NAME.test(a)) bad('action name ' + a);
    if (!g || typeof g !== 'object') bad('grant for ' + a + ' must be an object');
    if (g.targets !== undefined && (!Array.isArray(g.targets) || g.targets.some((t) => typeof t !== 'string' || !t))) bad('targets for ' + a + ' must be a list of strings');
    if (g.allowTainted !== undefined && typeof g.allowTainted !== 'boolean') bad('allowTainted for ' + a + ' must be true or false');
    if (g.strictControl !== undefined && typeof g.strictControl !== 'boolean') bad('strictControl for ' + a + ' must be true or false');
  }
  if (i.models !== undefined && (!Array.isArray(i.models) || i.models.some((m) => typeof m !== 'string'))) bad('models must be a list');
  if (i.rate !== undefined && !(Number.isInteger(i.rate) && i.rate >= 1 && i.rate <= 10000)) bad('rate must be 1–10000');
}

function load(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return fromList(j.identities);
}
function fromList(list) {
  if (!Array.isArray(list)) throw new Error('identities must be a list');
  const m = new Map();
  for (const i of list) {
    checkIdentity(i);
    if (m.has(i.name)) throw new Error('duplicate identity ' + i.name);
    if (!list.some((p) => p.name === i.owner && p.kind === 'person')) throw new Error('identity ' + i.name + ': owner ' + i.owner + ' is not a person identity');
    m.set(i.name, Object.freeze({ ...i, actions: i.actions || {}, models: i.models || [], rate: i.rate || 120 }));
  }
  return m;
}

const intersect = (lists) => lists.reduce((acc, l) => acc.filter((x) => l.includes(x)));

// → null (refused) or { targets: [...] | null, allowTainted: bool, strictControl: bool }
function effective(ids, chain, action) {
  const grants = [];
  for (const name of chain) {
    const id = ids.get(name); if (!id) return null;
    const g = id.actions[action]; if (!g) return null;
    grants.push(g);
  }
  const withTargets = grants.filter((g) => g.targets !== undefined);
  return {
    targets: withTargets.length ? intersect(withTargets.map((g) => g.targets)) : null,
    allowTainted: grants.every((g) => g.allowTainted === true),
    strictControl: grants.some((g) => g.strictControl === true),
  };
}
const modelsFor = (ids, chain) => intersect(chain.map((n) => (ids.get(n) ? ids.get(n).models : [])));
const missing = (ids, chain, action) => chain.filter((n) => !ids.get(n) || !ids.get(n).actions[action]);

module.exports = { load, fromList, effective, modelsFor, missing, KIND_LABEL, KINDS };
