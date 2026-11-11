// eval.js — v1.6.1 · the PROTEUS-K evaluator: total, with provenance labels on every value · changelog: act/CHANGELOG.md#actproteusevaljs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// ## Design
// · (define (name arg …) body …) — top level only; a body may call only functions defined ABOVE it, so calls form no cycle and every
//   script still terminates; a function is not a value (no lambda, no closures: a body sees only its own arguments). A call evaluates
//   the body with the arguments bound — labels exactly as if the body were written out in place. A function that calls an action or
//   remembers is IMPURE and cannot be used inside a collection form. ≤ 64 functions, ≤ 8 arguments each.
// · built-ins (all total): text upper lower trim contains? starts-with? ends-with? split join replace · lists first last nth take drop
//   reverse append range empty? · records has? keys record · numbers min max abs round · json parse-json to-json · kinds number?
//   text? list? record? nil? · (now) = the time of the message that started this run (label device), never the clock mid-run.
//   LABELS by the literal rule: SELECTION (first last nth take drop reverse min max) keeps an item's credential (the item is read
//   as-is; what chose it is control); PARSING (parse-json, like number) keeps it and adds computed; CONTAINERS (append, record, like
//   list) are data; everything else is COMPUTED and never carries a credential.
// PROTEUS-K v0 evaluator: checks a tree, then runs it (ACTBUS docs/proteus-k.md §3–§6)
// 1.3.0 (021126, owner decision on B′, 2 Nov 2026): (the (x list) cond) — THE ONE item for which cond is true. Pure body, like the
// collection forms (reach unchanged). Exactly one match → that item. No match → refused: 'not in the documents' (code FAIL).
// Two or more → the program STOPS with code AMBIGUOUS and the error carries every match (e.possibilities, as JSON): the kernel
// never chooses between them and nothing downstream computes on a guess; the answer layer shows them side by side (rule R6,
// "variation is not wrong"). Labels as filter: the result (or the error) carries the list's labels ∪ every body value's labels.
// 1.2.0 (021126): COLLECTION FORMS — (filter (x list) cond) (collect (x list) expr) (count (x list) cond)
// (sum (x list) expr) (max-by (x list) key) (min-by (x list) key) (sort-by (x list) key). Each binds a name like for-each and
// has exactly ONE body form, which must be PURE: no action call and no remember inside it (checked at load), so a
// collection form reaches nothing and the reachable-action list is unchanged. Lists ≤ 1 000 items; fuel bounds the rest.
// LABELS: which items are kept, their order, a count/sum and which item max-by picks all depend on every item's
// body value, so the result carries the list's labels ∪ every body value's labels, and each item in a result list
// carries them too (an item taken out of the list later still says what chose it). Bodies run under C ∪ the list's labels.
// 1.1.0 (self-review 30 Oct, S2/S2b/S4): STICKY CONTROL — once the script has computed a value with labels L, everything
// after it runs under L too: the script could have stopped there (a fail, an action refusing that value), so whether
// any later step happens depended on it. cx.seen holds those labels; it starts with the caller's ctl (a script called
// under a web condition runs entirely under it). Action calls send C ∪ seen as ctl; remember stores v ∪ C ∪ seen; every
// error carries seen. DATA labels are unchanged — rule (b) still lets a page decide WHETHER, never WHAT.
// check(forms, actions) is the load-time pass: every name must be bound, every form well-shaped, every called name a
// registered action — an error here means the script is refused before it ever runs. run() then evaluates.
// LABELS (ACTBUS docs/proteus-k.md §5, rule b): every value carries data labels; the control set C holds the labels of every condition the
// current code runs under. A conditional's VALUE carries its condition's labels as data. An action call sends its input's
// data labels as labels and C as ctl — C alone never taints the call (the bus decides; strictControl turns C into taint).
// TOTAL: no recursion, no lambda, no eval, no macros, no while; for-each ≤ 100 items; fuel bounds every evaluation step.
// rational.js is a byte-identical copy of the capability core's (act/core/rational.js, sha deef5355c069).
'use strict';
const R = require('./rational');

const LABELS = Object.freeze(['person', 'device', 'computed', 'grounded', 'model', 'web']);
const LIMITS = Object.freeze({ FUEL: 10000, ITER: 100, LIST: 1000, STR: 65536, STATE_KEYS: 64, STATE_BYTES: 4096, SIZE: 2000000, FNS: 64, PARAMS: 8, JSON_DEPTH: 32 });
const COLL = new Set(['filter', 'collect', 'count', 'sum', 'max-by', 'min-by', 'sort-by', 'the']);
const SPECIAL = new Set(['let', 'if', 'when', 'unless', 'and', 'or', 'do', 'for-each', 'remember', 'remembered', 'input', 'fail', ...COLL]);
const BUILTIN = Object.assign(Object.create(null), { '=': [2, 2], '<': [2, 2], '>': [2, 2], '<=': [2, 2], '>=': [2, 2], '+': [1, Infinity], '-': [1, Infinity],
  '*': [1, Infinity], '/': [2, 2], str: [1, Infinity], len: [1, 1], list: [0, Infinity], get: [2, 2], number: [1, 1], not: [1, 1],
  // 1.6.0 — the standard library (ACTBUS docs/functions-and-mailboxes.md §2)
  upper: [1, 1], lower: [1, 1], trim: [1, 1], 'contains?': [2, 2], 'starts-with?': [2, 2], 'ends-with?': [2, 2], split: [2, 2], join: [2, 2],
  replace: [3, 3], first: [1, 1], last: [1, 1], nth: [2, 2], take: [2, 2], drop: [2, 2], reverse: [1, 1], append: [0, Infinity],
  range: [1, 2], 'empty?': [1, 1], 'has?': [2, 2], keys: [1, 1], record: [0, Infinity], min: [1, Infinity], max: [1, Infinity],
  abs: [1, 1], round: [1, 2], 'parse-json': [1, 1], 'to-json': [1, 1], 'number?': [1, 1], 'text?': [1, 1], 'list?': [1, 1],
  'record?': [1, 1], 'nil?': [1, 1], now: [0, 0] });   // 1.6.1 (C2): no prototype — `constructor` is not a built-in

