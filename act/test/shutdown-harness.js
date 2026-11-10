// shutdown-harness.js — v1.0.0 · not a test: a stand-in host that `shutdown.test.js` runs as a child process · changelog: act/CHANGELOG.md#acttestshutdown-harnessjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// NOT a test file: shutdown.test.js runs it as a child process, a stand-in for server.js.
// It builds a real bus + engine + supervisor (as daemon.test.js's world()), starts ONE long script run in a REAL pkd daemon, listens on a port,
// then prints {pid, daemons, port, dirs} and waits (the test deletes dirs, its two temp folders, afterwards). argv: <with|without> <SIGTERM|SIGINT|exit|throw|wait>
//   with     → installShutdown({ stop: () => engine.close(), server }) — what server.js wires (act.stop() ends in engine.close())
//   without  → no handler: the behaviour before 0.53.5
//   exit / throw → the harness itself calls process.exit(3) / throws, once the daemon is busy
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const ROOT = path.join(__dirname, '..');
const registry = require(path.join(ROOT, 'core/registry'));
const caps = require(path.join(ROOT, 'core/capabilities'));
const { Names } = require(path.join(ROOT, 'core/names'));
const { Bus } = require(path.join(ROOT, 'core/bus'));
const { createEngine } = require(path.join(ROOT, 'proteus/engine'));
const { Supervisor } = require(path.join(ROOT, 'daemon/supervisor'));
const [mode, how] = process.argv.slice(2);
const shutdown = mode === 'with' ? require(path.join(ROOT, 'shutdown')) : null;   // loaded first: on 0.53.4 it is missing and nothing is made
if (mode !== 'with' && mode !== 'without') { console.error('mode?'); process.exit(9); }
const tmp = (t) => fs.mkdtempSync(path.join(os.tmpdir(), 'pkd-shut-' + t + '-'));
const LONG = '(for-each (a (input xs)) (for-each (b (input xs)) (for-each (c (input xs)) (+ (number a) (number b) (number c)))))';
const XS = Array.from({ length: 100 }, (_, i) => String(i));

const dir = tmp('act'), box = tmp('box');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'actions/registry.spec.json'), 'utf8')).actions.filter((e) => e.kind !== 'script');
for (const f of fs.readdirSync(path.join(ROOT, 'actions'))) if (f.endsWith('.js')) fs.copyFileSync(path.join(ROOT, 'actions', f), path.join(dir, f));
fs.writeFileSync(path.join(dir, 'long.pk'), LONG);
const spec = [...SPEC, { name: 'long', version: '1.0.0', kind: 'script', file: 'long.pk', produces: 'computed', world: false, runsAs: 'long', needs: [], input: { xs: 'array?' }, acceptWarnings: true }];
fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ actions: spec.map((e) => ({ ...e, sha256: registry.sha256(fs.readFileSync(path.join(dir, e.file))) })) }));
const pids = [];
const sup = new Supervisor({ audit: () => {}, max: 2, crashLimit: 99 });
const spawn = sup.spawn.bind(sup); sup.spawn = (id) => { const x = spawn(id); pids.push(x.child.pid); return x; };
const engine = createEngine({ stateRoot: box, audit: () => {}, daemon: sup, fuel: 1e9 });
const loaded = registry.load(dir, 'registry.json', { scriptEngine: engine });
if (loaded.refused.length) { console.error('refused: ' + JSON.stringify(loaded.refused)); process.exit(9); }
const ids = caps.fromList([{ name: 'alex', kind: 'person', owner: 'alex', actions: { long: {} } }, { name: 'long', kind: 'script', owner: 'alex', actions: { long: {} } }]);
const bus = new Bus({ registry: loaded.actions, identities: ids, names: new Names('local'), fetch: async () => ({ status: 404, text: async () => '' }), filesRoot: box, audit: () => {} });
const server = http.createServer((q, r) => r.end('ok'));
if (shutdown) shutdown.installShutdown({ stop: () => engine.close(), server, log: { log() {}, error() {} } });

bus.ask('alex', 'long', { xs: XS }, {}).catch(() => {});
server.listen(0, '127.0.0.1', () => {
  const t0 = Date.now();
  const ready = () => {                                           // the daemon is forked and its run has been handed to it
    const x = sup.d.get('long');
    if (x && x.busy && pids.length) {
      process.stdout.write(JSON.stringify({ pid: process.pid, daemons: pids, port: server.address().port, dirs: [dir, box] }) + '\n');
      if (how === 'exit') setTimeout(() => process.exit(3), 50);
      else if (how === 'throw') setTimeout(() => { throw new Error('harness: an uncaught exception'); }, 50);
      return;
    }
    if (Date.now() - t0 > 10000) { console.error('the daemon never got busy'); process.exit(9); }
    setTimeout(ready, 10);
  };
  ready();
});
setInterval(() => {}, 1000);                                      // stay up until signalled
