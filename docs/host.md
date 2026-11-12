<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# The host's contract

What a host gives the kernel, what it gets back, and what it must call. `examples/minimal-host.js` shows the smallest case, and `examples/script-host.js` a host with one script; this page is the full reference. Line numbers are of the files in this repository.

## What `create()` returns, and what a host must call

`create(opts)` (`act.js`:173) returns one object (`act.js`:463). A host uses these members:

| Member | What it is | When a host calls it |
|---|---|---|
| `route(req, res)` | the request handler (below) | for every request from an EUser |
| `saveGrants(euser, json, adminLoginId)` | checks and saves an EUser's grants; the change is audited before it is saved. `adminLoginId` is recorded in the audit line as given: the kernel does not check it, so the host checks that the caller is an administrator | when an administrator changes an EUser's actions |
| `clearForRoleChange(before, newRole, adminLoginId)` | clears the grants of a record that stops being an EUser, audited first | whenever a record's role changes |
| `stop()` | stops the mailbox and scheduler timers, the outbox and every script daemon | once, when the host stops |
| `LOG` | the path of the audit log, `<appDir>/logs/act.jsonl` | to read or ship the audit |

The other members (`panelHtml`, `loadIdentities`, `actionNames`, `refused`, `bus`, `FILES_ROOT`, `engine`, `outbox`, `mailbox`, `scheduler`, `schedTick`, `webOff`, `mailProblems`, `schedProblems`) are what SYNTHEKOS's admin screens and the tests read; a host does not need them.

**Shutdown.** `act/shutdown.js` exports `installShutdown({ stop, server })`. A host wires it once, with `stop: () => act.stop()`: on SIGTERM, SIGINT or SIGHUP it calls `stop()` first, which kills every script daemon, then closes the server and lets the signal end the process. Without it, a busy script daemon can outlive the server by its current run. The one test that `npm test` leaves out checks that SYNTHEKOS's `server.js` wires it.

## The user records

The kernel reads the host's records through a Prisma-style handle, `prisma.user`, with three calls:
- `findMany({ where: { actGrants: { not: null } } })` (`act.js`:245): every record with grants. A store that ignores the filter may return every record; the kernel skips those without grants.
- `findUnique({ where })`, with `where` either `{ uniqueId }` or `{ loginId }`.
- `update({ where: { uniqueId }, data: { actGrants } })`.

A record has `uniqueId`, `loginId`, `role`, `auth` and `actGrants` (a JSON string, or `null`).
- **An EUser** has `role: 'euser'`. Its identity name is `u-` followed by its `uniqueId` in lower case.
- **A person** has `role: 'user'` or `role: 'admin'`, and `auth: 'login'` or no `auth` (`act.js`:91). Any other `auth` (SYNTHEKOS uses `'key'` for its machines) makes the record not a person, and a grant it owns is refused.

## Grants

`saveGrants` takes the grant as JSON text; `parseGrants` (`act.js`:94) checks it and returns `{ ok, value, errors }`. The text is at most 8000 characters. Its fields:

| Field | Required | What it is |
|---|---|---|
| `owner` | yes | the `loginId` of the person accountable for this EUser; the kernel keeps the person (`ownerId`), so a rename keeps the grant with them |
| `actions` | yes | at most 50 entries, `{ "<action>": { …options } }`; `{}` for no options |
| `models` | no | the model names the `model` action may use, at most 20 |
| `rate` | no | messages per minute, a whole number from 1 to 10000 (default 120); a script's calls count against the caller who started it; a time trigger's root is its `runsAs` identity, so a trigger pays for its own work |
| `operatedByPerson` | no | `true` when a person operates this EUser (a phone, say): what it sends is labelled `person`. Refused together with an action that brings web or model text into the EUser itself, such as `fetch`, `model` or `file-read` |

Each action's options:
- `targets`: at most 50. What a target is depends on the action: a lower-case host name, optionally `:port`, for `fetch` (`http://host` for plain HTTP); a lower-case address that is on `MAIL_ALLOW` for `email`; an identity name (`u-…`) for `send` (whom it may send to) and `messages` (who may send to it). Targets for an action whose registry entry declares no `targetForm` are refused, at save and at load: that is every action but `fetch`, `email`, `send` and `messages`.
- `allowTainted: true`: text from the web or a model may reach this world action. An explicit rule; leave it out unless it is meant.
- `strictControl: true`: refuse this world action when it would run under a condition that depends on web or model text, unless `allowTainted` is also given.

## Requests