class ScriptError extends Error {
  constructor(code, msg, node, labels) {
    super(msg + (node && node.line ? ' (line ' + node.line + ':' + node.col + ')' : ''));
    this.code = code; this.labels = [...(labels || [])].filter((l) => !CREDENTIALS.has(l)).sort();   // F-B review F7: an error is never a credential
    if (node && node.line) { this.line = node.line; this.col = node.col; }
  }
}
const PERSON = new Set(['person']);
const union = (...sets) => { const u = new Set(); for (const s of sets) for (const l of s) u.add(l); return u; };
// F-B (ACTBUS docs/reviews.md, PROTEUS-K review finding 1): two kinds of label, opposite flow. WARNINGS (person, device, computed, model, web) may be over-counted —
// that only makes a value less trusted — so they are the union of every DATA and CONTROL input, as before. A CREDENTIAL (grounded)
// is a positive claim ("read from the documents") and must never be over-counted: a value carries it only if EVERY one of its DATA
// inputs carries it. flow(data, control) — data and control are lists of label sets; no data → no credential.
const CREDENTIALS = new Set(['grounded']);
const hasL = (s, l) => (s instanceof Set ? s.has(l) : s.includes(l));
function flow(data, control = []) {
  const out = new Set();
  for (const s of data) for (const l of s) if (!CREDENTIALS.has(l)) out.add(l);
  for (const s of control) for (const l of s) if (!CREDENTIALS.has(l)) out.add(l);
  if (data.length) for (const c of CREDENTIALS) if (data.every((s) => hasL(s, c))) out.add(c);
  return out;
}
const noCred = (s) => { const o = new Set(); for (const l of s) if (!CREDENTIALS.has(l)) o.add(l); return o; };   // warnings only
// F-A (ACTBUS docs/reviews.md, PROTEUS-K review; 1.3.1): EVERY value carries its SIZE z = what it would take written out — a list counts 1 + the size of each item
// (so a list that holds the same list 10 times counts it 10 times: shared references cannot hide 10^9 items), text counts its
// length, a record its JSON length, anything else 1. Creating a value larger than LIMITS.SIZE is a RUN error (the script stops,
// the server does not). Every value is made by V (state is rebuilt through V by dec), so every value — reply, state, error — is bounded.
const RECZ = new WeakMap();
function sizeOf(k, v) {
  if (k === 'list') { let z = 1; for (const i of v) z += i.z || 1; return z; }
  if (k === 'str') return 1 + v.length;
  if (k === 'rec') { if (v && typeof v === 'object') { let z = RECZ.get(v); if (z === undefined) { z = 1 + JSON.stringify(v).length; RECZ.set(v, z); } return z; } return 1; }
  return 1;
}
const V = (k, v, L) => {
  const z = sizeOf(k, v);
  if (z > LIMITS.SIZE) throw new ScriptError('RUN', 'a value larger than ' + LIMITS.SIZE + ' units (text counts its length; a list counts every item inside it, again for each time it holds the same list)', null, L);
  return { k, v, L, z };
};
const truthy = (x) => !(x.k === 'nil' || (x.k === 'bool' && x.v === false));
const KIND = { num: 'a number', str: 'text', bool: 'true/false', nil: 'nil', list: 'a list', rec: 'a record' };

