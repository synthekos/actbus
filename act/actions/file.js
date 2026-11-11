// file.js — v1.1.0 · append to, or read, a text file in the identity's own folder · changelog: act/CHANGELOG.md#actactionsfilejs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// TENTACLE: append to / read a text file in the identity's OWN folder only (ACTBUS docs/capability-architecture.md §1 item 3)
// 1.1.0 (adversarial review): (a) files are opened with O_NOFOLLOW and checked through the OPEN handle (regular file,
// one link) — a dangling or swapped symlink can no longer redirect a write outside the folder, and there is no
// check-then-use gap; the folder is checked with lstat only. (b) provenance is stored WITH the file: every append records
// its labels in a sidecar (.labels-<name>.json, a dot-name callers cannot touch), and file-read returns their union —
// tainted text written once can no longer come back "clean". A file with no sidecar (made outside the bus) reads as "web".
// One file, two registry entries: file-append { name, text } and file-read { name }. Which one runs is decided by the
// registered action name the bus passes (ctx.action) — never by anything in the caller's input.
// The folder is <filesRoot>/<identity>/, where identity is the identity the action RUNS AS. A name is one plain file
// name (letters, digits, . _ -; not starting with a dot) — no paths, no "..". Appends ≤ 64 KB each, a file ≤ 10 MB.
'use strict';
const fs = require('fs'), path = require('path');
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/;
const MAX_APPEND = 64 * 1024, MAX_FILE = 10 * 1024 * 1024;
const C = fs.constants;
const KNOWN = ['person', 'device', 'computed', 'grounded', 'model', 'web'];

function folderFor(ctx) {
  if (!ctx.filesRoot) throw new Error('no files folder is configured on this node');
  const root = fs.realpathSync(ctx.filesRoot);
  const dir = path.join(root, ctx.identity);
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('the identity folder is not a plain folder');
  return dir;
}
function names(ctx, name) {
  if (!NAME.test(String(name)) || String(name).includes('..')) throw new Error('name must be one plain file name (letters, digits, . _ -), no folders');
  const dir = folderFor(ctx), file = path.join(dir, name);
  if (path.dirname(file) !== dir) throw new Error('name must stay inside the identity folder');
  return { file, side: path.join(dir, '.labels-' + name + '.json') };
}
// open without following a symlink, then check the OPEN handle — no gap between check and use
function openSafe(file, flags) {
  let fd;
  try { fd = fs.openSync(file, flags | C.O_NOFOLLOW, 0o600); }
  catch (e) { if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new Error('refusing a symlink'); if (e.code === 'ENOENT') throw new Error('no such file'); throw e; }
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.nlink !== 1) { fs.closeSync(fd); throw new Error('refusing: not a plain file with a single link'); }
  return { fd, size: st.size };
}
function readLabels(side) {
  let h;
  try { h = openSafe(side, C.O_RDONLY); } catch { return null; }
  try { const j = JSON.parse(fs.readFileSync(h.fd, 'utf8')); return Array.isArray(j.labels) ? j.labels.filter((l) => KNOWN.includes(l)) : null; }
  catch { return null; } finally { fs.closeSync(h.fd); }
}
function writeLabels(side, labels) {
  const h = openSafe(side, C.O_WRONLY | C.O_CREAT);
  try { fs.ftruncateSync(h.fd, 0); fs.writeSync(h.fd, JSON.stringify({ labels }), 0); } finally { fs.closeSync(h.fd); }
}

function append(input, ctx) {
  const { file, side } = names(ctx, input.name), text = String(input.text);
  const n = Buffer.byteLength(text);
  if (n > MAX_APPEND) throw new Error('text larger than 64 KB');
  const h = openSafe(file, C.O_WRONLY | C.O_APPEND | C.O_CREAT);
  try {
    if (h.size + n > MAX_FILE) throw new Error('the file would exceed 10 MB');
    const had = h.size === 0 ? [] : (readLabels(side) || ['web']);
    writeLabels(side, [...new Set([...had, ...ctx.labels()])]);   // labels first: a crash between the two over-taints, never under-taints
    fs.writeSync(h.fd, text);
    return { name: input.name, bytes: n, size: h.size + n };
  } finally { fs.closeSync(h.fd); }
}
function read(input, ctx) {
  const { file, side } = names(ctx, input.name);
  const h = openSafe(file, C.O_RDONLY);
  try {
    if (h.size > MAX_FILE) throw new Error('file larger than 10 MB');
    const text = fs.readFileSync(h.fd, 'utf8');
    ctx.addLabels(readLabels(side) || ['web']);                   // the file's provenance travels with its text
    return { name: input.name, text };
  } finally { fs.closeSync(h.fd); }
}

function run(input, ctx) {
  if (ctx.action === 'file-append') return append(input, ctx);
  if (ctx.action === 'file-read') return read(input, ctx);
  throw new Error('file.js serves file-append and file-read only, not ' + ctx.action);
}

module.exports = { run };
