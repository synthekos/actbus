// shutdown.js — v1.1.0 · the host's stop path stops every script daemon first · changelog: act/CHANGELOG.md#actshutdownjs
// SPDX-License-Identifier: Apache-2.0
// ## Design
// (C) John Koperwas 2026 · Koperwas Systems
// installShutdown({ stop, server }) — wired once by server.js. `server` may be the server or a function returning it (server.js passes
// () => server, so the wiring can sit before the server is made). Before 0.53.5 server.js had NO SIGTERM / SIGINT handler: a stopped server died
// at once and its script daemons were left to notice the closed IPC channel (pkd.js 'disconnect' → exit), which a BUSY daemon only does after
// its current fuel-limited run (measured ~3 s). That was the one exception to the daemon cap being a hard process bound (0.53.3).
//   · SIGTERM / SIGINT / SIGHUP: stop() first — act.stop() → engine.close() → supervisor.close(): every daemon SIGKILLed, synchronously — then close the
//     listener, then die of the SAME signal (the handlers are removed and the signal raised again). So everything outside sees exactly what it
//     saw before: the host start script's kill (and its kill -9 after 5 s), the watchdog, npm, launchd. No drain, no new wait: requests in flight are
//     cut as before. A second signal while stopping is ignored (the first is already finishing).
//     SIGHUP (a terminal closing, a session ending): Node resets every signal to its default when it starts, so the server died of SIGHUP
//     before too, even under the host start script's nohup (measured: status 129) — handling it changes nothing but the daemons dying first.
//   · 'exit' (process.exit, an uncaught exception): stop(). WHY THIS IS SOUND: an 'exit' listener runs synchronous code only — nothing
//     awaited or scheduled there ever runs — and act.stop() → engine.close() → supervisor.close() SIGKILLs every daemon synchronously
//     (child.kill() is a system call). If close() is ever made async, this path silently stops nothing: shutdown.test.js's process.exit and
//     uncaught-exception tests then fail — this is why.
//   · stop() runs at most once; if it throws — including because what it calls does not exist yet (server.js passes () => act.stop(), and
//     a signal could come before act is created) — that is logged and the stop goes on: the listener is closed if there is one, and the
//     signal is raised again. So the order of the lines in server.js cannot reopen the gap, only shorten what there is to stop.
//   · NOT covered (stated in the limits): SIGKILL of the server itself, or a native crash — no code runs; the daemons then exit on disconnect
//     after their current run, as before.
'use strict';
const SIGNALS = Object.freeze(['SIGTERM', 'SIGINT', 'SIGHUP']);

function installShutdown({ stop, server = null, proc = process, log = console } = {}) {
  if (typeof stop !== 'function') throw new TypeError('installShutdown: stop() is required');
  let stopped = false, signalled = null;
  const say = (how, m) => { try { log[how](m); } catch { /* a broken log must not stop the stop */ } };
  const stopOnce = () => {
    if (stopped) return false;
    stopped = true;
    try { stop(); } catch (e) { say('error', '[shutdown] stopping the script daemons failed (' + (e instanceof ReferenceError ? 'not created yet: ' : '') + String((e && e.message) || e) + ') — going on'); }
    return true;
  };
  const onSignal = (sig) => {
    if (signalled) return;
    signalled = sig;
    say('log', '[shutdown] ' + sig + ' — stopping the script daemons, closing the listener');
    stopOnce();
    try { const s = typeof server === 'function' ? server() : server; if (s && s.listening) s.close(); } catch { /* not made yet, or already closed */ }
    for (const [name, f] of handlers) proc.removeListener(name, f);
    proc.kill(proc.pid, sig);                                   // no handler left: the default action — the process dies of this signal
  };
  const handlers = SIGNALS.map((name) => [name, () => onSignal(name)]);
  const onExit = () => { stopOnce(); };
  for (const [name, f] of handlers) proc.on(name, f);
  proc.on('exit', onExit);
  return { get stopped() { return stopped; }, get signalled() { return signalled; } };
}

module.exports = { installShutdown, SIGNALS };