// ---------- load-time check ----------
function check(forms, actions) {
  const has = typeof actions === 'function' ? actions : (n) => actions.has(n);
  const calls = [];
  const bad = (msg, node) => { throw new ScriptError('CHECK', msg, node); };
  const fns = new Map();                                            // 1.6.0: name → { arity, pure }, in file order
  let acc = null;                                                   // 1.6.0: the function being checked (does it reach the world?)
  const reserved = (name) => SPECIAL.has(name) || name in BUILTIN || has(name) || fns.has(name) || name === 'define';
  const bindable = (node, what) => {
    if (!node || node.t !== 'sym' || /[^a-z0-9?-]/.test(node.v)) bad(what + ' must be a name', node);
    if (reserved(node.v)) bad(JSON.stringify(node.v) + (fns.has(node.v) ? ' is a function name' : ' is a form or action name') + '; it cannot be ' + what, node);
    return node.v;
  };
  const arity = (n, a, min, max, shape) => { if (a.length < min || a.length > max) bad('(' + n.items[0].v + ' …) takes ' + shape, n); };
  function walk(n, scope, pure) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': case 'nil': return;
      case 'kw': return bad('a keyword (:' + n.v + ') can only name an argument of an action call', n);
      case 'sym':
        if (scope.has(n.v)) return;
        if (SPECIAL.has(n.v) || n.v in BUILTIN || has(n.v) || fns.has(n.v)) return bad(JSON.stringify(n.v) + ' must be called: (' + n.v + ' …)', n);
        if (n.v === 'define') return bad('(define …) only at the top level of a script', n);
        return bad('unknown name ' + JSON.stringify(n.v) + ' (not bound by let or for-each)', n);
      case 'list': break;
      default: return bad('unknown node', n);
    }
    if (n.items.length === 0) bad('() is not a form', n);
    const h = n.items[0], a = n.items.slice(1);
    if (h.t !== 'sym') bad('a form must start with a name, not ' + (h.t === 'list' ? 'a list' : JSON.stringify(h.v ?? h.s)), h);
    const name = h.v;
    if (scope.has(name)) bad(JSON.stringify(name) + ' is a value, not something to call', h);
    if (name === 'define') bad('(define …) only at the top level of a script, never inside another form', n);
    if (fns.has(name)) {                                              // 1.6.0: a call of a function defined above
      const f = fns.get(name);
      if (a.length !== f.arity) bad('(' + name + ' …) takes ' + f.arity + ' value' + (f.arity === 1 ? '' : 's'), n);
      if (pure && !f.pure) bad('(' + name + ' …) calls an action or remembers; it cannot be used inside (' + pure + ' …)', h);
      if (acc && !f.pure) acc.impure = true;
      for (const x of a) walk(x, scope, pure); return;
    }
    if (SPECIAL.has(name)) {
      switch (name) {
        case 'let': {
          if (a.length < 2 || a[0].t !== 'list') bad('(let ((name value) …) body …)', n);
          const inner = new Set(scope);
          for (const b of a[0].items) {
            if (b.t !== 'list' || b.items.length !== 2) bad('each let binding is (name value)', b);
            walk(b.items[1], inner, pure); inner.add(bindable(b.items[0], 'a let name'));
          }
          for (const x of a.slice(1)) walk(x, inner, pure); return;
        }
        case 'if': arity(n, a, 3, 3, 'exactly 3 parts: (if condition then else)'); break;
        case 'when': case 'unless': arity(n, a, 2, Infinity, 'a condition and at least one form'); break;
        case 'and': case 'or': case 'do': arity(n, a, 1, Infinity, 'at least one form'); break;
        case 'fail': arity(n, a, 1, 1, 'one reason'); break;
        case 'for-each': {
          if (a.length < 2 || a[0].t !== 'list' || a[0].items.length !== 2) bad('(for-each (name list) body …)', n);
          walk(a[0].items[1], scope, pure);
          const inner = new Set(scope); inner.add(bindable(a[0].items[0], 'a for-each name'));
          for (const x of a.slice(1)) walk(x, inner, pure); return;
        }
        case 'filter': case 'collect': case 'count': case 'sum': case 'max-by': case 'min-by': case 'sort-by': case 'the': {
          if (a.length !== 2 || a[0].t !== 'list' || a[0].items.length !== 2) bad('(' + name + ' (name list) one-form)', n);
          walk(a[0].items[1], scope, pure);
          const inner = new Set(scope); inner.add(bindable(a[0].items[0], 'a ' + name + ' name'));
          walk(a[1], inner, name); return;
        }
        case 'remember':
          if (pure) bad('(remember …) cannot be inside (' + pure + ' …): its one form must only compute', n);
          if (acc) acc.impure = true;
          arity(n, a, 2, 2, '(remember key value)');
          if (a[0].t !== 'sym') bad('the key of remember must be a name', a[0]);
          walk(a[1], scope, pure); return;
        case 'remembered': case 'input':
          arity(n, a, 1, 1, '(' + name + ' name)');
          if (a[0].t !== 'sym') bad('(' + name + ' name): the name is written as-is, e.g. (' + name + ' rate)', a[0]);
          return;
      }
      for (const x of a) walk(x, scope, pure); return;
    }
    if (name === 'record' && a.length % 2) bad('(record …) takes "key" value pairs', n);
    if (name in BUILTIN) { const [min, max] = BUILTIN[name]; arity(n, a, min, max, min === max ? min + ' value' + (min > 1 ? 's' : '') : 'at least ' + min + ' value' + (min > 1 ? 's' : '')); for (const x of a) walk(x, scope, pure); return; }
    if (!has(name)) bad('no action named ' + JSON.stringify(name), h);
    if (pure) bad('no action call inside (' + pure + ' …): ' + name + ' — its one form must only compute', h);
    if (acc) acc.impure = true;
    if (a.length % 2) bad('an action call takes :name value pairs', n);
    const seen = new Set();
    for (let i = 0; i < a.length; i += 2) {
      if (a[i].t !== 'kw') bad('expected :name, found ' + (a[i].t === 'sym' ? a[i].v : a[i].t), a[i]);
      if (seen.has(a[i].v)) bad(':' + a[i].v + ' given twice', a[i]);
      seen.add(a[i].v); walk(a[i + 1], scope, pure);
    }
    calls.push({ action: name, line: h.line, col: h.col });
  }
  for (const f of forms) {
    if (isDefine(f)) { defineFn(f); continue; }
    walk(f, new Set(), null);
  }
  function defineFn(n) {
    const a = n.items.slice(1);
    if (a.length < 2 || a[0].t !== 'list' || !a[0].items.length) bad('(define (name arg …) body …)', n);
    if (fns.size >= LIMITS.FNS) bad('more than ' + LIMITS.FNS + ' functions', n);
    const name = bindable(a[0].items[0], 'a function name');
    const params = a[0].items.slice(1).map((x) => bindable(x, 'an argument name'));
    if (params.length > LIMITS.PARAMS) bad('a function takes at most ' + LIMITS.PARAMS + ' arguments', a[0]);
    if (new Set(params).size !== params.length) bad('an argument name is used twice', a[0]);
    const mine = { impure: false }; acc = mine;
    for (const x of a.slice(1)) walk(x, new Set(params), null);          // the body sees ONLY its arguments and the functions above
    acc = null;
    fns.set(name, { arity: params.length, pure: !mine.impure });
  }
  return { calls, functions: [...fns].map(([name, f]) => ({ name, arity: f.arity, pure: f.pure })) };
}

const isDefine = (f) => f && f.t === 'list' && f.items.length > 0 && f.items[0].t === 'sym' && f.items[0].v === 'define';

