// durable.js — v1.0.0 · an append-only file whose every line is on disk before the call returns · changelog: act/CHANGELOG.md#actcoredurablejs
// SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// an append-only file whose every line is ON DISK before the call returns
// "No audit line, no run" means the line survives a crash, not just that it reached the page cache: the file is opened ONCE (append,
// 0600), each line is written with writeSync and flushed with fsyncSync. Before each line the path is checked: a rotated or removed file is
// reopened (and created again) first; a bad descriptor is reopened once; any other failure is thrown — the caller refuses to run (fail closed).
// macOS note: fsync hands the data to the drive; F_FULLFSYNC (drive cache flush) is not available from Node. Recorded, accepted.
'use strict';
const fs = require('fs');

function appender(file) {
  let fd = null;
  const open = () => { fd = fs.openSync(file, 'a', 0o600); };
  const put = (buf) => { let off = 0; while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off); fs.fsyncSync(fd); };
  return function append(line) {
    const buf = Buffer.from(String(line).endsWith('\n') ? String(line) : String(line) + '\n', 'utf8');
    // a rotated or removed file: the old descriptor would write into the void — reopen BEFORE writing when the path no longer names it
    if (fd !== null) { let same = false; try { same = fs.fstatSync(fd).ino === fs.statSync(file).ino; } catch (_) {} if (!same) { try { fs.closeSync(fd); } catch (_) {} fd = null; } }
    if (fd === null) open();
    try { put(buf); }
    catch (e) {
      if (e && (e.code === 'EBADF' || e.code === 'ESTALE')) { try { fs.closeSync(fd); } catch (_) {} open(); put(buf); return; }
      throw e;
    }
  };
}

module.exports = { appender };