`route(req, res)` is an Express-style handler. `req.euser` is the EUser's record, already authenticated by the host. `req.body` is `{ "action": "…", "input": { … }, "id": "…", "labels": [ … ] }`: `id` (a string) is optional and is the message id the duplicate check uses; `labels` is an optional list of at most 6 of the six labels `person`, `device`, `computed`, `grounded`, `model` and `web`; any other answers 400 `BAD_ENVELOPE`. A host sends `web` or `model` with text it got from the web or a model, so that the taint rule applies to it. The labels are added to the message, except `grounded`, which is dropped: a caller cannot declare a credential (`act/core/envelope.js`, `root`). Every request from an EUser is also labelled `device`, without asking.

Before the bus sees a request, `route` (`act.js`:323) does this, in order:
1. reads the identities and grants fresh from the records (a failure answers 500 `IDENTITIES`);
2. counts the request against the EUser's rate (its grant's `rate`, or 30 a minute for a record with no usable grant). Over the rate it answers 429 `RATE`, and this refusal is not written to the audit log, so a flood cannot fill the disk;
3. refuses an EUser with no usable grant (403 `NOT_PERMITTED`, with the reason);
4. checks the body's shape, the action's name and `labels` (400 `BAD_ENVELOPE`);
5. for a world action, a `send` or a script, adds the labels of every web or model text this EUser could also receive (not for a script that declares no input, and not for the own `send` of an EUser with `operatedByPerson`).

The refusals of steps 1, 3 and 4 are audited, at most 10 a minute per EUser. Then the bus runs its own checks (README, the list at the top).

`act/core/edge.js` also exports `createEdge` and `keyResolver`: a second handler for `POST /api/act`, which turns a key into an identity. It is the core's own test edge, used by `act/test/`. A host uses `act.route`, and authenticates its EUsers itself. `act.js`'s header names `POST /api/act` with `Authorization: Bearer <the EUser's key>` as the way SYNTHEKOS's own server serves `route`: that is how SYNTHEKOS authenticates, not something the kernel reads.

**The reply** is JSON: `{ "ok": true, … }` with status 200, or `{ "ok": false, "code": "…", "error": "…" }`. A 503 `DEDUPE_FULL` refusal also has `"retryAfterMs"`: the milliseconds until the identity can be served again. The status of a refusal by the bus (`act/core/edge.js`:19):

| Status | Codes |
|---|---|
| 400 | `BAD_ENVELOPE`, `BAD_INPUT` |
| 401 | `UNKNOWN_IDENTITY` |
| 403 | `NOT_PERMITTED`, `TAINTED`, `NO_TARGET` |
| 404 | `UNKNOWN_ACTION` |
| 409 | `DUPLICATE` |
| 422 | `ACTION_ERROR` |
| 429 | `RATE`, `BUDGET`, `HOP_LIMIT` |
| 500 | `AUDIT` |
| 502 | `NO_ROUTE` |
| 503 | `DAEMON_FULL`, `DAEMON_EVICTING`, `DAEMON_OVERLAP`, `DAEMON_PAUSED`, `DAEMON_RESTARTING`, `DEDUPE_FULL` |
| 504 | `TIMEOUT` |

The `DAEMON_…` refusals are transient, and the reply carries `Retry-After: 5`. `DEDUPE_FULL` is transient too, and its `Retry-After` is `retryAfterMs` in whole seconds, rounded up, at least 1. An exception inside the kernel answers 500 `INTERNAL`.