// ---------- values ----------
function num(n) {
  const neg = n.s[0] === '-';
  let r = R.parseDecimal(neg ? n.s.slice(1) : n.s);
  r = R.guard(r);
  return neg ? R.neg(r) : r;
}
function fromJSON(x, L, node) {
  if (x === null || x === undefined) return V('nil', null, L);
  if (typeof x === 'string') { if (x.length > LIMITS.STR) throw new ScriptError('RUN', 'text longer than ' + LIMITS.STR + ' characters', node, L); return V('str', x, L); }
  if (typeof x === 'boolean') return V('bool', x, L);
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) throw new ScriptError('RUN', 'not a finite number', node, L);
    if (Number.isSafeInteger(x)) return V('num', R.int(x), L);
    const s = String(x);
    if (/e/i.test(s) || Number.isInteger(x)) throw new ScriptError('RUN', 'a number too large or small to read exactly: ' + s, node, L);
    const neg = s[0] === '-'; const r = R.parseDecimal(neg ? s.slice(1) : s);
    return V('num', neg ? R.neg(r) : r, L);
  }
  if (Array.isArray(x)) {
    if (x.length > LIMITS.LIST) throw new ScriptError('RUN', 'a list longer than ' + LIMITS.LIST + ' items', node, L);
    return V('list', x.map((i) => fromJSON(i, L, node)), L);
  }
  if (typeof x === 'object') return V('rec', x, L);
  throw new ScriptError('RUN', 'a value of an unknown kind', node, L);
}
// what an action receives (and what a script returns): numbers as exact decimal text
function toWire(v, node) {
  switch (v.k) {
    case 'str': case 'bool': return v.v;
    case 'nil': return null;
    case 'num': { const d = R.toDecimal(v.v); if (!d.exact) throw new ScriptError('RUN', 'the number ' + R.toFraction(v.v) + ' has no exact decimal form', node, v.L); return d.text; }
    case 'list': return v.v.map((i) => toWire(i, node));
    case 'rec': return v.v;
  }
}
// script state: numbers kept as exact fractions so a remembered value comes back identical
const enc = (v) => (v.k === 'num' ? { k: 'num', v: R.toFraction(v.v) } : v.k === 'list' ? { k: 'list', v: v.v.map(enc) } : { k: v.k, v: v.v });
function dec(s, L) {
  if (s.k === 'num') { const [a, b] = String(s.v).split('/'); return V('num', R.make(BigInt(a), BigInt(b || '1')), L); }
  if (s.k === 'list') return V('list', s.v.map((i) => dec(i, L)), L);
  return V(s.k, s.v, L);
}
// an in-memory state store with the interface the real (file) store will have
function memState() {
  const m = new Map(); let absent = new Set();
  return {
    get: (key) => m.get(key),
    set: (key, value, labels) => {
      if (!m.has(key) && m.size >= LIMITS.STATE_KEYS) throw new Error('more than ' + LIMITS.STATE_KEYS + ' remembered keys');
      if (JSON.stringify(value).length > LIMITS.STATE_BYTES) throw new Error('a remembered value larger than ' + LIMITS.STATE_BYTES + ' bytes');
      m.set(key, { value, labels: [...labels].sort() }); absent = union(absent, labels);
    },
    // whether a key is MISSING can depend on earlier conditions too: every write's labels mark an absence
    absentLabels: () => [...absent].sort(),
    dump: () => Object.fromEntries(m),
  };
}

