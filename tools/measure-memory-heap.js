#!/usr/bin/env node
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// measure-memory-heap.js — v1.1.0 (181126) · the memory of the ids the bus keeps, by the first of the two methods in docs/host.md ("The dedupe
// check"). Written by the sixth cold read's reader (docs/cold-read-v035.md); its code is unchanged below this header and the gc check, but for the kinds line (1.1.0).
// The method: for each kind of id, a Map of 50 000 ids, each to a time (what the bus's set holds per identity), is filled; the heap is read
// after two full gcs with the Map held, and again after it is cleared. The difference over 50 000 is one id's cost. The kinds: uuid
// (36 characters, the kind the kernel makes) and ascii80 (80 characters). 1.1.0 (issue #12): emoji40 and cyr80 are gone, because an id
// may now hold only A-Z a-z 0-9 . _ : - (act/core/envelope.js), so the longest id is 80 one-byte characters. It uses no file
// of this repository and writes nothing.   usage: node --expose-gc tools/measure-memory-heap.js
if (typeof gc !== 'function') { console.error('usage: node --expose-gc tools/measure-memory-heap.js'); process.exit(2); }
const kinds = { uuid: () => require('crypto').randomUUID(), ascii80: (k) => (String(k).padStart(8, '0') + 'x'.repeat(80)).slice(0, 80) };
for (const [n, mk] of Object.entries(kinds)) { const id0 = mk(1); gc(); gc(); const m = new Map(); for (let k = 0; k < 50000; k++) m.set(JSON.parse(JSON.stringify(mk(k))), Date.now()); gc(); gc(); const h = process.memoryUsage().heapUsed; m.clear(); gc(); gc(); const a = process.memoryUsage().heapUsed; console.log(n.padEnd(8), 'units=' + id0.length, ((h - a) / 50000).toFixed(0) + ' B/id', ((h - a) / 1e6).toFixed(1) + ' MB'); }
