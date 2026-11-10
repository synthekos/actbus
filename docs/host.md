<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# The host's contract

What a host gives the kernel, what it gets back, and what it must call. `examples/minimal-host.js` shows the smallest case; this page is the full reference. Line numbers are of the files in this repository.

## What `create()` returns, and what a host must call

`create(opts)` (`act.js`:171) returns one object (`act.js`:461). A host uses these members:

| Member | What it is | When a host calls it |
|---|---|---|
| `route(req, res)` | the request handler (below) | for every request from an EUser |
| `saveGrants(euser, json, adminLoginId)` | checks and saves an EUser's grants; the change is audited before it is saved | when an administrator changes an EUser's actions |
| `clearForRoleChange(before, newRole, adminLoginId)` | clears the grants of a record that stops being an EUser, audited first | whenever a record's role changes |
| `stop()` | stops the mailbox and scheduler timers, the outbox and every script daemon | once, when the host stops |
| `LOG` | the path of the audit log, `<appDir>/logs/act.jsonl` | to read or ship the audit |

The other members (`panelHtml`, `loadIdentities`, `actionNames`, `refused`, `bus`, `FILES_ROOT`, `engine`, `outbox`, `mailbox`, `scheduler`, `schedTick`, `webOff`, `mailProblems`, `schedProblems`) are what SYNTHEKOS's admin screens and the tests read; a host does not need them.

**Shutdown.** `act/shutdown.js` exports `installShutdown({ stop, server })`. A host wires it once, with `stop: () => act.stop()`: on SIGTERM, SIGINT or SIGHUP it calls `stop()` first, which kills every script daemon, then closes the server and lets the signal end the process. Without it, a busy script daemon can outlive the server by its current run. The one test that `npm test` leaves out checks that SYNTHEKOS's `server.js` wires it.

## The user records

The kernel reads the host's records through a Prisma-style handle, `prisma.user`, with three calls:
- `findMany({ where: { actGrants: { not: null } } })` (`act.js`:243): every record with grants. A store that ignores the filter may return every record; the kernel skips those without grants.
- `findUnique({ where })`, with `where` either `{ uniqueId }` or `{ loginId }`.
- `update({ where: { uniqueId }, data: { actGrants } })`.

A record has `uniqueId`, `loginId`, `role`, `auth` and `actGrants` (a JSON string, or `null`).
- **An EUser** has `role: 'euser'`. Its identity name is `u-` followed by its `uniqueId` in lower case.
- **A person** has `role: 'user'` or `role: 'admin'`, and `auth: 'login'` or no `auth` (`act.js`:89). Any other `auth` (SYNTHEKOS uses `'key'` for its machines) makes the record not a person, and a grant it owns is refused.

## Grants

`saveGrants` takes the grant as JSON text; `parseGrants` (`act.js`:92) checks it and returns `{ ok, value, errors }`. The text is at most 8000 characters. Its fields:

| Field | Required | What it is |
|---|---|---|
| `owner` | yes | the `loginId` of the person accountable for this EUser; the kernel keeps the person (`ownerId`), so a rename keeps the grant with them |
| `actions` | yes | at most 50 entries, `{ "<action>": { …options } }`; `{}` for no options |
| `models` | no | the model names the `model` action may use, at most 20 |
| `rate` | no | messages per minute, a whole number from 1 to 10000 (default 120) |
| `operatedByPerson` | no | `true` when a person operates this EUser (a phone, say): what it sends is labelled `person`. Refused together with an action that brings web or model text into the EUser itself, such as `fetch`, `model` or `file-read` |