// ---------- evaluation ----------
// every evaluated value adds its labels to cx.seen (sticky control, 1.1.0)
async function ev(n, env, C, cx) {
  const v = await ev0(n, env, C, cx);
  for (const l of v.L) if (!cx.seen.has(l)) cx.seen = union(cx.seen, v.L);
  return v;
}
async function ev0(n, env, C, cx) {
  if (--cx.fuel < 0) throw new ScriptError('FUEL', 'more than ' + cx.fuelMax + ' evaluation steps', n, C);
  switch (n.t) {
    case 'num': return V('num', wrap(() => num(n), n, C), PERSON);
    case 'str': return V('str', n.v, PERSON);
    case 'bool': return V('bool', n.v, PERSON);
    case 'nil': return V('nil', null, PERSON);
    case 'sym': return env.get(n.v);
    case 'list': break;
  }
  const h = n.items[0].v, a = n.items.slice(1);
  const seq = async (forms, e, c) => { let r; for (const f of forms) r = await ev(f, e, c, cx); return r; };
  switch (h) {
    case 'let': {
      const e = new Map(env);
      for (const b of a[0].items) e.set(b.items[0].v, await ev(b.items[1], e, C, cx));
      return seq(a.slice(1), e, C);
    }
    case 'do': return seq(a, env, C);
    case 'if': {
      const c = await ev(a[0], env, C, cx);
      const r = await ev(truthy(c) ? a[1] : a[2], env, union(C, c.L), cx);
      return V(r.k, r.v, flow([r.L], [c.L]));                          // F-B: the branch is data, the condition control
    }
    case 'when': case 'unless': {
      const c = await ev(a[0], env, C, cx);
      if (truthy(c) === (h === 'when')) { const r = await seq(a.slice(1), env, union(C, c.L)); return V(r.k, r.v, flow([r.L], [c.L])); }
      return V('nil', null, flow([PERSON], [c.L]));
    }
    case 'and': case 'or': {
      const before = []; let c2 = C, r;
      for (const x of a) {
        r = await ev(x, env, c2, cx);
        if (truthy(r) === (h === 'or')) break;
        before.push(r.L); c2 = union(c2, r.L);
      }
      if (before.length === a.length) before.pop();                    // ran to the end: the last operand IS the value
      return V(r.k, r.v, flow([r.L], before));                         // F-B: earlier operands are control
    }
    case 'for-each': {
      const lst = await ev(a[0].items[1], env, C, cx);
      if (lst.k !== 'list') throw new ScriptError('RUN', 'for-each needs a list, got ' + KIND[lst.k], a[0], union(C, lst.L));
      if (lst.v.length > LIMITS.ITER) throw new ScriptError('RUN', 'for-each over more than ' + LIMITS.ITER + ' items', a[0], union(C, lst.L));
      const c2 = union(C, lst.L), name = a[0].items[0].v;
      for (const item of lst.v) { const e = new Map(env); e.set(name, V(item.k, item.v, flow([item.L], [lst.L]))); await seq(a.slice(1), e, c2); }
      return V('nil', null, flow([PERSON], [lst.L]));
    }
    case 'filter': case 'collect': case 'count': case 'sum': case 'max-by': case 'min-by': case 'sort-by': case 'the': {
      const lst = await ev(a[0].items[1], env, C, cx);
      if (lst.k !== 'list') throw new ScriptError('RUN', '(' + h + ' …) needs a list, got ' + KIND[lst.k], a[0], union(C, lst.L));
      if (lst.v.length > LIMITS.LIST) throw new ScriptError('RUN', '(' + h + ' …) over more than ' + LIMITS.LIST + ' items', a[0], union(C, lst.L));
      const c2 = union(C, lst.L), name = a[0].items[0].v, vals = [];
      let L = new Set(lst.L);
      for (const item of lst.v) {
        const e = new Map(env); e.set(name, V(item.k, item.v, flow([item.L], [lst.L])));
        const r = await ev(a[1], e, c2, cx); vals.push(r); L = union(L, r.L);
      }
      const tag = (item) => V(item.k, item.v, flow([item.L], [L]));       // an item in a result carries what chose it (F-B: as control)
      const VL = vals.map((r) => r.L);
      const SEL = flow([lst.L], VL);                                     // F-B: a selection of the list — the list is the data
      const COMP = flow([...VL, lst.L]);                                  // F-B review F2: the body values AND the list (its length) are data
      const keyOf = (r) => {
        if (r.k === 'num' || r.k === 'str') return r;
        throw new ScriptError('RUN', '(' + h + ' …) needs a number or text from its form, got ' + KIND[r.k], a[1], union(L, C));
      };
      const cmpKey = (x, y) => {
        if (x.k !== y.k) throw new ScriptError('RUN', '(' + h + ' …) cannot compare a number with text', a[1], union(L, C));
        return x.k === 'num' ? R.cmp(x.v, y.v) : (x.v < y.v ? -1 : x.v > y.v ? 1 : 0);
      };
      switch (h) {
        case 'filter': return V('list', lst.v.filter((_, i) => truthy(vals[i])).map(tag), SEL);
        case 'the': {
          const hit = lst.v.filter((_, i) => truthy(vals[i])).map(tag);
          if (hit.length === 1) return hit[0];
          if (hit.length === 0) throw new ScriptError('FAIL', 'not in the documents: (the …) matched no item', n, union(L, C));
          const e = new ScriptError('AMBIGUOUS', '(the …) matched ' + hit.length + ' items: the possibilities are returned, none is chosen', n, union(L, C));
          e.possibilities = hit.map((x) => toWire(x, n)); throw e;
        }
        case 'collect': return V('list', vals.map(tag), COMP);
        case 'count': return V('num', R.int(vals.filter(truthy).length), union(noCred(COMP), ['computed']));   // owner decision: never grounded
        case 'sum': {
          let t = R.int(0);
          for (const r of vals) {
            if (r.k !== 'num') throw new ScriptError('RUN', '(sum …) needs a number from its form, got ' + KIND[r.k], a[1], union(L, C));
            t = wrap(() => R.add(t, r.v), n, union(L, C));
          }
          return V('num', t, union(noCred(COMP), ['computed']));          // owner decision: a sum over a selection is never grounded
        }
        case 'max-by': case 'min-by': {
          let best = -1;
          for (let i = 0; i < vals.length; i++) {
            const k = keyOf(vals[i]);
            if (best < 0) { best = i; continue; }
            const c = cmpKey(k, vals[best]);
            if (h === 'max-by' ? c > 0 : c < 0) best = i;                 // ties: the first item wins
          }
          return best < 0 ? V('nil', null, flow([PERSON], [L])) : tag(lst.v[best]);
        }
        case 'sort-by': {
          vals.forEach(keyOf);
          const idx = lst.v.map((_, i) => i);
          idx.sort((i, j) => cmpKey(vals[i], vals[j]) || i - j);           // stable, ascending
          return V('list', idx.map((i) => tag(lst.v[i])), SEL);
        }
      }
    }
    case 'remember': {
      const v = await ev(a[1], env, C, cx);
      // F-B: the stored value is data; the conditions and everything seen before it are control
      try { cx.state.set(a[0].v, enc(v), flow([v.L], [C, cx.seen])); } catch (e) { throw new ScriptError('RUN', e.message, n, union(v.L, C)); }
      return v;
    }
    case 'remembered': {
      const s = cx.state.get(a[0].v);
      return s ? dec(s.value, new Set(s.labels)) : V('nil', null, flow([PERSON], [cx.state.absentLabels()]));
    }
    case 'input': return Object.prototype.hasOwnProperty.call(cx.input, a[0].v) ? fromJSON(cx.input[a[0].v], cx.inputLabels, n)
      : V('nil', null, noCred(cx.inputLabels));                        // F-B review F6: nothing was read, so no credential
    case 'fail': {
      const r = await ev(a[0], env, C, cx);
      throw new ScriptError('FAIL', 'script failed: ' + (r.k === 'str' ? r.v : String(toWire(r, n))), n, union(r.L, C));
    }
  }
  if (cx.fns.has(h)) {                                                // 1.6.0: as if the body were written here, arguments bound
    const f = cx.fns.get(h), e = new Map();
    for (let i = 0; i < f.params.length; i++) e.set(f.params[i], await ev(a[i], env, C, cx));
    return seq(f.body, e, C);
  }
  if (h === 'now') {                                                  // 1.6.0: the time of the message that started this run
    if (typeof cx.now !== 'string' || !cx.now) throw new ScriptError('RUN', '(now) is not available here (no message time)', n, C);
    return V('str', cx.now, new Set(['device']));
  }
  if (h in BUILTIN) {
    const xs = []; for (const x of a) xs.push(await ev(x, env, C, cx));
    return builtin(h, xs, n, C);
  }
  // an action call: :name value pairs → input; data labels go as labels, C as ctl (rule b)
  const input = {}; const ins = [];
  for (let i = 0; i < a.length; i += 2) { const v = await ev(a[i + 1], env, C, cx); input[a[i].v] = toWire(v, a[i + 1]); ins.push(v.L); }
  const L = flow(ins);                                                 // F-B: grounded only if every input is
  const ctl = [...noCred(union(C, cx.seen))].sort();                 // F-B round 3: control is never a credential
  const reply = await cx.callAction(h, input, { labels: [...L].sort(), ctl });
  cx.calls.push({ action: h, labels: [...L].sort(), ctl, ok: !!(reply && reply.ok) });
  const RL = new Set((reply && reply.labels) || []);
  if (!reply || !reply.ok) throw new ScriptError('ACTION', h + ' did not run: ' + ((reply && reply.code) || 'NO_REPLY') + ' ' + ((reply && reply.error) || ''), n, union(RL, C));
  return fromJSON(reply.value, RL, n);
}