**The dedupe check.** The bus keeps the id of every request that passes this check (the README's second) for 24 h, on disk (`<appDir>/act-files/.dedupe.jsonl`), and a repeated id answers 409 `DUPLICATE`. It keeps at most 50 000 ids per identity inside that window. At that cap a new id is refused 503 `DEDUPE_FULL` until the identity's oldest id leaves the window. So an identity can send at most 50 000 ids in any 24 h, a sustained average of about 35 a minute, and a grant's `rate` above that is a burst rate. The two numbers are the options `dedupeCap` (50 000) and `dedupeMs` (86 400 000 ms) of the bus's constructor (`act/core/bus.js`); `create()` does not take them, so a host gets these defaults.
- An `id` is a string of 1–80 UTF-16 code units (`act/core/envelope.js`): one emoji is two units, so an id of 41 emoji is refused 400 `BAD_ENVELOPE`.
- The ids kept cost memory: about 109 bytes per 36-character id (the kind the kernel makes when a request has no `id`), about 5.4 MB per identity at the cap, and about 229 bytes, 11.4 MB, for an 80-unit id of emoji or Cyrillic letters. These were measured by one method on SYNTHEKOS's host machine with Node 26.7.0: the heap with one identity's 50 000 ids held, less the heap with that set dropped, over 50 000. A second method, through the bus's own path, gives 8–14% less there (100 and 196 bytes), and the difference is not yet explained.
- After any 503, retry with a new id.

## The actions

The registry (`act/actions/registry.spec.json`) holds 11 actions. A *world* action reaches outside the machine; text from the web or a model may reach it only with `allowTainted`.

| Action | Input (`?` = optional) | Its result is labelled | World | Targets |
|---|---|---|---|---|
| `calc` | `expr` | computed | no | — |
| `units` | `value`, `from`, `to` | computed | no | — |
| `date-diff` | `from`, `to`, `weekday?` | computed | no | — |
| `read-number` | `text`, `after?` | computed | no | — |
| `model` | `model`, `prompt`, `system?` | model | no | — |
| `fetch` | `url` | web | yes | hosts |
| `email` | `to`, `subject`, `text` | computed | yes | addresses |
| `file-append` | `name`, `text` | computed | yes | — (the identity's own folder) |
| `file-read` | `name` | computed (a file keeps the labels it was written with) | no | — (the identity's own folder) |
| `send` | `to`, `topic`, `body` | computed | no (but a request to it is labelled like a world action's, step 5) | identities |
| `messages` | `topic`, `ack?`, `hold?` | computed | no | identities |

Every input field is a string except `ack` (a list) and `hold` (`true` or `false`).

## The model server

With `models` and `modelUrl`, the `model` action POSTs `{ "model", "prompt", "system", "stream": false, "options": { "temperature": 0.2 } }` to `<modelUrl>/api/generate` and reads the reply's `response` field, and aborts the request after 115 s (`act.js`:162); the action's own `timeoutMs` is 120 s. That is the API of Ollama, the server it was built for; a host with another server exposes that one endpoint.

## Mail

The settings are read from `env` (`create()`'s option, default `process.env`):
- `MAIL_HOST`, `MAIL_USER`, `MAIL_APP_PASSWORD` and `MAIL_FROM`: all four are needed. Without them, delivery is off and mail stays queued.
- `MAIL_PORT`: default 587.
- `MAIL_HELO`: the name sent with EHLO, a host name or an address literal like `[192.0.2.1]`. The default is the machine's host name, or `[127.0.0.1]` if it has none.
- `MAIL_ALLOW`: the only addresses mail may go to, separated by spaces, commas or semicolons. A grant's `email` targets must be on it.

A setting that is wrong turns mail off and is reported through `log`; it never stops the host.

## Triggers

A script can run on a schedule. The administrator writes `<actionsDir>/triggers.spec.json`, and `node act/make-registry.js <actionsDir>` checks it and writes `triggers.json`, which is the approval. The kernel reads only `triggers.json` (`create()`'s option `triggersFile`); with no file nothing is scheduled.

```
{ "triggers": [
  { "id": "hourly", "script": "my-script", "runsAs": "u-00000000-0000-4000-8000-000000000002", "every": 3600 },
  { "id": "evening", "script": "my-script", "runsAs": "u-00000000-0000-4000-8000-000000000002", "at": "18:15", "tz": "America/Toronto", "days": "mon-fri", "missed": "skip", "input": {} },
  { "id": "on-mail", "script": "my-script", "runsAs": "u-00000000-0000-4000-8000-000000000002", "on": "message", "topic": "inbox" } ] }
```

Each trigger has an `id`, a `script` and the identity it `runsAs` (an EUser's identity name: here the example host's EUser), and exactly one of:
- `every`: seconds, from 60 to 31 days;
- `at`: `HH:MM` with a `tz`, and optionally `days` (`daily`, `mon-fri`, `sat-sun`, or a list such as `"mon,wed"`);
- `on: "message"` with a `topic`.

`missed` is `skip` (the default) or `run-late`, and `input` is an object. At most 20 triggers. `make-registry.js` refuses the whole file if any entry is bad: it prints a `✗` line for each bad entry, writes no `triggers.json` (one already there stays in force), and exits 1, after writing `registry.json`. The scheduler, given a `triggers.json` that `make-registry.js` did not write, refuses a bad entry and loads the others (`act/scheduler.js`, `validate`). A fire is an ordinary message from the `runsAs` identity, through every check of the bus. So the `runsAs` EUser must hold the script and every action the script reaches, each in its own grants, as any caller of the script must (`docs/proteus-k.md` §7, the worked example).

A time trigger's fire that is refused with a transient code is tried again after 5 s and then 30 s (and once more, after 5 s, for `DAEMON_EVICTING`); if it is refused again, that fire is lost, audited `trigger-lost`.

**Switching one off.** `node act/trigger-off.js <id> --app-dir <appDir>` reads `<appDir>/act-files/.scheduler/scheduler.json`, where the scheduler writes the ids of the triggers it loaded at every start, and writes `<appDir>/act-files/.scheduler/off/<id>` only for an id on that list. At the scheduler's next tick (every 15 s, `act.js`:380) the kernel applies the file, deletes it and audits `trigger-switched-off`; from then on "switched off" is kept in `scheduler.json`, not in `off/`. The ✓ line says that, and a second line names the file, the audit log and the start the list came from. Without `--app-dir` it uses the folder that holds `act.js`, which is `create()`'s default `appDir`. It writes nothing and exits 2 for an id that is not on the list (a mistyped id, or a trigger refused at start), when there is no `scheduler.json` (no scheduler has started there: a kernel with no `triggers.json` runs none), when that file has no list (a scheduler before `act/scheduler.js` 1.3.0 wrote it: restart the kernel), and when `<appDir>/act-files/` does not exist. A trigger comes back only when its entry in `triggers.spec.json` changes and `make-registry.js` approves the file again.

**What the list cannot know.** It is the list of the scheduler's last start, and the script cannot tell whether that kernel is running now. If the kernel stopped and `triggers.json` changed since, an id from the old list is still accepted; the next start that does not load it audits `trigger-off-unknown` and switches nothing off, so the audit shows it. There is no heartbeat, on purpose: it would be a second piece of kernel state for that one edge. An id that is already off is accepted, and switching it off is audited again.

## Your own actions and scripts

Copy `act/actions/` to a folder of your own, edit that copy, run `node act/make-registry.js <your folder>`, and pass the folder to `create()` as `actionsDir`. Do not edit `act/actions/` itself: it is part of the kernel this repository publishes, and the lab's fingerprint covers its registry spec. The lab works the same way: each run writes its scenario's scripts and `registry.json` to a folder of its own (`lab/lab.js`).

**The approval.** `make-registry.js` reads `registry.spec.json`, adds each file's sha256, and puts the list through the loader's own check (`registry.check` in `act/core/registry.js`, the function `create()`'s load calls). It prints one `✓` line per action it accepts. Under each script it prints a `reach:` line: the actions the script can reach, and the targets written in its source. Each warning that the entry's `acceptWarnings: true` accepts gets an `accepted warning:` line of its own. If the check refuses any entry, the tool prints a `✗` line with the loader's reason for each, writes no `registry.json` (one already there is left as it was) and exits 1. So it refuses what the loader would refuse at start.

**Who runs it.** Approval runs each action file's top-level code, exactly as the server does at start; run `make-registry.js` as the user the server runs as, not as yourself.

## A native action

A native action is a `.js` file that exports `run(input, ctx)`. `examples/native-host.js` writes this one, `greet.js`, into a copy of `act/actions/`, adds its entry, approves the folder and calls it. Run it from the repository root with `node examples/native-host.js`.

```
// greet.js — v1.0.0 · a native action: a greeting for a name; it reaches nothing outside the kernel
'use strict';
exports.run = async (input, ctx) => {
  const name = input.name.trim();
  if (!name) throw new Error('name is empty');
  return { text: 'hello, ' + name, for: ctx.identity };
};
```

Its entry in `registry.spec.json`:

```
{ "name": "greet", "version": "1.0.0", "kind": "native", "file": "greet.js", "produces": "computed",
  "world": false, "needs": [], "input": { "name": "string" }, "timeoutMs": 2000 }
```

The example prints one line for the approval and one per call (ids, traces and the temp folder shortened as in the README):

```
approved: ✓ greet 1.0.0 greet.js cf873c5a4e0e
name " Ada " → HTTP 200 {"ok":true,"id":"…","trace":"…","action":"greet","basis":"computed","labels":["device","computed"],"value":{"text":"hello, Ada","for":"u-00000000-0000-4000-8000-000000000002"},"sha256":"cf873c5a4e0e"}
name " " → HTTP 422 {"ok":false,"id":"…","trace":"…","action":"greet","code":"ACTION_ERROR","error":"name is empty","labels":["device","computed"]}
name 7 → HTTP 400 {"ok":false,"id":"…","trace":"…","action":"greet","code":"BAD_INPUT","error":"input field name must be string"}
audit log: <temp folder>/actbus-native-…/app/logs/act.jsonl
```

**What `run` gets and gives** (`act/core/bus.js`:193–273). The bus calls `run` only after every check in the README's list has passed and the "run" line is on disk. `input` is the request's input, already checked against the entry's `input`. What `run` returns, or what its promise resolves to, becomes the reply's `value`: it must be plain JSON, and `undefined` becomes `null`. Anything else answers 422 `ACTION_ERROR`, `greet returned something that is not plain JSON`. A thrown error answers 422 `ACTION_ERROR` with the error's message, cut at 300 characters; an error whose `code` is `TIMEOUT` keeps that code. A run that takes longer than `timeoutMs` answers 504 `TIMEOUT`, `greet did not finish within 2000 ms`. A successful reply is labelled with every warning label the call received plus the entry's `produces`; a credential it received (`grounded`) is not carried. `ctx` is frozen. The fields a native action can use:
- `identity`: the identity the action runs as; `authority`: the whole chain; `trace`, `time`, `node`, `product` (the host's `productName`);
- `labels()`: the labels the action has received so far; `addLabels(list)`: adds labels (a warning only: never `grounded`);
- `send(action, input)`: asks another action, as the same identity and through every check of the bus, and resolves to that action's reply;
- `fetch`: `create()`'s `fetchImpl` (the global `fetch` without one), which refuses while `<appDir>/.web-egress-disabled` exists; `filesRoot`: `<appDir>/act-files`, where each identity's files are kept.

`queueMail`, `sendMessage`, `readMessages` and `ackMessages` are given only to the actions named `email`, `send` and `messages`; for any other action they are `undefined`.

**The entry's fields** (`act/core/registry.js`, `checkEntry`). A bad entry is refused, with the field named:

| Field | What the check requires | What it does |
|---|---|---|
| `name` | `a-z`, `0-9` and `-`, starting with a letter, at most 48 characters; unique | the action's name in requests and grants |
| `version` | `x.y.z` | shown in the approval line and the audit |
| `kind` | `native`, `tentacle`, `model` or `script` | `script` is a PROTEUS-K file (`docs/proteus-k.md` §7); the bus checks the other three kinds the same way |
| `file` | a plain `.js` file name in the folder (`.pk` for a script); not a symlink | the code; its sha256 is the pin |
| `produces` | `computed`, `web`, `model`, `grounded` or `device` (`computed` for a script) | the label the reply earns |
| `world` | `true` or `false` | `true` puts the action under the taint rule: text labelled `web` or `model` may reach it only with `allowTainted` |
| `needs` | a list of `fs`, `path`, `crypto`, `url`, `util` and `rational`; empty for a script | the only modules `require()` gives the file; any other throws, so a `require` of it in the file's top-level code is refused at approval and at load |
| `input` | field → type, the field name matching `^[a-z][a-zA-Z0-9]{0,31}$`; the type one of `string`, `number`, `integer`, `boolean`, `object`, `array`, ending in `?` when the field is optional | the bus refuses a request whose input has another field, lacks a required one or has the wrong type (400 `BAD_INPUT`) |
| `timeoutMs` | a whole number from 10 to 120 000 (to 600 000 for a script) | default 10 000 (300 000 for a script) |
| `targetForm` | `fetch-host`, `email-address`, `identity` or `sender`; none for a script | how the bus judges the input against the grant's `targets` (`act/core/targets.js`); with none, a grant may not list targets for the action |
| `runsAs` | scripts only | an entry of any other kind with `runsAs` is refused |
| `sha256` | written by `make-registry.js` | the pin |

`needs` limits `require()` only; the code can reach modules in other ways, and an in-process action is not sandboxed. The pin proves that a file is the one the administrator approved, not that it is safe (`act/core/registry.js`'s header).

**`check()` and the bus's tests.** `registry.check(dir, entries, { scriptEngine })` is that whole check: `load()` calls it on `registry.json`, and `make-registry.js` on the spec. It takes one more option, `runsAsAnyKindForBusTests: true`, which lets an action of any kind carry `runsAs`. It is for the bus's own tests (`act/test/core.test.js`), which test the bus's `runsAs` on native actions, and a host does not pass it: `act.js` (through `load`) and `make-registry.js` each pass the check `{ scriptEngine: engine }` and nothing else, and a guard test in `act/test/make-registry.test.js` fails if either ever names the option.
