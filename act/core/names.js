// names.js — v1.0.0 · the name service: from a name to where it is served · changelog: act/CHANGELOG.md#actcorenamesjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// the name service: names → where they are served (ACTBUS docs/capability-architecture.md §3; QNX name_attach / name_open)
// A caller names an ACTION or a MODEL, never a machine. The name service says which node serves it. On one box every
// name resolves to 'local'; under SYNTHX the same lookup returns another node and the bus forwards the message there.
// Slice 1 routes locally only: a name served elsewhere is refused with "no route" (the remote path is slice 4).
'use strict';

class Names {
  constructor(self = 'local') { this.self = self; this.table = new Map(); }   // "kind:name" → [{ node, handler }]
  attach(kind, name, node, handler) {
    if (!['action', 'model'].includes(kind)) throw new Error('kind must be action or model');
    const k = kind + ':' + name;
    const list = this.table.get(k) || [];
    list.push(Object.freeze({ node, handler: handler || null }));
    this.table.set(k, list);
  }
  detach(kind, name, node) {
    const k = kind + ':' + name;
    this.table.set(k, (this.table.get(k) || []).filter((e) => e.node !== node));
  }
  // Local first (no network hop when this box serves it); otherwise the first node that does.
  resolve(kind, name) {
    const list = this.table.get(kind + ':' + name) || [];
    if (!list.length) return null;
    return list.find((e) => e.node === this.self) || list[0];
  }
  list() { return [...this.table.entries()].map(([k, v]) => ({ name: k, nodes: v.map((e) => e.node) })); }
}

module.exports = { Names };