function wrap(f, n, L) { try { return f(); } catch (e) { if (e instanceof ScriptError) throw e; throw new ScriptError('RUN', e.message, n, L); } }

function builtin(h, xs, n, C) {
  const L = union(...xs.map((x) => x.L));                             // for errors: everything
  const D = flow(xs.map((x) => x.L));                                  // F-B: for values — every operand is data
  const need = (k, x) => { if (x.k !== k) throw new ScriptError('RUN', '(' + h + ' …) needs ' + KIND[k] + ', got ' + KIND[x.k], n, union(L, C)); };
  switch (h) {
    case '=': {
      const [x, y] = xs; let eq;
      if (x.k !== y.k) eq = false;
      else if (x.k === 'num') eq = R.cmp(x.v, y.v) === 0;
      else if (x.k === 'list' || x.k === 'rec') throw new ScriptError('RUN', '(= …) compares numbers, text, true/false and nil only', n, union(L, C));
      else eq = x.v === y.v;
      return V('bool', eq, noCred(D));                                 // F-B round 3: computed
    }
    case '<': case '>': case '<=': case '>=': {
      xs.forEach((x) => need('num', x)); const c = R.cmp(xs[0].v, xs[1].v);
      return V('bool', h === '<' ? c < 0 : h === '>' ? c > 0 : h === '<=' ? c <= 0 : c >= 0, noCred(D));
    }
    case '+': case '*': case '-': case '/': {
      xs.forEach((x) => need('num', x));
      const f = { '+': R.add, '-': R.sub, '*': R.mul, '/': R.div }[h];
      const r = wrap(() => (h === '-' && xs.length === 1 ? R.neg(xs[0].v) : xs.slice(1).reduce((acc, x) => f(acc, x.v), xs[0].v)), n, union(L, C));
      return V('num', r, union(noCred(D), ['computed']));              // F-B round 3: arithmetic is never grounded
    }
    case 'str': {
      const parts = xs.map((x) => {
        if (x.k === 'str') return x.v; if (x.k === 'bool') return String(x.v); if (x.k === 'nil') return '';
        if (x.k === 'num') { const d = R.toDecimal(x.v); return d.exact ? d.text : R.toFraction(x.v); }
        throw new ScriptError('RUN', '(str …) joins text, numbers and true/false, not ' + KIND[x.k], n, union(L, C));
      });
      if (parts.reduce((t, x) => t + x.length, 0) > LIMITS.STR) throw new ScriptError('RUN', 'text longer than ' + LIMITS.STR + ' characters', n, union(L, C));   // 1.6.1 (U1): before joining
      const s = parts.join('');
      if (s.length > LIMITS.STR) throw new ScriptError('RUN', 'text longer than ' + LIMITS.STR + ' characters', n, union(L, C));
      return V('str', s, noCred(D));                                   // F-B round 3: joined text is new text
    }
    case 'len': {
      const [x] = xs;
      // F-B review F3 + owner decision, 3 Nov 2026: a length is never grounded (the program can choose it; a missing fact changes it) — computed
      if (x.k === 'str') return V('num', R.int(Array.from(x.v).length), union(noCred(D), ['computed']));
      if (x.k === 'list') return V('num', R.int(x.v.length), union(noCred(D), ['computed']));
      throw new ScriptError('RUN', '(len …) needs text or a list, got ' + KIND[x.k], n, union(L, C));
    }
    case 'list':
      if (xs.length > LIMITS.LIST) throw new ScriptError('RUN', 'a list longer than ' + LIMITS.LIST + ' items', n, union(L, C));
      return V('list', xs, D.size ? D : PERSON);              // F-B review F5
    case 'get': {
      const [r, k] = xs; need('rec', r); need('str', k);
      const G = flow([r.L], [k.L]);                                     // F-B: the record is data, the key only selects
      return Object.prototype.hasOwnProperty.call(r.v, k.v) ? fromJSON(r.v[k.v], G, n) : V('nil', null, noCred(G));
    }
    case 'number': {
      const [x] = xs;
      if (x.k === 'num') return x;
      need('str', x);
      const s = x.v.trim(), neg = s[0] === '-';
      const r = wrap(() => { const q = R.guard(R.parseDecimal(neg ? s.slice(1) : s)); return neg ? R.neg(q) : q; }, n, union(L, C));
      return V('num', r, union(D, ['computed']));
    }
    case 'not': return V('bool', !truthy(xs[0]), noCred(D));
  }
  return stdlib(h, xs, n, C, L, D, need);
}

