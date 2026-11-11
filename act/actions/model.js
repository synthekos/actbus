// model.js — v1.0.0 · ask a language model, as a permitted, labelled and audited action · changelog: act/CHANGELOG.md#actactionsmodeljs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// ask a language model — as an ACTION, so it is permitted, routed, labelled and audited
// Input { model: "<model>", prompt: "…", system?: "…" }. The model must be on the list of EVERY identity in the
// chain (models intersect). The name service says which node serves the model (ACTBUS docs/capability-architecture.md §3); slice 1 serves local only.
// Its output is labelled "model" (registry: produces model) — never "computed" — and the bus therefore refuses to let it
// reach a world action (email, file, fetch) unless that identity has an explicit rule (allowTainted). The model never
// chooses an action: it only returns text.
'use strict';

async function run(input, ctx) {
  const allowed = ctx.models();
  if (!allowed.includes(input.model)) throw new Error('model ' + input.model + ' is not permitted for ' + ctx.authority.join(' → ') + ' (allowed: ' + (allowed.join(', ') || 'none') + ')');
  const route = ctx.backend('model', input.model);
  if (!route) throw new Error('no node serves the model ' + input.model);
  if (route.node !== ctx.node) throw new Error('model ' + input.model + ' is served by node ' + route.node + ' — slice 1 routes locally only');
  const text = await route.handler({ model: input.model, prompt: String(input.prompt).slice(0, 32000), system: input.system ? String(input.system).slice(0, 8000) : undefined, identity: ctx.identity, trace: ctx.trace });
  if (typeof text !== 'string') throw new Error('the model backend returned no text');
  return { text };
}

module.exports = { run };
