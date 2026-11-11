// reader.js — v1.0.0 · the PROTEUS-K reader: source text to a tree · changelog: act/CHANGELOG.md#actproteusreaderjs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// PROTEUS-K v0 reader: source text → tree (ACTBUS docs/proteus-k.md §2)
// The reader only builds a tree; it evaluates nothing. Every node carries its line:column so every error can name it.
//   form    := atom | '(' form* ')'
//   number  := -?digits(.digits)?   kept as its source text; the interpreter makes it an exact rational (rational.js)
//   string  := "…" with \" \\ \n \t only (raw newlines and tabs allowed; other control characters refused)
//   symbol  := [a-z][a-z0-9-]{0,47}?  — or one of the operators  + - * / = < > <= >=
//   keyword := :symbol  (argument names in action calls)      true false nil      comment := ; to end of line
// Limits (refused, with line:column): source ≤ 16 KB, nesting ≤ 64, ≤ 4 000 forms, a string ≤ 64 KB.
// Source must be valid UTF-8; non-ASCII is allowed only inside strings and comments.
'use strict';

const LIMITS = Object.freeze({ SOURCE_BYTES: 16 * 1024, DEPTH: 64, FORMS: 4000, STRING_CHARS: 64 * 1024, NAME_CHARS: 48 });
const OPS = Object.freeze(['+', '-', '*', '/', '=', '<', '>', '<=', '>=']);
const SYMBOL = /^[a-z][a-z0-9-]{0,47}\??$/;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const DELIM = new Set(['(', ')', '"', ';', ' ', '\t', '\n', '\r']);

class ReadError extends Error {
  constructor(msg, line, col) { super(msg + ' (line ' + line + ':' + col + ')'); this.code = 'READ'; this.line = line; this.col = col; }
}

// read(src) → array of top-level forms. src: string or Buffer (a Buffer is decoded as strict UTF-8).
function read(src) {
  if (Buffer.isBuffer(src)) {
    if (src.length > LIMITS.SOURCE_BYTES) throw new ReadError('source larger than ' + LIMITS.SOURCE_BYTES + ' bytes', 1, 1);
    try { src = new TextDecoder('utf-8', { fatal: true }).decode(src); } catch { throw new ReadError('source is not valid UTF-8', 1, 1); }
  }
  if (typeof src !== 'string') throw new ReadError('source must be text', 1, 1);
  if (Buffer.byteLength(src, 'utf8') > LIMITS.SOURCE_BYTES) throw new ReadError('source larger than ' + LIMITS.SOURCE_BYTES + ' bytes', 1, 1);
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);              // a leading byte-order mark is not code

  let i = 0, line = 1, col = 1, forms = 0;
  const peek = () => src[i];
  const next = () => { const c = src[i++]; if (c === '\n') { line++; col = 1; } else col++; return c; };
  const count = (l, c) => { if (++forms > LIMITS.FORMS) throw new ReadError('more than ' + LIMITS.FORMS + ' forms', l, c); };

  function skip() {
    for (;;) {
      const c = peek();
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { next(); continue; }
      if (c === ';') { while (i < src.length && peek() !== '\n') next(); continue; }
      return;
    }
  }

  function form(depth) {
    skip();
    const l = line, c = col, ch = peek();
    if (ch === undefined) throw new ReadError('unexpected end of source', l, c);
    if (ch === ')') throw new ReadError('unexpected )', l, c);
    count(l, c);
    if (ch === '(') {
      if (depth >= LIMITS.DEPTH) throw new ReadError('nested deeper than ' + LIMITS.DEPTH, l, c);
      next();
      const items = [];
      for (;;) {
        skip();
        if (i >= src.length) throw new ReadError('( opened here is never closed', l, c);
        if (peek() === ')') { next(); break; }
        items.push(form(depth + 1));
      }
      return { t: 'list', items, line: l, col: c };
    }
    if (ch === '"') return string(l, c);
    return atom(l, c);
  }

  function string(l, c) {
    next();                                                        // the opening quote
    let out = '';
    for (;;) {
      if (i >= src.length) throw new ReadError('string opened here is never closed', l, c);
      const lc = line, cc = col, ch = next();
      if (ch === '"') break;
      if (ch === '\\') {
        if (i >= src.length) throw new ReadError('string opened here is never closed', l, c);
        const e = next();
        if (e === '"') out += '"'; else if (e === '\\') out += '\\'; else if (e === 'n') out += '\n'; else if (e === 't') out += '\t';
        else throw new ReadError('unknown escape \\' + e + ' (only \\" \\\\ \\n \\t)', lc, cc);
      } else {
        const code = ch.charCodeAt(0);
        if ((code < 0x20 && ch !== '\n' && ch !== '\t') || code === 0x7f) throw new ReadError('control character U+' + code.toString(16).padStart(4, '0') + ' in a string (use \\n or \\t)', lc, cc);
        out += ch;
      }
      if (out.length > LIMITS.STRING_CHARS) throw new ReadError('string longer than ' + LIMITS.STRING_CHARS + ' characters', l, c);
    }
    return { t: 'str', v: out, line: l, col: c };
  }

  function atom(l, c) {
    let tok = '';
    while (i < src.length && !DELIM.has(peek())) tok += next();
    if (tok === 'true' || tok === 'false') return { t: 'bool', v: tok === 'true', line: l, col: c };
    if (tok === 'nil') return { t: 'nil', line: l, col: c };
    if (NUMBER.test(tok)) return { t: 'num', s: tok, line: l, col: c };
    if (OPS.includes(tok)) return { t: 'sym', v: tok, line: l, col: c };
    if (tok[0] === ':') {
      const k = tok.slice(1);
      if (SYMBOL.test(k) && !k.endsWith('?')) return { t: 'kw', v: k, line: l, col: c };
      throw new ReadError('bad keyword ' + JSON.stringify(tok) + ' (:name — a-z, 0-9, -; starts with a letter)', l, c);
    }
    if (SYMBOL.test(tok)) return { t: 'sym', v: tok, line: l, col: c };
    if (/[^\x21-\x7e]/.test(tok)) throw new ReadError('character outside a string or comment: ' + JSON.stringify(tok), l, c);
    throw new ReadError('not a name, number or operator: ' + JSON.stringify(tok), l, c);
  }

  const out = [];
  for (;;) { skip(); if (i >= src.length) break; out.push(form(0)); }
  return out;
}

// print(node) → the canonical text: single spaces, no comments. For display and diff only — the registry pins the FILE's bytes.
function print(n) {
  if (Array.isArray(n)) return n.map(print).join('\n');
  switch (n.t) {
    case 'list': return '(' + n.items.map(print).join(' ') + ')';
    case 'str': return '"' + n.v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
    case 'num': return n.s;
    case 'sym': return n.v;
    case 'kw': return ':' + n.v;
    case 'bool': return n.v ? 'true' : 'false';
    case 'nil': return 'nil';
    default: throw new Error('print: unknown node ' + JSON.stringify(n.t));
  }
}

module.exports = { read, print, ReadError, LIMITS, OPS };