// 1.6.0 — the standard library (ACTBUS docs/functions-and-mailboxes.md §2). Every function is total; every result is made by V (size budget); text ≤ STR, lists ≤ LIST.
function stdlib(h, xs, n, C, L, D, need) {
  const err = (m) => new ScriptError('RUN', '(' + h + ' …) ' + m, n, union(L, C));
  const cap = (t) => { if (t.length > LIMITS.STR) throw err('makes text longer than ' + LIMITS.STR + ' characters'); return t; };
  const capList = (arr) => { if (arr.length > LIMITS.LIST) throw err('makes a list longer than ' + LIMITS.LIST + ' items'); return arr; };
  const whole = (x, max) => {                                         // a whole number 0 … max
    need('num', x);
    if (!R.isInt(x.v) || x.v.n < 0n || x.v.n > BigInt(max)) throw err('needs a whole number from 0 to ' + max + ', got ' + R.toFraction(x.v));
    return Number(x.v.n);
  };
  const COMP = noCred(D), NUMC = union(noCred(D), ['computed']);
  const pick = (item, ...ctl) => V(item.k, item.v, flow([item.L], ctl));   // SELECTION: the item is data, what chose it control
  const textOf = (x) => { if (x.k === 'str') return x.v; if (x.k === 'num') { const d = R.toDecimal(x.v); return d.exact ? d.text : R.toFraction(x.v); } throw err('joins text and numbers, not ' + KIND[x.k]); };
  switch (h) {
    case 'upper': case 'lower': case 'trim': {
      need('str', xs[0]); const t = xs[0].v;
      return V('str', cap(h === 'upper' ? t.toUpperCase() : h === 'lower' ? t.toLowerCase() : t.trim()), COMP);
    }
    case 'contains?': case 'starts-with?': case 'ends-with?': {
      need('str', xs[0]); need('str', xs[1]); const [t, q] = [xs[0].v, xs[1].v];
      return V('bool', h === 'contains?' ? t.includes(q) : h === 'starts-with?' ? t.startsWith(q) : t.endsWith(q), COMP);
    }
    case 'split': {
      need('str', xs[0]); need('str', xs[1]);
      const parts = xs[1].v === '' ? Array.from(xs[0].v) : xs[0].v.split(xs[1].v);
      return V('list', capList(parts).map((t) => V('str', t, COMP)), COMP);
    }
    case 'join': {
      need('list', xs[0]); need('str', xs[1]);
      const ps = xs[0].v.map(textOf);
      if (ps.reduce((t, x) => t + x.length, 0) + Math.max(0, ps.length - 1) * xs[1].v.length > LIMITS.STR) throw err('makes text longer than ' + LIMITS.STR + ' characters');   // 1.6.1 (U1)
      const t = ps.join(xs[1].v);
      return V('str', cap(t), noCred(union(D, ...xs[0].v.map((i) => i.L))));
    }
    case 'replace': {
      xs.forEach((x) => need('str', x));
      if (xs[1].v === '') throw err('needs a non-empty text to find');
      const parts = xs[0].v.split(xs[1].v);
      if (xs[0].v.length + (parts.length - 1) * (xs[2].v.length - xs[1].v.length) > LIMITS.STR) throw err('makes text longer than ' + LIMITS.STR + ' characters');   // 1.6.1 (U1): before joining
      return V('str', cap(parts.join(xs[2].v)), COMP);
    }
    case 'first': case 'last': {
      need('list', xs[0]); const l = xs[0];
      if (!l.v.length) return V('nil', null, flow([PERSON], [l.L]));
      return pick(h === 'first' ? l.v[0] : l.v[l.v.length - 1], l.L);
    }
    case 'nth': {
      need('list', xs[0]); const i = whole(xs[1], LIMITS.LIST), l = xs[0];
      return i < l.v.length ? pick(l.v[i], l.L, xs[1].L) : V('nil', null, flow([PERSON], [l.L, xs[1].L]));
    }
    case 'take': case 'drop': {
      need('list', xs[0]); const k = whole(xs[1], LIMITS.LIST), l = xs[0];
      const part = h === 'take' ? l.v.slice(0, k) : l.v.slice(k);
      return V('list', part.map((it) => pick(it, l.L, xs[1].L)), flow([l.L], [xs[1].L]));
    }
    case 'reverse': { need('list', xs[0]); const l = xs[0]; return V('list', [...l.v].reverse().map((it) => pick(it, l.L)), l.L); }
    case 'append': {
      xs.forEach((x) => need('list', x));
      const all = capList([].concat(...xs.map((x) => x.v)));
      return V('list', all, xs.length ? D : PERSON);                     // a container: data, like list
    }
    case 'range': {
      const [a0, b0] = xs.length === 1 ? [0, whole(xs[0], LIMITS.LIST)] : [whole(xs[0], 1000000), whole(xs[1], 1000000)];
      if (b0 - a0 > LIMITS.LIST) throw err('makes a list longer than ' + LIMITS.LIST + ' items');
      const out = []; for (let i = a0; i < b0; i++) out.push(V('num', R.int(i), NUMC));
      return V('list', out, NUMC);
    }
    case 'empty?': {
      const [x] = xs;
      if (x.k === 'nil') return V('bool', true, COMP);
      if (x.k === 'str' || x.k === 'list') return V('bool', x.v.length === 0, COMP);
      throw err('needs text, a list or nil, got ' + KIND[x.k]);
    }
    case 'has?': { need('rec', xs[0]); need('str', xs[1]); return V('bool', Object.prototype.hasOwnProperty.call(xs[0].v, xs[1].v), COMP); }
    case 'keys': { need('rec', xs[0]); return V('list', capList(Object.keys(xs[0].v)).map((k) => V('str', k, COMP)), COMP); }
    case 'record': {
      const o = Object.create(null);
      for (let i = 0; i < xs.length; i += 2) {
        need('str', xs[i]); const k = xs[i].v;
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw err('cannot use the key ' + JSON.stringify(k));
        if (Object.prototype.hasOwnProperty.call(o, k)) throw err('has the key ' + JSON.stringify(k) + ' twice');
        o[k] = toWire(xs[i + 1], n);
      }
      const vL = xs.filter((_, i) => i % 2).map((x) => x.L), kL = xs.filter((_, i) => i % 2 === 0).map((x) => x.L);
      return V('rec', o, xs.length ? flow(vL, kL) : PERSON);               // a container: the values are data, the key names control
    }
    case 'min': case 'max': {
      xs.forEach((x) => need('num', x));
      let b = 0; for (let i = 1; i < xs.length; i++) { const c = R.cmp(xs[i].v, xs[b].v); if (h === 'max' ? c > 0 : c < 0) b = i; }   // ties: the first
      return pick(xs[b], ...xs.filter((_, i) => i !== b).map((x) => x.L));
    }
    case 'abs': { need('num', xs[0]); const v = xs[0].v; return V('num', R.cmp(v, R.int(0)) < 0 ? R.neg(v) : v, NUMC); }
    case 'round': {
      need('num', xs[0]); const places = xs.length > 1 ? whole(xs[1], 30) : 0;
      const m = 10n ** BigInt(places), x = xs[0].v, num0 = x.n * m;
      let q = num0 / x.d; const rem = num0 % x.d;
      if (2n * (rem < 0n ? -rem : rem) >= x.d) q += num0 < 0n ? -1n : 1n;   // half away from zero
      return V('num', R.make(q, m), NUMC);
    }
    case 'parse-json': {
      need('str', xs[0]); let j;
      // 1.6.1 (C1): every number must be read EXACTLY as written — JSON.parse makes a double; compare it with the source text
      const exact = (k, v, c) => {
        if (typeof v !== 'number') return v;
        const src = c && typeof c.source === 'string' ? c.source : null;
        if (src === null) throw err('cannot check JSON numbers exactly on this Node');
        if (/[eE]/.test(src)) throw err('got a number with an exponent (' + src.slice(0, 40) + '): not read');
        const neg = src[0] === '-', want = R.parseDecimal(neg ? src.slice(1) : src), w = neg ? R.neg(want) : want;
        const g = String(v), gn = g[0] === '-', got0 = /e/i.test(g) ? null : R.parseDecimal(gn ? g.slice(1) : g), got = got0 && (gn ? R.neg(got0) : got0);
        if (!got || R.cmp(w, got) !== 0) throw err('got the number ' + src.slice(0, 40) + ', which cannot be read exactly');
        return v;
      };
      try { j = JSON.parse(xs[0].v, exact); } catch (e) { if (e instanceof ScriptError) throw e; throw err('got text that is not JSON (' + String(e.message).slice(0, 80) + ')'); }
      const deep = (y, d) => { if (d > LIMITS.JSON_DEPTH) throw err('got JSON nested deeper than ' + LIMITS.JSON_DEPTH); if (y && typeof y === 'object') for (const k in y) deep(y[k], d + 1); };
      deep(j, 0);
      return fromJSON(j, union(D, ['computed']), n);                      // PARSING keeps a credential, like number
    }
    case 'to-json': return V('str', cap(JSON.stringify(toWire(xs[0], n))), COMP);
    case 'number?': return V('bool', xs[0].k === 'num', COMP);
    case 'text?': return V('bool', xs[0].k === 'str', COMP);
    case 'list?': return V('bool', xs[0].k === 'list', COMP);
    case 'record?': return V('bool', xs[0].k === 'rec', COMP);
    case 'nil?': return V('bool', xs[0].k === 'nil', COMP);
  }
  throw err('is not built in');
}

