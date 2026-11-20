# act/ changelog

The entries below were moved verbatim from the file headers of `act/**` and `act.js` on 8 Nov 2026 (SYNTHEKOS tag `v0.53.5-changelog`). One section per file; within a section the newest entry is first and the oldest last; review tags (F-B, H1, R4, S3 …) are as they were. Each file keeps its current version on line 1.

**20 Nov 2026 · SYNTHEKOS tag `v0.54.8` · the audit is escaped, a daemon's fields are checked, and two rules get tests here (the cold read of v0.4.0).** A review of ACTBUS `v0.4.0` (`docs/reviews.md`, 20 Nov) found that `JSON.stringify` left DEL, the C1 controls and the bidi and line-separator characters raw in `logs/act.jsonl`, through a request's text, a page's text in a script's child call and a script error's reason (findings 1 and 2; issue #20), and that a script daemon's message type replaced a `daemon-*` line's time (finding 2). `act.js` 1.10.2: every line `act.js` writes goes through `cap`, which escapes DEL, C1, U+061C, U+200B–200F, U+2028–202E, U+2060–2069 and U+FEFF as `\uXXXX` before the 4 KB measure, the 200-character cut and the fallback line; `JSON.stringify` already escapes C0, so a JSON parser reads back the same values. `cap` is at module level and exported as `auditLine`, for the tests. A host built on `Bus` without `act.js` (`auditFile`, or its own `audit`) is not covered. On a `daemon-*` line the record's `t` (the daemon message's type) is written as `msg`, only where it is a name, else `null`; `t`, `node` and `outcome` are set after the record's fields, so no key of a record replaces them (tested for `t`; `node` and `outcome` are covered by the same assignment, untested, as no record carries those keys today). The review of the repair added R6 and R8: `runId` is written only where it is a string or a number that passes the id rule, and `pid`, from the daemon's own ready message, only where it is a whole number, else `null`. `act/daemon/supervisor.js` is unchanged. New tests: `edge-relay.test.js` (3: the key holder's labelling at `act.js`:358, through `act.route`; two fail with that labelling removed), `models-chain.test.js` (3: a model through a chain; two fail with `bus.js`:205's chain replaced by the running identity), `audit-escape.test.js` (7: six fail on 0.54.7) and `daemon-fields.test.js` (6: five fail on 0.54.7).

**19 Nov 2026 · SYNTHEKOS tag `v0.54.7` · an id, a trace and a replyTo hold only safe characters, and a refusal writes only names (issue #12).** `core/envelope.js` 1.2.1 bounded `id` and `trace` to 1–80 UTF-16 units of any character and did not bound `replyTo` at all. JSON escapes the C0 controls, but it leaves U+2028, U+2029, NEL, the C1 controls and the bidi controls raw, so such a value could break an audit line for a reader that splits on Unicode line separators, or reorder it on a terminal that renders bidi. `core/envelope.js` 1.3.1: `id`, `trace` and `replyTo` must match `ID`, `^[A-Za-z0-9._:-]{1,80}$` (exported beside `NAME`); `replyTo` may also be absent or `null`; a value outside the rule is refused `BAD_ENVELOPE`, and the message names the rule, never the value. Building the fix found two more places where a caller's or a host's text reached the audit unchecked: `act.js` 1.9.4 — the route's refusal line wrote an action that is not a name as sent; it now writes the action only when it is a name. `core/bus.js` 1.8.0 — `refuse()` wrote `from` and `action` as given; it now writes each only when it is a name, and `null` otherwise, and an unknown identity's reason quotes it only when it is a name. A refusal's reply carries the same `action`, so it is `null` where the action sent was not a name. `mailbox.js` 1.4.0 and `mail/outbox.js` 1.2.0: a refused message's or mail's line wrote `to` and `topic` as given, before they were checked, and the reasons quoted them; each line now writes `to` and `topic` only where each passes its own rule (`NAME`; for a mail's address, `ADDR` on the lowercased address), and `null` otherwise, and the reasons name the rule, never the value. A refused mail whose address passes `ADDR` is now recorded lowercased, not as sent. What stays caller text, JSON-encoded as sent: a run's recorded input, including a mail's or message's digest (`to`, `subject`, `topic`); a queued mail's subject; and a refusal reason that quotes the request (ACTBUS README, Known gaps). New tests: `id-charset.test.js` (13: eight fail on 0.54.6), `name-fields.test.js` (13: eight fail on 0.54.6) and `mail-fields.test.js` (8: four fail on 0.54.6).

**17 Nov 2026 · SYNTHEKOS tag `v0.54.6` · an empty chain is refused on purpose, a daemon's bad labels are refused, and the mailbox's filters are required.** `core/capabilities.js` 1.1.2: `effective()` returns `null` for an empty chain and `modelsFor()` returns `[]`; before, both reached `[].reduce()` with no start value and were closed only by its TypeError. This was promised when pull request #19 was closed; bfs2021 opened it to fix issue #18 the same way v0.54.5 did; its two tests are in `test/core.test.js` 1.1.3, as bfs2021 wrote them. `daemon/supervisor.js` 1.2.0: every label list a script daemon sends must be a list of known labels; anything else is audited as `daemon-malformed` and refused (`BAD_MESSAGE` for a call, which then does not run; a failed run otherwise), where before it became `[]`. `mailbox.js` 1.3.0: `read` needs both its filters and `ack` its one; before, they defaulted to `() => true`, and `own` to `accept`, which marked a sender dead when a caller passed a narrow `accept` alone. `proteus/engine.js` 1.6.2: a literal `:to` is in a script's reach list, with `:url` and `:name`. Three test files are new: `empty-chain`, `daemon-message` and `required-filters`.

**16 Nov 2026 · SYNTHEKOS tag `v0.54.5` · an absent `targets` restricts a chain, and four smaller faults.** In a chain, a grant for a target-taking action with no `targets` field dropped out of the intersection, so a PROTEUS-K script's own targets stood for its caller's (issue #18): `core/capabilities.js` 1.1.1 counts it as an empty list, as it already was alone. The same release: `scheduler.js` 1.3.1 gives a retry half a second of slack, so a refused trigger's second retry comes 30 s after the first, not 30 s or 45 s by a race of milliseconds (#15); `core/bus.js` 1.7.1 refuses to be built without an audit destination, and 1.7.2 drops a line that repeated its one caller's age drop (#14); `mailbox.js` 1.2.2 sets aside a record without a labels list as damaged; `test/shutdown.test.js` 1.2.0 counts a zombie as gone, so its five tests no longer fail where PID 1 does not collect orphans at once (#11). Four test files are new: `targets-chain`, `mailbox-record`, `bus-audit` and `retry-slack`.

**11 Nov 2026 · SYNTHEKOS tag `v0.54.4` · the caller pays.** v0.54.3's cap made a script's `runsAs` identity fill from every caller's calls, so three callers could lock a fourth out of a shared script for up to 24 h, and the rate limit did the same for a minute. Found by the sixth cold read of ACTBUS (its #7); the rate by this release. Now a child the bus makes is not remembered, and it counts against the rate of the caller who caused it. A native action's error is never transient (its #3), and an id of "" or one that is not a string is refused (its #6), never replaced. What v0.54.3 added for scripts at the cap is removed, because no case can reach it once a child is not remembered: the pre-check before a script starts, the engine's child-call path, the `retryAfterMs` a thrown error carried, and DEDUPE_FULL in the two TRANSIENT lists. Tests: `act/test/caller-pays.test.js` 1.0.0 (new), `dedupe-full.test.js` 1.1.0, `transient.test.js` 1.3.0.

**11 Nov 2026 · SYNTHEKOS tag `v0.54.3` · the dedupe window holds.** `core/bus.js` 1.5.0 promised that an id is remembered for 24 h, "up to dedupeCap ids per identity (oldest of THAT identity go first)": at the cap (50 000) an identity's oldest id was dropped whatever its age, on a request (1.5.0 line 132) and when `.dedupe.jsonl` was loaded at start (line 68), so an id inside the window could be replayed. Found by the fifth cold read of ACTBUS (its #1); the start path by this release. Now nothing is ever dropped by count: an identity that holds `dedupeCap` ids inside the window is refused `DEDUPE_FULL` (transient, HTTP 503) until its oldest id leaves the window, and the refusal says when (`retryAfterMs`; `Retry-After` in whole seconds, rounded up, at least 1). A script whose own identity is at the cap is refused `DEDUPE_FULL` before it starts. A script refused at its first action call (another call took the slot after the check) answers `DEDUPE_FULL`, transient; one refused at a later call answers `ACTION_ERROR` naming `DEDUPE_FULL`. A 503 means the script did not start; a 422 naming `DEDUPE_FULL` means it did, and what it did stands. The cost, as a documented limit: at most 50 000 ids per identity in any 24 h (a sustained average of about 35 a minute; a higher grant `rate` is a burst rate); the ids held inside the window take heap memory, bounded per identity by the cap; `dedupeCap` and `dedupeMs` are the bus's constructor options. Tests: `act/test/dedupe-full.test.js` 1.0.0 (11 FAIL-FIRST on v0.54.2, 2 GUARD).

**11 Nov 2026 · SYNTHEKOS tag `v0.54.2` · N1, a fault found while building this release.** `act.js` refused an action of a kind other than script that carries `runsAs` only AFTER `registry.load` had prepared every script against the whole list of names. A script that called such an action stayed loaded and could be granted: `create()` logged the action's refusal, `saveGrants` accepted a grant of the script, and a call answered 422 `ACTION_ERROR … UNKNOWN_ACTION`. It failed closed (nothing ran), but a loaded script's approved reach named an action that was not loaded. The refusal is now in `registry.check`, before scripts are prepared, so such a script is refused at load (`no action named …`). Reproduced on v0.54.1 by a probe through `create()`; pinned by `make-registry.test.js` ("a script that calls a native action with runsAs is refused at load"). No read had found it; it turned up when the approval tool was routed through the loader's own check (the fourth cold read's #1).

**10 Nov 2026 · SYNTHEKOS tag `v0.54.1` · the copyright line, no code.** In the 36 kernel files whose short copyright line also named a company, the company name is removed: the line names the author alone, the same rights holder as `LICENSE` and every `Copyright (c)` line. No kernel file's version changed and no code changed: every file's tokens are identical before and after. Ten of the files are action files, so `act/actions/registry.json` pins their new sha256 (11 entries: `file.js` serves two); nothing else in it changed, its approval time included.

**9 Nov 2026 · SYNTHEKOS tag `v0.53.7-cleanup` · names and test data, no code.** In the entries below, one kind of edit was made in place, and nothing else in them changed: names, and pointers to documents a reader cannot open. A reviewer is called a second-reader review, with its round, as the comments say; an owner's decision is credited to the owner; a machine is called by its system (macOS), and a model or a node by its neutral test name; a build kit is called by the SYNTHEKOS release it made; a pointer to an internal document names the ACTBUS document that holds the same text (`docs/reviews.md`, `docs/functions-and-mailboxes.md`), or is dropped. Every replaced line is declared in the release's kit, and the originals are in the private provenance record (`synthekos/actbus-provenance`), offered to a reviewer on request. The 8 Nov note below says the entries name reviewers as the build history named them; that describes them before this note. The kernel's tests changed their test data the same way: the addresses are `alex@example.org` (the recipient), `alex@example.com` (the sender) and `alex@example.net` (the mail user), the mail server is `smtp.example.com`, and the identities are `alex`, `helper` and `helper-thoughts`, as in the lab; two test names changed with them, and an assertion message no longer names the owner. Comments that named a build kit name the release instead, and two comments show the new identities. No version changed and no kernel code changed. v0.53.7 was built in three rolls (v1.0.0, r1, r2); the first two were superseded with identical release bytes, tooling only.

**8 Nov 2026 · SYNTHEKOS tag `v0.53.6-docrefs` · comment only.** The kernel's comments no longer point to documents a reader cannot open. A design reference now names its section of `docs/capability-architecture.md`, `docs/proteus-k.md` or `docs/functions-and-mailboxes.md` in the ACTBUS repository; a review round is called a second-reader review, with its round; an owner's decision is written as "(owner decision, <date>)"; three build-kit names are gone; two comments in `act.js` name the local model server without naming a product. Three test names and one comment inside a PROTEUS-K test script changed with them. No version changed and no code changed: every file's tokens are identical before and after, except those three test names and the two copies of that script, which the PROTEUS-K reader parses to the same tree. The entries below this note are the build history, left as written: reviewers are named in them as the build history named them, and `docs/reviews.md` in the ACTBUS repository says what each review was.

**8 Nov 2026 · SYNTHEKOS tag `v0.53.6-purpose` · comment only.** Line 1 of every kernel `.js` file now says what the file is for (in `act/make-registry.js` and `act/trigger-off.js` that line is line 3, after the shebang and the licence line). `act/test/harness.js` has its first version line and a section below. Two comment lines in `act.js` no longer name the application or an internal document. No version changed and no code changed: every file's tokens are identical before and after.

## act.js

- v1.10.2 (201126 · v0.54.8, the cold read of v0.4.0, findings 1 and 2, issue #20; the review of the repair, R6 and R8: `cap` escapes DEL, C1, U+061C, U+200B–200F, U+2028–202E, U+2060–2069 and U+FEFF before the 4 KB measure, and is exported as `auditLine` for the tests; a `daemon-*` line writes the record's `t` as `msg` (a name, else `null`), `runId` only where it is a string or a number that passes `ID`, `pid` only where it is a whole number, and keeps its own `t`, `node` and `outcome`. The stage files before it: 1.10.0 without R6 and R8, 1.10.1 with them; 1.10.2 changed one comment)
- v1.9.4 (191126 · v0.54.7, issue #12: the route's refusal line (`refuseHere`) writes `action` only when it is a name; an action that is not a name was written as sent, up to 64 units)
- v1.9.3 (111126 · v0.54.4: `route` passes the id as sent; a non-string id (7, null, an object) is refused 400 BAD_ENVELOPE by the envelope check — 1.9.2 replaced it with a new one)
- v1.9.2 (111126 · v0.54.3: `route` sends a transient refusal's own `Retry-After` (edge.js 1.0.3 `retryAfter`): when it clears, if the refusal knows (DEDUPE_FULL), else 5 s)
- v1.9.1 (111126 · v0.54.2. #1: the refusal of `runsAs` on an action that is not a script moved into the registry's own check (core/registry.js 1.3.0), so the approval step refuses the same set this load does. N1 (the 11 Nov note): before, it ran after the load, so a script that called such an action stayed loaded and grantable and failed at run with UNKNOWN_ACTION. #16 and the Known-gaps item on line 51: the refusal's text now begins `registry entry "<name>": `. The email-grant message names `MAIL_ALLOW in create()'s env`, not "in the .env". The header no longer shows `POST /api/act` with a Bearer key as this file's interface: `route()` takes the EUser the host authenticated, and the reference host's server.js is named as the host that serves that route; line 1 says "the action route", not "the HTTP route")
- v1.9.0 (091126 · v0.53.8: what `create()` refuses, checked before anything is created. An own option name it does not know: `create(): unknown option "<name>" — the options are prisma, models, modelUrl, productName, appDir, fetchImpl, log, actionsDir, env, daemon, mailTls, triggersFile, clock`; the name is shown with every character outside `A–Z a–z 0–9 _ $` removed and cut at 40 characters. Options that are not an object: `create(): the options must be an object`. A renamed option is refused from a table of old names, with the message 1.8.0 gave. If `models` is given, `modelUrl` is required, and a blank one is none: `create(): models is given, so modelUrl is required — pass the model server's URL as modelUrl`. The model action's handler is built by `modelAdapter({ modelUrl, fetchImpl })`, exported; its own refusal when there is no usable `modelUrl` stays as a second line)
- v1.8.0 (v0.53.7 · 091126: the old option name `ollamaUrl` is removed. `create()` refuses it before anything is created, with the message `create(): ollamaUrl was removed in 0.53.7 — pass modelUrl`. The model adapter is `modelGenerate`. A model call when the host passed no `modelUrl` answers `the model action has no model server address: the host did not pass modelUrl to create()`, not a TypeError)
- Note (081126 · v0.53.6-purpose, moved from the header): originally byte-identical to capcore-281028 v1.1.0 (October 2026).
- v1.7.0 (081126 · v0.53.6: create({ productName }) — the host's name on the wire, ACTBUS when none is given (core/product.js), checked first and passed to the engine, the mail adapter, the outbox and the bus; create({ modelUrl }) is the model server's URL. ollamaUrl, its old name, is still accepted in this release — said once in the log, refused at start when it disagrees with modelUrl — and is removed in the next kernel release)
- v1.6.2 (v0.53.4 · 061126 · second-reader review, round 1, note: a transient refusal answers 503 with Retry-After: 5, as the edge does)
- v1.6.1 (v0.53.2 · 061126 · second-reader review, round 1: a grant listing targets for an action without a declared targetForm is refused at load and at save)
- v1.6.0 (SYNTHEKOS v0.53.0 · 051126):
- v1.5.0 (SYNTHEKOS v0.53.0 · 041126):
- v1.4.3 (041126 review R4: EVERY script that declares input is escalated — a script can keep what it is given (remember) and a later run can write it out, so the labels must be on the input when it arrives)
- v1.4.2 (041126 review R3, H1-bis: a SCRIPT that can reach `send` (and declares input) is escalated too — the text it is given could leave in a message)
- v1.4.1 (041126 review R2, H1: a message cannot launder web/model text — `send` is escalated like a world action (an EUser that can receive web or model text from this box has those labels added to what it sends), and `messages` counts as a source of web and model text (what it reads may carry them))
- v1.4.0 (SYNTHEKOS v0.52.0 · 041126)
- Kept from v1.3.0 (SYNTHEKOS v0.51.0 · 031126)
- Kept from v1.2.0 (SYNTHEKOS v0.49.0 · 301026)
- Kept from v1.1.0 (SYNTHEKOS v0.48.0 · 281028)

## act/actions/calc.js

- v1.0.0 (281028)

## act/actions/date-diff.js

- v1.0.0 (281028)

## act/actions/email.js

- v1.0.0 (031126)

## act/actions/fetch.js

- v1.2.1 (081126 · v0.53.6: the User-Agent is ctx.product + '-fetch/1.0' — the host's name from the bus, no longer a fixed name; registry pin moved)
- v1.2.0 (051126 · v0.53.0 · second-reader review F09: https by default — a target `host` allows https only; plain http needs a target written `http://host` (or `http://host:port`). The allow-list is by host NAME, not by resolved address: a host whose DNS changes is still that name)
- was v1.1.0 (281028)

## act/actions/file.js

- v1.1.0 (281028)

## act/actions/messages.js

- v1.1.1 (051126 review R1 L4: holding is OPTED INTO — input `hold: true`; without it a key holder's read is removed when the call succeeds, exactly as in v0.52.0, so a client that does not acknowledge is not surprised)
- v1.1.0 (051126 · v0.53.0, ACTBUS docs/functions-and-mailboxes.md §5: input `ack` — a list of message ids the caller already HAS; they are removed first, then the waiting messages are read. A KEY HOLDER's messages stay claimed until it acknowledges them (or are delivered again after 10 min, dead after 3); a script's are removed when its run succeeds, as before. The reply is unchanged: the list)
- was v1.0.0 (041126)

## act/actions/model.js

- v1.0.0 (281028)

## act/actions/read-number.js

- v1.0.0 (301026)

## act/actions/send.js

- v1.0.0 (041126)

## act/actions/units.js

- v1.0.0 (281028)

## act/core/bus.js

- v1.8.0 (191126 · v0.54.7, issue #12: `refuse()` writes `from` and `action` only when each is a name, else `null` (`nameOr`), with an envelope or without one, so the hop limit's and a child call's refusals are covered too; an unknown identity's reason quotes `from` only when it is a name, else says `(not a name)`)
- v1.7.2 (161126 · v0.54.5, issue #14: `dedupeFull()` no longer drops the identity's ids older than the window; its one caller, dispatch, has just done so with the same `now`)
- v1.7.1 (161126 · v0.54.5: the constructor refuses a bus with neither `audit` nor `auditFile` — every message is audited before its action runs, so a bus that writes nowhere is not built)
- v1.7.0 (111126 · v0.54.4, the sixth cold read's #3 and #7: a child the bus made (`ctx.send`) is not remembered and fills no identity's set — its id is a fresh random one nobody can send again; a root message is unchanged. A child counts against the ROOT caller's rate (`authority[0]`), not the identity it is sent as: the caller who caused the work pays for it, and a time trigger, whose root is its `runsAs` identity, pays for its own. 1.6.0's pre-check before a script starts is removed (nothing can fill a script's identity from its calls), and so is the `retryAfterMs` a thrown error carried. `transient` on a thrown error is believed only from a script (the engine); a native action's error is ACTION_ERROR, whatever it carries. TRANSIENT_CODES no longer names DEDUPE_FULL: only a root is refused it, by refuse())
- v1.6.0 (111126 · v0.54.3, the fifth cold read's #1: nothing is ever dropped by count. At `dedupeCap` ids inside the window a new id is refused DEDUPE_FULL (transient, `retryAfterMs` = when the identity's oldest id leaves the window); the id is not remembered and nothing runs. At start every id inside the window is kept, whatever the cap (1.5.0 cut each set to the cap, on a request and at load). `refuse()` carries `transient` and `retryAfterMs`; a run's transient error keeps the `retryAfterMs` it carries. DEDUPE_FULL is in TRANSIENT_CODES. Before a script runs, its runsAs identity at the cap → DEDUPE_FULL, nothing started; `dedupeFull()` is the one test of both checks)
- v1.5.0 (081126 · v0.53.6: option productName (checked by core/product.js; default ACTBUS), given to every action as the frozen ctx.product)
- v1.4.6 (v0.53.4 · 061126 · second-reader review, round 3: TRANSIENT refusals — a script run the supervisor never started (DAEMON_FULL, DAEMON_EVICTING, DAEMON_OVERLAP, DAEMON_PAUSED, DAEMON_RESTARTING) is answered with that code and transient: true, in the reply and in its audit line, instead of ACTION_ERROR; only for those five codes and only when the error itself says so)
- was v1.4.5 (v0.53.2 · 061126 · second-reader review):
- v1.4.4 (v0.53.0 · 051126 · second-reader review):
- v1.4.3 (v0.53.0 · 041126 TENTACLE ask A7: each message read also carries its OWN labels — `labels`, a sorted list of warning labels, never a credential — so a reader can show WHICH message carried web/model; the run's labels are unchanged)
- v1.4.2 (041126 review R2: M3 a message is marked dead only by the RECIPIENT's own grant — a narrower grant along the chain only hides it from this run; M4 a message also carries the sender's CONDITION labels (a send inside a web-dependent branch arrives labelled web))
- was v1.4.1 (041126 test act-mailbox: the audit "run" line of a send names to and topic and the body's sha256 and size — never the body, as for email)
- was v1.4.0 (041126 MAILBOXES, ACTBUS docs/functions-and-mailboxes.md §3: the send action, and only it, gets ctx.sendMessage — the core checks that the RECIPIENT's grant for messages names this sender (the sender's own grant is checked by send.js against its targets) and fills in who sent it, the chain, the trace and the labels; the messages action, and only it, gets ctx.readMessages — what it reads is claimed for this trace, re-checked against the reader's CURRENT accepted senders, and its labels (warnings) come back with the reply)
- was v1.3.4 (031126 slice 3: outbox — the email action, and only it, gets ctx.queueMail; the core fills in who sent it, the chain, the trace, the labels and the granted recipients, so an action cannot forge them; its audit "run" line carries the body's sha256, not the body)
- was v1.3.3 (031126 F-B focused review: an envelope the bus did not mint is copied as plain data before it is read)
- was v1.3.2 (031126 F-B review 3: a message carrying a credential is accepted only if this bus minted it)
- was v1.3.1 (031126 F-B round 3, the literal rule: NO reply carries its input's credential — only a script's returned value's, or the label an action is registered to produce; a native action's child carries none; a root envelope carrying one is refused)
- was v1.3.0 (031126 F-B: CREDENTIALS — a script's reply carries only the credentials of the value it returns; an action adds only warnings (addLabels, a child's reply); a native action's children inherit only warnings; an error carries no credential; ACTBUS docs/reviews.md, PROTEUS-K review finding 1, review 2 F1)
- was v1.2.1 (301026)

## act/core/capabilities.js

- v1.1.2 (171126 · v0.54.6: an empty chain is refused on purpose — `effective()` returns `null` (`if (!grants.length) return null;`) and `modelsFor()` returns `[]`; before, both reached `intersect([])`, which is `[].reduce()` with no start value, and only its TypeError kept them closed. Promised when pull request #19, which bfs2021 opened, was closed)
- v1.1.1 (161126 · v0.54.5, issue #18: in `effective()` a grant with no `targets` field counts as an empty list in the chain's intersection, as it does alone; before, it dropped out of the intersection, so another identity's list stood for it. `targets` is now always a list)
- v1.1.0 (301026)

## act/core/durable.js

- v1.0.0 (051126 · v0.53.0 · second-reader review F05)

## act/core/edge.js

- v1.0.4 (111126 · v0.54.4: the edge passes the id as sent; a non-string id is refused 400 BAD_ENVELOPE — 1.0.3 replaced it with a new one)
- v1.0.3 (111126 · v0.54.3: DEDUPE_FULL → 503; `retryAfter(r)`: a refusal's `retryAfterMs` in whole seconds, rounded up, at least 1, else RETRY_AFTER_S (5); exported for act.js)
- v1.0.2 (061126: a TRANSIENT refusal → 503 with Retry-After: 5 — the run never started, the same hint the scheduler uses; bus 1.4.6; RETRY_AFTER_S exported for act.js)
- v1.0.1 (061126: NO_TARGET → 403, bus 1.4.5)
- v1.0.0 (281028)

## act/core/envelope.js

- v1.3.1 (191126 · v0.54.7, issue #12: `ID` = `^[A-Za-z0-9._:-]{1,80}$`, exported; `id` and `trace` must match it, `replyTo` must be absent, `null` or match it; the refusal names the rule, not the value. The stage files before it were 1.3.0, the same code with one comment that pointed to a document a reader cannot open)
- v1.2.1 (111126 · v0.54.4, the sixth cold read's #6: only a missing id is made by root(); an id of "" is checked, and refused BAD_ENVELOPE — 1.2.0 replaced it with a new one)
- v1.2.0 (031126 F-B: CREDENTIALS — `grounded` is never inherited by a child and never declared by a caller at the edge; warnings are inherited and may be added exactly as before; ACTBUS docs/reviews.md, PROTEUS-K review finding 1, review 2 F1)
- was v1.1.0 (301026)

## act/core/names.js

- v1.0.0 (281028)

## act/core/product.js

- v1.0.0 (081126 · v0.53.6: the product name's one default (ACTBUS) and its check)

## act/core/rational.js

- v1.1.0 (281028)

## act/core/registry.js

- v1.3.0 (111126 · v0.54.2, the fourth cold read's #1, #2 and #16: `check(dir, entries, { scriptEngine })` is the loader's whole check for a folder and a list of entries, and returns `{ actions, refused, reach, warnings }` (reach and warnings: Maps, one entry per loaded script). `load()` reads registry.json and calls it; make-registry.js calls it on the spec. An action of a kind other than script with `runsAs` is refused here, moved from act.js, before scripts are prepared (N1, the 11 Nov note). `runsAsAnyKindForBusTests: true` turns that off, for the bus's own tests only (they test the bus's `runsAs` on native actions); a guard test fails if act.js or make-registry.js ever names it. An input field whose NAME breaks `^[a-z][a-zA-Z0-9]{0,31}$` is refused with a message naming that rule, not the type list. The header says registry.json is written by make-registry.js, and that `runsAs` is for scripts only)
- v1.2.4 (061126 · v0.53.2: optional targetForm, validated; none on scripts)
- v1.2.3 (051126 · v0.53.0 third check C1/C2: every script's reach records `tainting` — true when it can bring web/model text back to its caller: it reaches (through other scripts too) an action producing web/model, messages or file-read, OR it or a script it reaches reads script memory (remembered — text another run kept). act.js counts such a script as a source for the no-laundering rule)
- v1.2.2 (041126 review R4: a script that reaches another script running as the SAME identity is refused at load — one run at a time per identity, so the inner call would wait for the outer run until its time limit)
- v1.2.1 (041126 review R3: a script that reads `messages` counts as reading model/web data for its warnings — a world action after it needs the admin's acceptWarnings)
- v1.2.0 (301026)

## act/core/targets.js

- v1.1.1 (061126 · second-reader review, round 2: echoed caller text goes through safe())
- v1.1.0 (061126 · second-reader review, round 1, 12:01):
- v1.0.0 (061126):

## act/daemon/pkd.js

- v1.0.1 (041126: passes the run's message time to the evaluator — (now), eval 1.6.0)
- was v1.0.0 (031126)
- v1.0.0 (031126; review H1: started with an EMPTY environment — it holds no secret).

## act/daemon/supervisor.js

- v1.2.0 (171126 · v0.54.6: every label list a daemon sends — a call's `labels` and `ctl`, a state-set's `labels`, a finished run's `labels` and `seen`, a script error's `labels` — must be a list of known labels; anything else is audited `daemon-malformed` and refused, never mapped to `[]`. A malformed call is answered `BAD_MESSAGE` and does not run; a malformed state-set or end fails the run. A failure that is not a script error may carry no labels. `BAD_MESSAGE` is not transient)
- v1.1.2 (111126 · v0.54.4: TRANSIENT is the five codes this file throws; DEDUPE_FULL, never thrown, is no longer named. The two lists stay equal)
- v1.1.1 (111126 · v0.54.3: TRANSIENT names DEDUPE_FULL too — the bus's code, never thrown here; the engine keeps it from a child call. The two lists stay equal)
- v1.1.0 (081126 · v0.53.6: option productName; the DAEMON_PAUSED message is host-neutral — "… it stays paused until <product> starts again (check the audit log first)" — because the pause ends only when a new Supervisor is made, not by an admin's hand; the header says the same — "until the process starts again", was "until the server restarts")
- v1.0.4 (061126 transient refusals, second-reader review, round 3: every refusal of a run that was NEVER ATTEMPTED carries .transient = true and a code — DAEMON_FULL, DAEMON_OVERLAP, DAEMON_EVICTING (an idle daemon is being stopped for this start: a slot frees within graceMs), DAEMON_PAUSED (the breaker), DAEMON_RESTARTING (the crash back-off); the bus passes the class on, the scheduler retries such a fire once. Only this file sets it: a daemon cannot claim it, because a daemon's own failures are built from its message text, never its fields. A shut-down supervisor is NOT transient)
- was v1.0.3 (061126 lab suite 7: the daemon cap holds under concurrent starts — room() is synchronous, so the cap check and the spawn happen in one turn; a starting or about-to-run daemon is 'claimed' and is never evicted to make room · 061126 second-reader review, round 1: the two cap refusals carry a code (DAEMON_FULL: every slot taken · DAEMON_OVERLAP: a second concurrent run for the same identity), are audited 'daemon-busy', and never count toward the crash breaker; 061126 second-reader review, round 2: TERMINATION IS GUARANTEED and the cap is a hard process bound — every stop (eviction, idle stop, timeout) goes through retire(): the daemon leaves the identity map at once (no run is ever handed to it) but keeps its SLOT in this.dying until its child's 'exit' event; SIGTERM, then SIGKILL after graceMs (default 2 s) if it has not exited (a timeout sends SIGKILL at once); the stop is audited with how it died (how: term · kill · exit). room() stays synchronous and counts dying slots: while one is dying a start may be refused DAEMON_FULL, which is the bound working. So at most `max` daemon processes exist, ever — except when the SERVER itself is killed: this file cannot act then (no timers survive it); each pkd.js exits on IPC disconnect, after its current fuel-bounded run (measured 6 Nov: ~3 s))
- was v1.0.2 (031126 macOS install: the daemon is started by the REAL path of its file and allowed its folders' real paths — Node's permission model refuses to resolve a symlinked path, so code reached through one (macOS: /var → /private/var) could not start)
- was v1.0.1 (031126 review: H1 the daemon gets an EMPTY environment — no MAIL_APP_PASSWORD or any other secret; L1 a daemon killed for overstaying is forgotten at once, so the next run starts a fresh one and one timeout counts as ONE crash)
- was v1.0.0 (031126)

## act/mail/outbox.js

- v1.2.0 (191126 · v0.54.7, issue #12: a refused mail's line writes `to` only where the lowercased address passes `ADDR`, else `null`; it wrote the address as given, before the check, and the reason quoted it; the reason now names the rule. A refused mail whose address passes is recorded lowercased)
- v1.1.0 (081126 · v0.53.6: option productName; the footer says "Sent by <product> for …" (footer() takes product, default ACTBUS))
- v1.0.1 (031126 review: M1 delivery re-checks MAIL_ALLOW — mail to an address removed since it was queued is failed, not sent; M2 a record is marked "sending" on disk BEFORE it is handed to the server — if that write fails nothing is sent, and a record left "sending" by a crash is failed, never resent (it may have gone out); a failing audit can no longer throw out of a delivery pass; the "queued" audit line is written before the record — no line, no mail)
- was v1.0.0 (031126)

## act/mail/smtp.js

- v1.1.0 (081126 · v0.53.6: X-Mailer is the host's name (fromEnv(env, { productName }) → cfg.product → build({ product }), default ACTBUS); the EHLO name is MAIL_HELO when set (a host name or an address literal, checked at start — a bad one turns mail off), else the host name, else the address literal [127.0.0.1] (was the name "synthekos"); stated limit: an IPv6 address literal is refused)
- v1.0.1 (031126 review: plaintext the server sent after "220" to STARTTLS is discarded before TLS)
- was v1.0.0 (031126)

## act/mailbox.js

- v1.4.0 (191126 · v0.54.7, issue #12: a refused message's line writes `to` and `topic` only where each passes `NAME`, else `null`; it wrote them as given, before the checks, and the reasons quoted them; the reasons now name the rule)
- v1.3.0 (171126 · v0.54.6: `read(to, topic, trace, accept, own)` needs both filters and `ack(to, ids, accept)` its one; a missing filter throws, and nothing is read, claimed or removed. Before, `accept` defaulted to `() => true` and `own` to `accept`, so a caller that passed a narrow `accept` alone marked a sender the recipient still accepts dead, for good)
- v1.2.2 (161126 · v0.54.5: a record without a `labels` list is not a message record — it is moved to `.corrupt/` once and logged once, like any damaged file; `send` has always written one)
- v1.2.1 (051126 · review R1 L3: ack removes only messages HELD for a key holder — a message never delivered, or one a script's run has claimed, is left alone; hold() marks a record keyHeld + heldTrace (on disk), a new claim clears heldTrace)
- v1.2.0 (051126 · v0.53.0 · TENTACLE A1, ACTBUS docs/functions-and-mailboxes.md §5: ACKNOWLEDGEMENT for key holders — hold(trace) ends a run WITHOUT removing what it read: the messages stay claimed until the reader acknowledges them (ack) or claimMs (10 min) passes, then they are delivered again (dead after maxAttempts). ack(to, ids, accept) removes acknowledged messages from the reader's OWN mailbox only, from senders this run may see; an id that is unknown, already gone or dead is ignored (an ack is idempotent). Scripts keep finish() — unchanged)
- v1.1.1 (041126 review R3: a run that has FINISHED cannot claim again under its trace (a timed-out in-process script kept running); a record that parses but is not a message is treated as damaged; a message marked dead by 1.0.0 (no diedAt) starts its 7 days now; a damaged file that cannot be moved is reported once)
- v1.1.0 (041126 review R2: M1 dead messages expire after 7 days and at most 100 are kept per recipient; finish() touches only the mailboxes its run read from; M2 a damaged file is moved once to .corrupt/; M3 only the RECIPIENT's own rule marks a message dead — a narrower caller in the chain just doesn't see it; L2 the read and done lines are written FIRST (fail closed); L5 looking at an unknown mailbox creates nothing)
- was v1.0.0 (041126)

## act/make-registry.js

- v1.2.0 (111126 · v0.54.2, the fourth cold read's #1: the spec, with each file's sha256, goes through the loader's own check (`registry.check`, with the script engine from `createEngine`, no daemon). Every refused action is printed with the loader's reason on stderr, then nothing is written: exit 1, and a registry.json already there stays as it was. Each loaded script's reach, its literal targets and every warning it accepts are printed under its ✓ line. The header says: approval runs each action file's top-level code, exactly as the server does at start; run make-registry.js as the user the server runs as, not as yourself. The registry.json it writes has the same form as before)
- v1.1.1 (101126 · v0.54.0: an on-message trigger's approval line reads "on message, topic <topic>", not "at undefined undefined"; the file it writes is unchanged)
- v1.1.0 (031126 slice 3: also approves triggers — triggers.spec.json → triggers.json, every entry checked; a bad entry, or one naming a script that is not a registered script, stops it: nothing is written)
- was v1.0.0 (281028)

## act/proteus/engine.js

- v1.6.2 (171126 · v0.54.6: a literal `:to` — the recipient of send and email — is in a script's reach list, with `:url` and `:name`)
- v1.6.1 (171126 · v0.54.6: a comment only — after supervisor 1.2.0, `clean()` drops a credential; its `: []` branch and its known-label filter stay as defence in depth)
- v1.6.0 (111126 · v0.54.4: 1.5.1's child-call transient path is removed — no child call can be refused DEDUPE_FULL any more (bus 1.7.0). A script that started and then met a refused call answers ACTION_ERROR, its message naming the code; a run the supervisor refused before it started keeps its code and .transient (1.4.1))
- v1.5.1 (111126 · v0.54.3: a child call the bus refused transiently is kept in THIS process; the language cannot catch an error, so that refusal ended the script. When it was the script's FIRST action call, the caller gets its code, `transient: true` and `retryAfterMs`; after an earlier call it stays ACTION_ERROR, its message naming the code. In-process and daemon alike; only the bus's reply counts, never the daemon's word)
- v1.5.0 (081126 · v0.53.6: option productName, given to the Supervisor it makes)
- v1.4.1 (061126 transient refusals: a supervisor refusal of a run that never started keeps its code and .transient — only the five supervisor codes, only from the supervisor itself)
- was v1.4.0 (041126 eval 1.6.0: every action call inside a (define …) body counts as branched in the survey (the function may run under any condition, or many times); each run gets (now) = the time of the message that started it)
- was v1.3.1 (031126 review H2: the core no longer takes a daemon's word — a call outside the script's approved reach is refused and audited; labels from the daemon must be known labels and NEVER a credential (`grounded`): a run whose input carries a credential, or whose script can reach (through other scripts too) an action that produces one, runs IN-PROCESS, where the evaluator tracks it per value (audited daemon-skipped) — no live action produces one today; state writes are checked the same way. Warnings a daemon drops cannot be detected without re-running the script: that trust is the same as in-process)
- was v1.3.0 (031126 slice 3: with { daemon } a script runs in a SEPARATE daemon process (act/daemon/pkd.js, supervisor.js) that only sends messages; the core keeps the bus, the grants, the labels and the state file; in-process stays the default)
- was v1.2.2 (031126 F-B focused review: the header names the state folder 1.2.1 uses)
- was v1.2.1 (031126 F-B review 3: script state under <stateRoot>/.pk-state/ — no identity's file folder can reach it)
- was v1.2.0 (031126 F-B: the reply's credentials are exactly those of the returned value — ctx.replyCredentials, bus 1.3.0)
- was v1.1.0 (301026)

## act/proteus/eval.js

- v1.6.1 (041126 second-reader review of 1.6.0: U1 replace / join / str check the result's LENGTH BEFORE building it — a JS RangeError escaped without the labels that decided it — and any non-script error is now a RUN error carrying everything seen; C1 parse-json refuses a number it cannot read EXACTLY (1.00000000000000001 became 1, still grounded) and any exponent; C2 the built-in table has no prototype — (constructor) was a JS TypeError, now an ordinary CHECK refusal)
- was v1.6.0 (041126 FUNCTIONS + STANDARD LIBRARY, ACTBUS docs/functions-and-mailboxes.md §2):
- was v1.5.0 (041126 MERGE: the live line 1.1.4 and the staging kit line 1.4.2 become one — 1.4.2 IS 1.1.4 + the collection forms (filter collect count sum max-by min-by sort-by) + (the …) + review fix R1, all already reviewed with F-A and F-B; nothing else differs)
- was v1.4.2 (031126 F-B round 3, the LITERAL rule (the owner): grounded only on a value read as-is — every computed value (comparison, arithmetic, str, not, len, count, sum) drops it; control sent to an action carries none)
- was v1.4.1 (031126 F-B review fixes: len / count / sum never grounded (the owner); collect's list is data; a list of unlabelled values is person; nil read from nothing and every error carry no credential)
- was v1.4.0 (031126 F-B: CREDENTIALS FOLLOW DATA ONLY — `grounded` is earned only when EVERY data input is grounded; a condition, a selector key or an earlier and/or operand never lends it; warnings still follow data AND control; ACTBUS docs/reviews.md, PROTEUS-K review finding 1)
- was v1.3.1 (031126 F-A: SIZE BUDGET — every value carries its expanded size; a value over 2 000 000 units is a RUN error, not an out-of-memory crash of the server; ACTBUS docs/reviews.md, PROTEUS-K review)
- was v1.3.0 (021126)

## act/proteus/rational.js

- v1.1.0 (281028)

## act/proteus/reader.js

- v1.0.0 (301026)

## act/proteus/state.js

- v1.1.1 (031126 review H2: set() refuses labels that are not a list of known labels)
- was v1.1.0 (031126 slice 3: snapshot() — a copy of the keys and absent labels for a script daemon; folder per engine 1.2.1: <stateRoot> is the engine's .pk-state/)
- was v1.0.0 (301026)

## act/scheduler.js

- v1.3.1 (161126 · v0.54.5, issue #15: a retry is due at the first tick no more than 500 ms before its time; its time, set when the refusal comes back a few ms after the tick, made the second retry fall either side of the tick 30 s later)
- v1.3.0 (101126 · v0.54.0: at every start the state gains `loaded: { at, ids }`, the ids of the triggers it loaded — a refused entry is not among them; the list is replaced at each start, never a union — and act/trigger-off.js reads it. load() is unchanged, so an older state file still loads and the next start adds the list. The design comment on the state names `<stateDir>/scheduler.json`, the stateDir act.js passes, and that act.js consumes the files in `.scheduler/off/`)
- v1.2.0 (061126 TRANSIENT refusals, second-reader review, round 3: a TIME trigger's fire that the kernel refused with transient: true — the run never started — climbs ONE ladder, the same for every code: retry after retryMs[0] (5 s, longer than the supervisor's 2 s grace), then retryMs[1] (30 s), then `lost` — the code is the WHY, in the audit line, not in the schedule. One exception, because it was found end to end: a DAEMON_EVICTING refusal is never the last word — a slot is already being freed for this fire — so if the ladder is spent it gets one more retryMs[0] try, once per fire (at most 4 tries; a busy run that outlasts the first rung makes the 30 s retry the evicting start, and without this the fire was lost). A retry is the same fire: it does not move the trigger's `last`. IN MEMORY: a pending retry lives only in this process. A restart drops it, and that fire is then LOST, not late — its `last` was written when it first went out, so the next fire is the next period; the `missed` policy (skip / run-late) is about periods that fall due while the box is down, as before. Nothing is audited at the restart (there is nothing to audit then). RATE: every try is a fire like any other — it counts once in the scheduler's per-identity fires-per-hour cap and once in the bus's per-identity rate (bus.js, counted before dispatch). At most 4 tries per fire, so it cannot matter; written here so nobody wonders. Any other failure is not retried. A normal fire that comes due first replaces the pending retry (never two). A MESSAGE trigger needs no retry: the run claimed nothing, the messages are still waiting, and the next tick fires again)
- was v1.1.0 (041126 MESSAGE TRIGGERS, ACTBUS docs/functions-and-mailboxes.md §3: { id, script, runsAs, on: "message", topic } fires when runsAs has waiting messages on that topic (pending(identity, topic) from the core's mailbox); no overlap, the per-identity cap and the switch-off apply; a capped message trigger logs at most once an hour)
- was v1.0.1 (031126 review: M3 an `at` trigger steps through LOCAL dates — a 23:30 trigger no longer skips the spring-forward day; L2 the state maps have no prototype — a trigger named "constructor" is not "switched off"; an `every` trigger's first due time is kept, so restarts more often than its period no longer push it away for ever)
- was v1.0.0 (031126)

## act/shutdown.js

- v1.1.0 (061126 · v0.53.5 round 2, second-reader review, round 1: + SIGHUP; a stop() or server that does not exist yet is logged and the stop goes on)
- was v1.0.0 (061126 · SYNTHEKOS v0.53.5 · second-reader review, round 3 on 0.53.3, ask 2: the server's stop path)

## act/test/audit-escape.test.js

- v1.0.0 (201126 · v0.54.8, issue #20: every class of unsafe character, fed through a request, a page in a script's child call and a script error, reaches the audit escaped and reads back the same; `auditLine` at the 4 096 / 4 097 boundary, the 200-character cut and the fallback line; six FAIL-FIRST, one GUARD)

## act/test/bus-audit.test.js

- v1.0.0 (161126 · v0.54.5: a bus with no audit destination is refused at construction — two FAIL-FIRST, two GUARD)

## act/test/caller-pays.test.js

- v1.0.0 (111126 · v0.54.4, new: 6 tests. FAIL-FIRST: three callers use a shared script at a cap of 3 and a fourth is still served (in-process and daemon); a caller one id below its cap runs a script that runs as itself; three callers drive a script identity allowed 3 a minute and a fourth is not refused RATE; a caller allowed 3 a minute is refused at its own 4th message through a script. GUARD: a time trigger's calls count against its runsAs identity)

## act/test/collect.test.js

- v1.0.1 (031126 F-B: one assertion inverted — a literal :name makes an action call not grounded; count by a literal comparison is not grounded)
- was v1.0.0 (021126)

## act/test/core.test.js

- v1.1.3 (171126 · v0.54.6: two tests, `allow-list 1.1.1`, by bfs2021 from pull request #19 (commit 975e0a5), taken byte for byte with the comment before them: a grant that omits `targets` does not drop out of a chain. They pass on v0.54.5 and guard issue #18 from here on)
- v1.1.2 (111126 · v0.54.2: the two test registries with native actions that carry `runsAs` (makeBus, and the service world) load with `runsAsAnyKindForBusTests: true`, since registry.js 1.3.0 refuses `runsAs` on any kind but script by default; no test changed name or assertion)
- v1.1.1 (081126 · v0.53.6: test data renamed to neutral model and node names (model-a, node-a, node-b); no test name changed)
- v1.1.0 (061126: 0.53.2 — the allow-list is refused by the bus, NO_TARGET; 3 tests that fail on bus 1.4.4)
- v1.0.0 (281028)

## act/test/core120.test.js

- v1.0.0 (301026)

## act/test/credentials-bus.test.js

- v1.3.0 (031126; 1.3.0: focused review — an envelope with a lying label list · 1.2.0: review 3 — any hand-built envelope carrying the credential is refused (null, missing or invented replyTo); the file test uses a grounded TEXT; script state cannot be written by an identity named s-<script> · 1.1.0: round 3, the literal rule — a test-only action `docfact` registered as PRODUCING grounded is the only way the credential enters the bus, as on a real box; native replies, children, control and hand-built roots)

## act/test/credentials-coll.test.js

- v1.1.0 (031126; 1.1.0: review-2 F2 + the owner: count / sum / len never grounded)

## act/test/credentials.test.js

- v1.2.0 (031126; 1.2.0: round 3, the LITERAL rule — every computed value drops grounded; control carries none · 1.1.0: review-2 fixes F3 F5 F6 F7 + the owner: a length is never grounded)

## act/test/daemon-fields.test.js

- v1.1.1 (201126 · v0.54.8, the cold read of v0.4.0, finding 2, and the review of the repair, R6 and R8: through `act.js` with a stand-in daemon, a `daemon-dropped`, `daemon-malformed` or `daemon-start` line keeps its own time; the message type is `msg`; a hostile or list `runId` and a text `pid` are `null`; five FAIL-FIRST, one GUARD. The stage files before it: 1.0.0 without the `runId` list and `pid` tests, 1.1.0 with them; 1.1.1 changed one comment)

## act/test/daemon-message.test.js

- v1.0.0 (171126 · v0.54.6: a malformed label list from a script daemon is refused, not mapped to [] — eighteen FAIL-FIRST, five GUARD, through the real supervisor, engine and bus with a stand-in daemon)

## act/test/daemon.test.js

- v1.0.2 (061126 · 0.53.4: the start that evicts is refused DAEMON_EVICTING, not DAEMON_FULL — test 12's one assertion)
- v1.0.1 (061126: + the cap under concurrent starts, + a starting daemon is never evicted, + second-reader review, round 1: the cap asserted at EVERY step, a same-identity overlap refused DAEMON_OVERLAP / audited / never a crash, the cap with REAL forks (max 2, three identities, ≤ 2 daemons and ≤ 2 child processes throughout) — all FAIL on supervisor 1.0.2; lab suite 7 d1-cap; + second-reader review, round 2: a stopped daemon keeps its SLOT until its process exits and a SIGTERM-ignoring one is SIGKILLed after the grace — on eviction, on idle stop, and on a timeout; these three FAIL on round-2 code)
- was v1.0.0 (031126)

## act/test/dedupe-full.test.js

- v1.1.0 (111126 · v0.54.4: the five script tests of 1.0.0 are removed with what they tested; three tests added, FAIL-FIRST: an id of "" is refused BAD_ENVELOPE, and a missing id still gets one; an id that is not a string is refused 400 BAD_ENVELOPE through act.js, and through the edge; the edge test sends `retryAfterMs: 0`, which only the floor turns into 1 s)
- v1.0.0 (111126 · v0.54.3, new: an id is remembered for the whole window; at the cap the bus refuses DEDUPE_FULL, never forgets — the request path, the start path, ageing out, per identity, M14, through act.js (503 + the true Retry-After), the edge, a time trigger (the ladder, then lost), and a script: refused before it starts when its identity is full, a 422 naming DEDUPE_FULL after a file-append (appended once; the retry refused before it starts), each in-process and in a daemon, and two calls past the pre-check together (the second's first action call refused, 503). 11 FAIL-FIRST on v0.54.2, 2 GUARD)

## act/test/edge-relay.test.js

- v1.0.1 (201126 · v0.54.8, the cold read of v0.4.0, finding 5: through `act.route`, a key holder that may fetch cannot write unlabelled page text to a world action, and its message carries the `web` label; two fail with `act.js`:358's labelling removed, one GUARD. The stage file before it, 1.0.0, cited the same lines by their numbers in `act.js` 1.9.4, 338–344; 1.0.1 changed those two comments only)

## act/test/email.test.js

- v1.0.1 (081126 · v0.53.6: the footer check reads "Sent by ACTBUS" — this Outbox is given no name)
- v1.0.0 (031126)

## act/test/empty-chain.test.js

- v1.0.0 (171126 · v0.54.6: an empty chain holds no grant and no models, on purpose — two FAIL-FIRST, four GUARD)

## act/test/eval.test.js

- v1.0.0 (301026)

## act/test/functions.test.js

- v1.0.0 (041126)

## act/test/harness.js

- v1.0.0 (081126 · v0.53.6-purpose: its first version line; the code is as it was)

## act/test/id-charset.test.js

- v1.0.2 (191126 · v0.54.7, issue #12: an id, a trace and a replyTo outside the rule are refused at every door — the route, the edge, `ask`, a hand-built `dispatch` — and the value reaches no reply, reason, audit line or dedupe line; eight FAIL-FIRST, five GUARD. The stage files before it: 1.0.0 held five of its values as raw characters in its source, 1.0.1 wrote them as `\u` escapes (the same strings), 1.0.2 changed comments only)

## act/test/invariants.test.js

- v1.0.0 (021126)

## act/test/mail-fields.test.js

- v1.0.0 (191126 · v0.54.7, issue #12: a refused message or mail records its `to` and `topic` only where each passes its rule, through the send action and with the mailbox and the outbox called directly; four FAIL-FIRST, four GUARD, two of which show that through the bus a `to` outside the rule never reaches the mailbox or the outbox)

## act/test/mailbox-record.test.js

- v1.0.1 (171126 · v0.54.6: `read` needs both filters; its four calls pass `() => true` for both, as the defaults did)
- v1.0.0 (161126 · v0.54.5: a record without a labels list is not delivered — three FAIL-FIRST, two GUARD)

## act/test/mailbox.test.js

- v1.0.2 (171126 · v0.54.6: `read` needs both filters; each call that relied on the defaults passes what they gave, and the one that passed a narrow `accept` alone passes the same function as `own`; no test's meaning changed)
- v1.0.1 (061126: the bus tests load BUILT-IN actions only, from a temp copy — an installed script no longer breaks them)
- v1.0.0 (041126)

## act/test/make-registry.test.js

- v1.1.0 (111126 · v0.54.2: 10 tests added, 2 kept by name. GUARD (second-reader review of v0.54.2, round 1): act.js and make-registry.js never name `runsAsAnyKind`, and each makes one registry call with exactly `{ scriptEngine: engine }`. FAIL-FIRST on v0.54.1's files: the reader's three scripts (an unregistered call, `world: false` reaching fetch and file-append, a world action under web data with no acceptWarnings) each exit 1 with the loader's reason and write no registry.json; a dashed input name is refused with the field-name rule; a script calling a native action with `runsAs` is refused at load; one folder with ten kinds of refusal gives the tool and `create()` the same refused names and reasons; the reach and the accepted warnings are printed; a registry.json already there is left byte for byte on a refusal. GUARD: the shipped actions folder is approved with the same entries and pins as the shipped registry.json. The fixture folder now holds the shipped actions and a script the loader loads: the old one called calc with no calc in the folder)
- v1.0.0 (101126 · v0.54.0: make-registry.js on a temp folder — the three kinds of trigger (every, at, on message) give their exact approval lines and never "undefined", FAIL-FIRST on v0.53.9's file; a trigger naming a script that is not registered stops it: exit 1, no triggers.json)

## act/test/models-chain.test.js

- v1.0.0 (201126 · v0.54.8, the cold read of v0.4.0, finding 6: a model is allowed only if every identity in the chain lists it, through a script that runs as another identity; two fail with `bus.js`:205's chain replaced by the running identity, one GUARD)

## act/test/name-fields.test.js

- v1.0.1 (191126 · v0.54.7, issue #12: a refusal writes `from` and `action` only when each is a name, at the route, the edge, `ask`, a hand-built `dispatch`, a child call and the hop limit; eight FAIL-FIRST, five GUARD, one of which pins the stated limit: a run's input is recorded as sent. 1.0.0 was the stage file, the same tests with comments that pointed to documents a reader cannot open)

## act/test/p0.test.js

- v1.0.0 (051126 · v0.53.0 · second-reader review, fix list P0)

## act/test/product.test.js

- v1.2.0 (091126 · v0.53.8: `make()` and the two `models: {}` cases pass a `modelUrl`; the no-`modelUrl` test is now `create()`'s refusal — `models` given and `modelUrl` missing, empty, blank or not a string, nothing created; a guard that a host with no `models` has no model action and needs no `modelUrl`; an unknown option name is refused with the list of known names, its echo stripped and cut, `__proto__` included; options that are not an object are refused; a guard that the model action's own refusal, reached through `modelAdapter()` without `create()`, is a plain Error and makes no request)
- v1.1.0 (091126 · v0.53.7: the alias test is replaced — `modelUrl` is where the model is asked, with no log line; `ollamaUrl` is refused before anything is created, alone and next to `modelUrl`; a model call with no `modelUrl` is a plain refusal)
- v1.0.0 (081126 · v0.53.6: the five sites three ways — SYNTHEKOS, the ACTBUS default, HostApp — plus create()'s productName, modelUrl and the ollamaUrl alias)

## act/test/reader.test.js

- v1.0.0 (301026)

## act/test/required-filters.test.js

- v1.0.0 (171126 · v0.54.6: the mailbox's read and ack filters are required, and a literal `:to` is in a script's reach — five FAIL-FIRST, three GUARD)

## act/test/retry-slack.test.js

- v1.0.0 (161126 · v0.54.5, issue #15: on exact 15 s ticks with the refusal back 1, 3, 17 or 250 ms late, the retries are 15 s and 30 s after the fire — four FAIL-FIRST, two GUARD)

## act/test/review-fn.test.js

- v1.0.0 (041126)

## act/test/review-s3.test.js

- v1.0.4 (171126 · v0.54.6: two H2 tests pinned the old mapping of a daemon's bad label lists; a label that is not known, and state labels that are not a list, are now refused, so the tests expect a refusal and still show that no junk reaches a reply or the state; the second run of the state test sends a good list and works)
- v1.0.3 (081126 · v0.53.6: a test name no longer names the machine; it is now "macOS install: …")
- v1.0.2 (031126 + the macOS install: a symlinked code folder)
- v1.0.1 (031126 + the focused re-check: no credential from a daemon at all)
- v1.0.0 (031126)

## act/test/scheduler.test.js

- v1.1.0 (101126 · v0.54.0: + FAIL-FIRST loaded ids — the list is written at start, a refused id is not in it, a restart replaces it, and a start that loads nothing writes an empty list)
- v1.0.0 (031126)

## act/test/script.test.js

- v1.0.1 (031126: the state file now lives under <stateRoot>/.pk-state/ — engine 1.2.1, F-B review 3)
- was v1.0.0 (301026)

## act/test/selfreview.test.js

- v1.0.0 (301026)

## act/test/shutdown-harness.js

- v1.0.0 (061126 · v0.53.5; unchanged in round 2 — SIGHUP needs nothing here)

## act/test/shutdown.test.js

- v1.2.0 (161126 · v0.54.5, issue #11: the liveness check counts a zombie as gone, from /proc where there is one, else from ps; a state that cannot be read counts as alive. + a FAIL-FIRST test on a real zombie)
- v1.1.0 (061126 · v0.53.5 round 2, second-reader review, round 1: + SIGHUP row; + a stop / server that does not exist yet (a real ReferenceError))
- was v1.0.0 (061126 · SYNTHEKOS v0.53.5 · second-reader review, round 3 on 0.53.3, ask 2)

## act/test/size-collect.test.js

- v1.0.0 (031126)

## act/test/size.test.js

- v1.0.0 (031126)

## act/test/smtp-fixture.js

- v1.0.0 (031126)

## act/test/stdlib.test.js

- v1.0.0 (041126)

## act/test/targets-chain.test.js

- v1.0.0 (161126 · v0.54.5, issue #18: an absent targets field restricts a chain as an empty list does — two FAIL-FIRST, five GUARD)

## act/test/temperature.test.js

- v1.1.0 (091126 · v0.53.8: test 3 asserts that an own `temperature`, `modelOptions` or `options` option is refused at `create()`; an environment variable naming a temperature still changes nothing on the wire; a guard: an inherited `temperature` changes nothing on the wire)
- v1.0.0 (091126 · v0.53.7-temperature: the model's sampling temperature is 0.2 on every request, and no input field, `create()` option or environment variable can change it. A guard for a property that already held: no source file changed, and seven planted bugs, each failing a behaviour test, prove the tests bite)

## act/test/the.test.js

- v1.0.1 (031126 F-B review F7: one assertion inverted — the AMBIGUOUS error no longer carries the credential grounded; the possibilities are still returned)
- was v1.0.0 (021126)

## act/test/transient.test.js

- v1.3.1 (171126 · v0.54.6: `read` needs both filters; its one direct call passes `() => true` for both, as the defaults did)
- v1.3.0 (111126 · v0.54.4: "the same five codes"; two tests added, FAIL-FIRST: a native action that did work and then throws an error marked transient is ACTION_ERROR, for every code; a native that rethrows a child refused by a busy daemon is ACTION_ERROR while the same refusal of the script itself is DAEMON_FULL, transient)
- v1.2.2 (111126 · v0.54.3: the code list names DEDUPE_FULL; "the same six codes")
- v1.2.1 (081126 · v0.53.6: create() is given modelUrl, not ollamaUrl)
- v1.2.0 (061126 second-reader review, round 1: ONE ladder for every transient code — 5 s, 30 s, then lost — with the one exception the end-to-end test proves: a DAEMON_EVICTING refusal is never the last word; + Retry-After: 5 on the edge AND on act.js's /api/act)
- v1.1.0 (061126: + DAEMON_EVICTING — the end-to-end trigger test found the 30 s retry is often itself the evicting start, so it was LOST; + the evicting budget)
- v1.0.0 (061126 · v0.53.4, second-reader review, round 3: TRANSIENT refusals — a run that was never attempted is not a failure).

## act/test/trigger-off.test.js

- v1.1.0 (101126 · v0.54.0: 7 tests, every refusal of the script on its own failure path — end to end, the ✓ line is the kernel's sentence and the audit has trigger-switched-off and no trigger-off-unknown; an id the scheduler did not load (mistyped, or refused at start) is refused, exit 2, no ✓, no off-file, and the real trigger still fires; no state file; an unusable one (not JSON, no list, ids not a list); no act-files/; the default folder; the environment is never read. Four FAIL-FIRST tests fail on v0.53.9's script; the end-to-end test and the default guard are renamed for what they now check)
- v1.0.0 (101126 · v0.53.9: the trigger kill switch, end to end — with `--app-dir`, a host that passes its own appDir gets the trigger switched off and it does not fire; a folder where no kernel has run is refused (exit 2, no ✓, nothing written); with no `--app-dir` it writes beside act.js, as before. Two FAIL-FIRST tests fail on v0.53.8's script; the guard passes on both.)

## act/trigger-off.js

- v1.2.0 (101126 · v0.54.0: a reader of kernel state, not a guesser — it reads `<dir>/act-files/.scheduler/scheduler.json`, where the scheduler writes the ids it loaded at every start, and writes the off-file only for one of them. It writes nothing and exits 2 when the state file is absent, unreadable or has no list, or when the id is not in the list (a mistyped id, or one refused at start); the message names the loaded ids. Every refusal is exit 2, and the message tells them apart. The ✓ line says what the kernel will do: "wrote the off-file for <id>; the scheduler applies it at its next tick, audited as trigger-switched-off"; a second line names the file, the audit log and the start the list came from. "within 15 s" is gone: the tick period is the host's. The list is the last start's; the script cannot tell whether that kernel is running now)
- v1.1.0 (101126 · v0.53.9: `--app-dir <dir>` reaches the appDir the host gave to create() (no environment variable: a stale one could reach another kernel on the same machine); fail closed — unless <dir>/act-files/ exists it writes nothing and exits 2, and it no longer creates act-files/; the ✓ line names the file it wrote. Without `--app-dir` the folder is the one that holds act.js, as before.)
- v1.0.0 (031126)