Each action's options:
- `targets`: at most 50. What a target is depends on the action: a lower-case host name, optionally `:port`, for `fetch` (`http://host` for plain HTTP); a lower-case address that is on `MAIL_ALLOW` for `email`; an identity name (`u-…`) for `send` (whom it may send to) and `messages` (who may send to it). Targets for an action whose registry entry declares no `targetForm` are refused, at save and at load: that is every action but `fetch`, `email`, `send` and `messages`.
- `allowTainted: true`: text from the web or a model may reach this world action. An explicit rule; leave it out unless it is meant.
- `strictControl: true`: refuse this world action when it would run under a condition that depends on web or model text, unless `allowTainted` is also given.

## Requests

`route(req, res)` is an Express-style handler. `req.euser` is the EUser's record, already authenticated by the host. `req.body` is `{ "action": "…", "input": { … }, "id": "…", "labels": [ … ] }`: `id` (a string) is optional and is the message id the duplicate check uses; `labels` is an optional list of at most 6 labels, added to the message.

Before the bus sees a request, `route` (`act.js`:321) does this, in order:
1. reads the identities and grants fresh from the records (a failure answers 500 `IDENTITIES`);
2. counts the request against the EUser's rate (its grant's `rate`, or 30 a minute for a record with no usable grant). Over the rate it answers 429 `RATE`, and this refusal is not written to the audit log, so a flood cannot fill the disk;
3. refuses an EUser with no usable grant (403 `NOT_PERMITTED`, with the reason);
4. checks the body's shape, the action's name and `labels` (400 `BAD_ENVELOPE`);
5. for a world action, a `send` or a script, adds the labels of every web or model text this EUser could also receive (not for a script that declares no input, and not for the own `send` of an EUser with `operatedByPerson`).

The refusals of steps 1, 3 and 4 are audited, at most 10 a minute per EUser. Then the bus runs its own checks (README, the list at the top).

**The reply** is JSON: `{ "ok": true, … }` with status 200, or `{ "ok": false, "code": "…", "error": "…" }`. The status of a refusal by the bus (`act/core/edge.js`:16):

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
| 503 | `DAEMON_FULL`, `DAEMON_EVICTING`, `DAEMON_OVERLAP`, `DAEMON_PAUSED`, `DAEMON_RESTARTING` |
| 504 | `TIMEOUT` |

The `DAEMON_…` refusals are transient: the run never started, and the reply carries `Retry-After: 5`. An exception inside the kernel answers 500 `INTERNAL`.

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

With `models` and `modelUrl`, the `model` action POSTs `{ "model", "prompt", "system", "stream": false, "options": { "temperature": 0.2 } }` to `<modelUrl>/api/generate` and reads the reply's `response` field, with a 115 s timeout (`act.js`:156). That is the API of Ollama, the server it was built for; a host with another server exposes that one endpoint.

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

`missed` is `skip` (the default) or `run-late`, and `input` is an object. At most 20 triggers; a bad entry is refused and the others load (`act/scheduler.js`, `validate`). A fire is an ordinary message from the `runsAs` identity, through every check of the bus.

**Switching one off.** `node act/trigger-off.js <id> --app-dir <appDir>` writes `<appDir>/act-files/.scheduler/off/<id>`, and the running kernel switches that trigger off within 15 s and audits it. A kernel with no `triggers.json` runs no scheduler and does not read the folder. Without `--app-dir` it uses the folder that holds `act.js`, which is `create()`'s default `appDir`. If `<appDir>/act-files/` does not exist, it writes nothing and exits 2. A trigger comes back only when its entry in `triggers.spec.json` changes and `make-registry.js` approves the file again. `act-files/.scheduler/off/` matters even with no triggers: the off-folder is state, and a host that enables triggers later inherits whatever is in it.

## Your own actions and scripts

Copy `act/actions/` to a folder of your own, edit that copy, run `node act/make-registry.js <your folder>`, and pass the folder to `create()` as `actionsDir`. Do not edit `act/actions/` itself: it is part of the kernel this repository publishes, and the lab's fingerprint covers its registry spec. The lab works the same way: each run writes its scenario's scripts and `registry.json` to a folder of its own (`lab/lab.js`).