// run(forms, { actions, callAction, input, inputLabels, ctl, state, fuel, now }) → { value, labels, seen, fuelUsed, calls }
// now (1.6.0): the ISO time of the message that started the run — what (now) returns
// ctl: the control labels the script was CALLED under (the bus's env.ctl) — the run starts under them.
// Checks first (refused scripts never start). The value is the last top-level form's, as JSON with numbers as decimal text.
async function run(forms, opt = {}) {
  const actions = opt.actions || new Set();
  check(forms, actions);
  const inputLabels = new Set(opt.inputLabels || []);
  for (const l of inputLabels) if (!LABELS.includes(l)) throw new ScriptError('CHECK', 'unknown input label ' + JSON.stringify(l));
  const startCtl = new Set(opt.ctl || []);
  for (const l of startCtl) if (!LABELS.includes(l)) throw new ScriptError('CHECK', 'unknown control label ' + JSON.stringify(l));
  const fuelMax = opt.fuel || LIMITS.FUEL;
  const fns = new Map();                                              // 1.6.0: the defined functions (checked above)
  for (const f of forms) if (isDefine(f)) fns.set(f.items[1].items[0].v, { params: f.items[1].items.slice(1).map((x) => x.v), body: f.items.slice(2) });
  const cx = { fuel: fuelMax, fuelMax, calls: [], input: opt.input || {}, inputLabels, seen: startCtl, state: opt.state || memState(), fns, now: opt.now,
    callAction: opt.callAction || (async () => ({ ok: false, code: 'NO_BUS', error: 'no action bus attached' })) };
  let last = V('nil', null, PERSON), value;
  // 1.2.0 (021126, review finding R1): converting the final value (toWire: "no exact decimal form") is INSIDE the try, so that
  // error too carries everything seen — before, it carried only the final value's own labels
  try { for (const f of forms) { if (isDefine(f)) continue; last = await ev(f, new Map(), new Set(), cx); } value = toWire(last); }
  catch (e) {
    if (!(e instanceof ScriptError)) e = new ScriptError('RUN', String((e && e.message) || e).slice(0, 300), null, cx.seen);   // 1.6.1 (U1): never unlabelled
    e.labels = [...noCred(union(e.labels, cx.seen))].sort(); throw e;   // an error may quote anything seen
  }
  return { value, labels: [...last.L].sort(), seen: [...cx.seen].sort(), fuelUsed: fuelMax - cx.fuel, calls: cx.calls };
}

module.exports = { check, run, memState, ScriptError, LIMITS, SPECIAL, BUILTIN, COLL };
