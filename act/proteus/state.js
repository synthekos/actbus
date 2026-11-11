// state.js — v1.1.1 · a script's remembered values, on disk · changelog: act/CHANGELOG.md#actproteusstatejs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026
// PROTEUS-K script state on disk (ACTBUS docs/proteus-k.md §6)
// One folder per script identity: <stateRoot>/s-<identity>/state.json — visible only to that script (the engine opens the
// folder of the identity the script runs AS). Each value is stored WITH its labels; "absent" holds the labels of every write
// (whether a key is missing can be steered too). Every write: temp file + rename (never a half-written file) and an audit
// line (key, labels, size — not the value). A file that does not parse or has the wrong shape REFUSES the run: no silent reset.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { LIMITS } = require('./eval');
const LABELS = ['person', 'device', 'computed', 'grounded', 'model', 'web'];
const NAME = /^[a-z][a-z0-9-]{0,47}$/;

function fileState(root, identity, audit) {
  if (!root) throw new Error('no state folder is configured on this node');
  if (!NAME.test(identity)) throw new Error('bad identity name for script state');
  const realRoot = fs.realpathSync(root);
  const dir = path.join(realRoot, 's-' + identity);
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('the script state folder is not a plain folder');
  const file = path.join(dir, 'state.json');
  let data = { v: 1, keys: {}, absent: [] };
  if (fs.existsSync(file)) {
    const fst = fs.lstatSync(file);
    if (!fst.isFile()) throw new Error('script state for ' + identity + ' is not a plain file — refusing to run');
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('script state for ' + identity + ' is corrupt (not JSON) — refusing to run; no silent reset'); }
    const okLabels = (l) => Array.isArray(l) && l.every((x) => LABELS.includes(x));
    const ok = data && data.v === 1 && data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys) && okLabels(data.absent)
      && Object.entries(data.keys).every(([k, x]) => NAME.test(k) && x && typeof x === 'object' && 'value' in x && okLabels(x.labels));
    if (!ok) throw new Error('script state for ' + identity + ' has the wrong shape — refusing to run; no silent reset');
  }
  const write = () => {
    const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  return {
    get: (key) => (Object.hasOwn(data.keys, key) ? data.keys[key] : undefined),
    set: (key, value, labels) => {
      if (!NAME.test(key)) throw new Error('bad state key ' + JSON.stringify(key));
      if (!Object.hasOwn(data.keys, key) && Object.keys(data.keys).length >= LIMITS.STATE_KEYS) throw new Error('more than ' + LIMITS.STATE_KEYS + ' remembered keys');
      const size = JSON.stringify(value).length;
      if (size > LIMITS.STATE_BYTES) throw new Error('a remembered value larger than ' + LIMITS.STATE_BYTES + ' bytes');
      const given = labels instanceof Set ? [...labels] : labels;   // 1.1.1: the evaluator passes a Set, the daemon path a list
      if (!Array.isArray(given) || given.some((l) => !LABELS.includes(l))) throw new Error('bad state labels for ' + key);
      const lab = [...new Set(given)].sort();
      data.keys[key] = { value, labels: lab };
      data.absent = [...new Set([...data.absent, ...lab])].sort();
      write();
      if (audit) audit({ kind: 'state-set', identity, key, labels: lab, size });
    },
    absentLabels: () => [...data.absent],
    snapshot: () => JSON.parse(JSON.stringify({ keys: data.keys, absent: data.absent })),
    file,
  };
}

module.exports = { fileState };
