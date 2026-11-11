<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# Reviews: what each one found, where it was fixed, and the test that pins it

These were structured review rounds run by AI sessions reading the code cold: a second-session reviewer, and the build session reviewing its own work. They are not independent human review, which is still owed (README, Known gaps). The second reader was a separate AI session that had not seen the code being built, given the code and the rules cold, with its findings recorded and each fix pinned by a test that fails on the old code.

**How to read this page.**
- Each section is one review, in date order (2026). Its heading says what the kernel's comments call it, so a citation in the code leads here.
- **A tag belongs to its review.** `H1` in the mailbox review R2 and `H1` in the slice 3 review R-S3 are different findings; `R1` names both a finding of the 2 Nov invariant tests and the 5 Nov review of acknowledged reads. The index at the end resolves every bare tag in the kernel by file.
- **"Round N" belongs to its release.** Each release reviewed from 6 Nov on had its own rounds.
- **Tests.** A test under `act/test/` is in this repository. A *host test* is in the reference host's application tests (`test/act*.test.js` in SYNTHEKOS), which are not in this repository; SYNTHEKOS's release checks run them. **20 findings (21 host tests) are pinned only by host tests:** the seven of 28 Oct's `act.js` 1.1.0; R2 H1 and M4; R3 H1-bis; both of R4; 5 Nov R1 M2, L3 and L4, N2, C1 and C2; F09; and `v0.53.2` round 1's SAVE/LOAD finding (two host tests, "SAVE" and "LOAD"). Porting them is owed (README, Known gaps). Unless a test is marked *guard*, its file records that it fails on the code before the fix. That code is not in this repository, so this is a record to take on trust (README).
- **`act/CHANGELOG.md`** keeps the build history as it was written. Since `v0.53.7-cleanup` it names no reviewer, owner or build machine: the second reader appears as a second-reader review, a round as "round 1" or "review 1", and the owner as "the owner" (the note at its top says what was replaced). This page is the key to those entries. An "(owner decision, date)" in the code is a design choice the owner made on that date; it is not a review.

## 28 Oct: adversarial second-reader review of the capability core (1.0.0)

The reviewer was given only the code and the rules. It broke the first version of the core seven ways while all 29 of its tests passed. The account and its lessons are in `docs/capability-architecture.md` §12. Fixed in core 1.1.0; the tests are in `act/test/core.test.js`, section "adversarial review fixes (1.1.0)".

| # | Finding | Fix | Test (`core.test.js`) |
|---|---|---|---|
| 1 | High: run-as did not check the service identity's own grant | the chain is grown first, then everything is checked on it | `REVIEW 1 (high, exact repro)`, `REVIEW 1 (high): runsAs — the service identity must itself hold the action` |
| 2 | High: a 97-character calc input froze the bus for 120 s | every intermediate result bounded, operand sizes checked first | `REVIEW 2 (high)` |
| 3 | Medium: taint laundered through a file | provenance stored with each file; a file with none reads as web | `REVIEW 3 (medium)` ×2 |
| 4 | Medium: a dangling symlink escaped the folder on append | `O_NOFOLLOW`, checks on the open handle (`act/actions/file.js` 1.1.0, "adversarial review") | `REVIEW 4 (medium)` ×2, the second for hard links |
| 5 | Low: duplicate ids were shared across identities | ids are per identity | `REVIEW 5 (low)` |
| 6 | Low: inherited field names passed the input checks | own fields only | `REVIEW 6 (low)` |
| 7 | Low: `needs` limited only `require()` | documented as a declaration, not confinement (`act/core/registry.js`) | none: it is documentation |

Two more tests, `REVIEW hardening`, pin changes made at the same time that were not findings.

## 28 Oct: adversarial second-reader review of the host adapter (act.js 1.0.0)

A second set of seven findings, against `act.js` (`POST /api/act`). They are listed in `act.js`'s header, under "1.1.0 (adversarial second-reader review, 28 Oct — 7 findings…)":
1. **High:** a key holder could fetch web text and send it back unlabelled into a world action.
2. **High:** huge malformed requests flooded the audit log around the rate limit.
3. Wrong-shaped stored grants took every EUser down.
4. The owner was kept by login ID, so a rename moved ownership.
5. A role change away from EUser kept the grants. This fix is in the host application, not in this repository.
6. Refusals made in `act.js` were not logged.
7. The caller chose the trace id.

Fixed in `act.js` 1.1.0. Host tests: `test/act.test.js`, `REVIEW 1` to `REVIEW 7`, plus one *guard* ("passes on 1.0.0 too").

## 30 Oct: self-review of PROTEUS-K v0 (the build session)

This one was not a second reader: the build session reviewed its own interpreter. Six findings, S1–S6. They are recorded in `docs/proteus-k.md` §13, and each has one test in `act/test/selfreview.test.js`. S6 is a *guard*, not a found hole.

| Tag | Fix |
|---|---|
| S1, S5 | `act/proteus/engine.js` 1.1.0: a reply and an error carry the labels of the returned value and of everything the run computed |
| S2, S2b | `act/proteus/eval.js` 1.1.0: sticky control, because stopping early is a branch |
| S3 | engine 1.1.0: the load-time survey follows evaluation order |
| S4 | eval 1.1.0, engine 1.1.0, and `act/core/bus.js` 1.2.1 (`ctx.ctl()`): a called script runs under its caller's control |

`act/test/eval.test.js` also checks S2 and S4.

## 2 Nov: invariant tests for the collection forms (eval 1.2.0)

A separate session wrote `act/test/invariants.test.js`: 79 tests at the time, checking the label rules form by form. It found one mismatch:
- **R1:** a RUN error raised while converting the final value carried only that value's labels, not everything the run had seen.
- **Fix:** `act/proteus/eval.js` 1.2.0 ("review finding R1"). The conversion moved inside the `try`.
- **Test:** `invariants.test.js`, "errors: a RUN error converting the final value carries everything seen (sticky)".

## 2 Nov: the PROTEUS-K review (findings 1–12)

The kernel cites this as "PROTEUS-K review finding N".
- **Who:** a second reader whose task was to break the language.
- **What it read:** the specification (now `docs/proteus-k.md`), the capability architecture (now `docs/capability-architecture.md`) and the code.
- **Checking:** the build session reproduced every finding marked unsafe with its own scripts.
- **Result:** 5 unsafe findings, and none of them was caught by the 187 tests that existed then.
- **Grouping:** the fixes were grouped F-A to F-D.

| Group | Findings | What | Where it landed |
|---|---|---|---|
| **F-A** | 5 | Memory: shared references let a 420-byte script build about 10⁹ items, and the process died; fuel did not bound memory | `act/proteus/eval.js` 1.3.1, the size budget: a value over 2 000 000 units is a RUN error. Tests `act/test/size.test.js` (the 420-byte script) and `act/test/size-collect.test.js` (the reviewer's 2 KB script) |
| **F-B** | 1 | A value the *program* wrote came out `grounded`: `(and (input facts) "38")` | Credentials follow data only, warnings follow data and control: eval 1.4.0, then the 3 Nov rounds below. Tests `act/test/credentials.test.js` ("PROTEUS-K review finding 1 repro"), `credentials-coll.test.js`, `credentials-bus.test.js`, `collect.test.js` |
| F-C | 2, 3, 4, 9 (tie), 11–12 | Faults in an answer-agreement function of the host | Not in this repository: that function belongs to a host feature that is parked |
| F-D | 6, 7, 8, 10 | Minor: names on `Object.prototype`, deep input, `(the …)` over fractions, spec drift | The class of finding 6 was found again in eval 1.6.0 and closed by R-fn C2 (below). The others are not traced here to a fix and a test |

Finding 1 is a language-design finding. `grounded` is a credential, a positive claim, so it must never be over-counted. Warning labels may be over-counted. Hence two kinds of label with opposite flow.

## 3 Nov: the F-B rounds (review 2, review 3, the focused review)

Three more second-reader reviews of the F-B design broke its first two versions.

**Review 2** found F1–F7. The kernel and its history cite F1, F2, F3, F5, F6 and F7:

| Tag | Finding | Fix | Test |
|---|---|---|---|
| F1 | The bus copied input labels onto replies | `act/core/bus.js` 1.3.0, `act/core/envelope.js` 1.2.0 | `credentials-bus.test.js` |
| F2 | The list is data for `count` / `sum` / `collect` | eval 1.4.1 | `credentials-coll.test.js` "F-B review F2" |
| F3 | A length could be grounded | eval 1.4.1 (owner decision, 3 Nov 2026: never grounded) | `credentials.test.js` "F-B review F3" |
| F5 | A list of unlabelled values | eval 1.4.1: it is `person` | `credentials.test.js` "F-B review F5" |
| F6 | `nil` read from nothing | eval 1.4.1: not grounded | `credentials.test.js` "F-B review F6" |
| F7 | An error carried a credential | eval 1.4.1 | `credentials.test.js` "F-B review F7"; `the.test.js` 1.0.1 |

**Review 3 ("round 3")**:
- **Finding:** arithmetic in a loop rebuilt a grounded count (UNSAFE 2).
- **The literal rule** (owner decision, 3 Nov 2026): `grounded` marks only a value read as-is from the documents. Every computed value, every action reply, `nil` read from nothing, every error, and control all drop it. A caller cannot declare it, and only messages the bus minted may carry it.
- **Fixes:** eval 1.4.2; bus 1.3.1 and 1.3.2; script state under `.pk-state/` (engine 1.2.1, "F-B review 3").
- **Tests:** `credentials.test.js` "F-B round 3" ×3; `credentials-bus.test.js` 1.2.0 (hand-built envelopes, the `s-<script>` identity); `script.test.js` (the state folder).

**The focused review**:
- **Findings:** an envelope with a lying label list, and an envelope the bus did not mint.
- **Fixes:** bus 1.3.3, engine 1.2.2.
- **Test:** `credentials-bus.test.js` 1.3.0, "a hand-built envelope whose label list lies to the check".

## 3 Nov: the slice 3 second-reader review (R-S3): daemons, triggers and mail

Seven findings and one re-check, pinned by the tests in `act/test/review-s3.test.js`. The file records that every test fails on the code before the review: supervisor 1.0.0, engine 1.3.0, state 1.1.0, outbox 1.0.0 and scheduler 1.0.0.

| Tag | Finding | Fix |
|---|---|---|
| H1 | A daemon inherited the server's environment, secrets included | `act/daemon/supervisor.js` 1.0.1, `pkd.js` 1.0.0: an empty environment |
| H2 | The core took a daemon's word: calls outside the approved reach, minted credentials, junk state labels | `act/proteus/engine.js` 1.3.1, `act/proteus/state.js` 1.1.1; the *focused re-check* added one more test (no re-minting from an unrelated state key) |
| M1 | Mail queued for an address later removed from `MAIL_ALLOW` was still sent | `act/mail/outbox.js` 1.0.1: checked again at delivery |
| M2 | A crash mid-send could resend | outbox 1.0.1: marked "sending" on disk first; a record left "sending" is failed, never resent |
| M3 | A daily `at` trigger skipped the spring-forward day | `act/scheduler.js` 1.0.1: local dates |
| L1 | A timed-out daemon was reused, and one timeout counted as several crashes | supervisor 1.0.1 |
| L2 | A trigger named `constructor` was born switched off | scheduler 1.0.1: no prototype |
| (every) | An `every` trigger never fired when the server restarted more often than its period | scheduler 1.0.1 |

`act/mail/smtp.js` 1.0.1 records one more fix from the same day's review: plaintext sent after the STARTTLS reply is discarded. `review-s3.test.js` has no test of its own for it.

## 4 Nov: R-fn, the second-reader review of eval 1.6.0 (functions and the standard library)

Three findings, fixed in `act/proteus/eval.js` 1.6.1. Each has one test in `act/test/review-fn.test.js`, and each test fails on eval 1.6.0.
- **U1:** `replace`, `join` and `str` built over-long text before checking its length, and a JS RangeError escaped without the labels that decided it.
- **C1:** `parse-json` read numbers inexactly.
- **C2:** `constructor` was reachable as a built-in: the class of finding 6 of 2 Nov.

Kept by design: `(take x 0)` gives an empty list labelled `grounded`. The record is `docs/functions-and-mailboxes.md` §2.

## 4 Nov: the mailbox reviews R2, R3 and R4

These reviewed the mailboxes and the on-message triggers. The full account is in `docs/functions-and-mailboxes.md` §4.

**R2, adversarial: 2 high, 4 medium, 6 low.**

| Tag | Fix | Test |
|---|---|---|
| H1 | `act.js` 1.4.1: `send` is escalated like a world action, and `messages` counts as a source | host test `test/act-mailbox.test.js`, "R2 H1" ×2 |
| H2 | the audit rule narrowed: bodies are never written in the mailbox, send or email lines (`docs/functions-and-mailboxes.md` §3, Audit) | no test is tagged H2 |
| M1 | `act/mailbox.js` 1.1.0 | `mailbox.test.js` "R2 M1" ×2 |
| M2 | mailbox 1.1.0 | `mailbox.test.js` "R2 M2" |
| M3 | mailbox 1.1.0, bus 1.4.2 | `mailbox.test.js` "R2 M3"; host test "R2 M3" |
| M4 | bus 1.4.2: a message carries the sender's condition labels | host test "R2 M4" |
| L2 | mailbox 1.1.0 | `mailbox.test.js` "R2 L2" |
| L5 | mailbox 1.1.0 | `mailbox.test.js` "R2 L5" |
| L1, L3, L4, L6 | accepted, with reasons, in §4 | none |

**R3, a focused re-review of the fixes:**
- **High (H1-bis):** a script that takes input and reaches `send` was not escalated. Fixed in `act.js` 1.4.2; and since `act/core/registry.js` 1.2.1, reading messages counts for the warnings. Host test "R3 H1-bis", and the acceptWarnings check at load.
- **Medium and lows:** fixed in mailbox 1.1.1. Tests: `mailbox.test.js` "R3" ×4.

**R4, a narrow laundering check:**
- **The leak:** a script with input that only *remembers* was not escalated. Fixed in `act.js` 1.4.3; host test "R4".
- **The self-wait:** a script that reaches another script running as the same identity waited for itself until its time limit. It is now refused at load (registry 1.2.2); host test `test/act-mailbox.test.js`, the load check.

## 5 Nov: R1, the review of acknowledged reads and the person flag (with a re-review and a third check)

This reviewed the release that added acknowledged reads (`hold: true` / `ack`) and the `operatedByPerson` flag. Its first round is named R1 because it is that release's first review. It is not a mailbox review before R2.
- **R1:**
  - M2, its medium finding: a person-operated EUser could also hold a source of web text. Fixed in `act.js` 1.6.0; host tests "R1 M2" ×2.
  - L3: `ack` could remove a message the reader was never given. Fixed in `act/mailbox.js` 1.2.1; host tests "R1 L3" ×2.
  - L4: holding became opt-in. Fixed in `act/actions/messages.js` 1.1.1 and `act.js` 1.6.0; host test "R1 L4".
  - Its high finding, a race in a rate limiter, and its other low findings are not cited in the kernel's comments.
- **The re-review:**
  - N2: `file-read` alone counts as a source for the person flag. Fixed in `act.js` 1.6.0; host test "N2".
  - N1 is not cited in the kernel's comments.
- **The third check:**
  - C1, C2: a script handing back remembered web text was not counted as a source. Fixed in `act/core/registry.js` 1.2.3 (`tainting`) and `act.js`; host tests "C1", "C2".

## 5 Nov 2026: second-reader review of the whole system (fix list F01–F22)

The kernel cites this as "(second-reader review, 5 Nov 2026)". The reviewer read the live code of the whole application and wrote a fix list, F01–F22. The build session checked eight of its code claims against the code; all eight were true. Four items are in this kernel:

| Item | Fix | Test |
|---|---|---|
| F04 | The identity snapshot belongs to the call, not to the shared bus: `act/core/bus.js` 1.4.4, `act.js` 1.6.0 | `act/test/p0.test.js` "F04" ×2 |
| F05 | Every audit line is on disk (fsync) before it returns: `act/core/durable.js` 1.0.0, bus 1.4.4, `act.js` 1.6.0 | `p0.test.js` "F05"; host test `test/act-p0.test.js` "F05" |
| F06 | Accepted ids survive a restart: bus 1.4.4 | `p0.test.js` "F06" ×2 |
| F09 | https by default; plain http only where the grant says `http://`: `act/actions/fetch.js` 1.2.0, `act.js` 1.6.0 | host test `test/act-p0.test.js` "F09" ×3 |

The other items were:
- F01–F03, F07, F08 and F11–F13: in the host application or its operations.
- F10, F15 and F20: done. F10 is `act/CHANGELOG.md`, F15 is bus 1.4.3 (per-message labels), and F20 is this repository.
- F16: rejected, because two keys held by one client would launder by construction. Instead there is the person flag (above).
- F14 and F17: not done. F14 is in the README's Known gaps.
- F18, F21 and F22: not done.
- **F19, review by people outside the project: owed.**

## 6 Nov: v0.53.2, the kernel judges targets (rounds 1–3)

The bus refuses a target before dispatch, using the action's declared `targetForm`.
- **Round 1:**
  - A grant that lists targets for an action with no declared `targetForm` is refused at save and at load. Fixed in `act.js` 1.6.1 and `act/core/targets.js` 1.1.0. Host tests `test/act-targets.test.js` "SAVE" and "LOAD".
  - **A blocker:** test files depended on the machine's installed registry. Since then they load only the built-in actions, from a temporary copy (`act/test/mailbox.test.js` 1.0.1: "second-reader review: a blocker").
- **Round 2:** caller text echoed in a refusal is capped at 80 characters, with control characters removed. Fixed in targets.js 1.1.1. Test: `act/test/core.test.js` "caller text echoed in a refusal is capped at 80".
- **Round 3:** approved.

## 6 Nov: v0.53.3, the daemon cap is a hard bound (rounds 1–3)

- **Round 1:**
  - The two cap refusals carry a code (`DAEMON_FULL`, `DAEMON_OVERLAP`). They are audited and never count as a crash.
  - The cap holds at every step, also with real forks.
  - Fixed in `act/daemon/supervisor.js` 1.0.3. Tests: `act/test/daemon.test.js`, the cap at every step, a same-identity overlap refused, and the cap with real forks.
- **Round 2:**
  - Termination is guaranteed. A stopped daemon keeps its slot until its process exits, and one that ignores SIGTERM is killed after the grace.
  - Fixed in supervisor 1.0.3. Tests: the three daemon.test.js tests marked round 2, which fail on round 1's code.
- **Round 3:** approved. It asked for two follow-ups: transient refusals (v0.53.4) and the server's stop path (v0.53.5).

## 6 Nov: v0.53.4, transient refusals (rounds 1–3)

A run the supervisor never started is refused as transient, with a code, and is not a failure.
- **Round 1:**
  - One retry ladder for every code (5 s, 30 s, then lost).
  - `503` with `Retry-After: 5` on the edge and on `act.js`'s `/api/act` (`act.js` 1.6.2).
  - Tests: `act/test/transient.test.js` 1.2.0.
- **Round 2:** approved as built, with one exception kept. A `DAEMON_EVICTING` refusal gets one more try, because the end-to-end test showed that the plain ladder loses that fire.
- **Round 3:** confirmation that the host machine's results matched.

## 6–7 Nov: v0.53.5, the server stops its daemons first (rounds 1–3)

- **Round 1:** approved, with two additions:
  - SIGHUP is handled.
  - A stop that arrives before the kernel exists is logged and still raised.
  - Built as round 2: `act/shutdown.js` 1.1.0, `act/test/shutdown.test.js` 1.1.0.
- **Round 2** was approved. Its promote then stopped in its own gate, before the live system changed: the host's boot-test harnesses did not copy `act/shutdown.js`.
- **Round 3:** that was fixed in the host, and round 3 approved it.

## 8 Nov: v0.53.6, the host's name on the wire (rounds 1–3)

The kernel writes the host's product name, `ACTBUS` unless `create()` is given one, at the four places where others can see a name: the fetch User-Agent, the mail footer, the X-Mailer header and the message of a paused script daemon. `create()` takes `modelUrl`, the model server's address. With `productName: 'SYNTHEKOS'` the User-Agent, the footer and the X-Mailer are byte for byte what they were before. Settled before round 1: one parameter carried to every site; with no host name, the mail HELO is the address literal `[127.0.0.1]`; the paused-daemon message no longer assumes that an administrator restarts the host by hand; the old name of `modelUrl` is kept for one more release and refused when it disagrees with `modelUrl`.
- **Round 1:**
  - The name is checked when the kernel starts: 1–32 letters, digits, dots, dashes or underscores; `null` is refused, and only a missing name means the default. `act/core/product.js` 1.0.0.
  - `MAIL_HELO` is checked when the kernel starts, and a bad value turns mail off with a message. An IPv6 literal is refused, a stated limit. `act/mail/smtp.js` 1.1.0.
  - The host's own tests pass `modelUrl`; one kernel test kept the old name on purpose, to test it.
  - `act/test/product.test.js` names SYNTHEKOS on purpose: it is the reference host's regression test. The release check that no other file names the host keeps a declared list of exceptions, by file.
  - The supervisor's header comment was corrected in the same release, as a declared edit (`act/daemon/supervisor.js` 1.1.0).
  - Tests: `act/test/product.test.js` 1.0.0, each site three ways (the host's name, the default, a supplied name). 7 of its 8 tests fail on the code before; the eighth tests `act/core/product.js`, which is new.
- **Round 2:** approved. Two gaps in the release's own checks were found while it was built, and closed: the check that no code names the host did not look at regex literals (one, in `act/test/email.test.js`, which now asserts the default), and a comment edit in `act/mail/smtp.js`'s header had not been declared. Round 1 asked for the HELO to be asserted on the live machine too: SYNTHEKOS's release check `after-checks-0536` sends one message over a real STARTTLS handshake to a stand-in server on loopback.
- **Round 3:** the host machine's results matched, point for point.

## 9 Nov: v0.53.7, the old name of `modelUrl` is removed (rounds 1–3)

`create()` refuses the old name before anything is created, with a message that says to pass `modelUrl`; `act/CHANGELOG.md` holds the exact message, so a host maintainer who searches for it finds the fix. A model call when the host passed no `modelUrl` answers a plain refusal, not a `TypeError` (found while measuring for this release, with a model list that installs every model and no `modelUrl`). The internal model adapter is called `modelGenerate`. Settled before round 1, for later: refusing an option name `create()` does not know, and a model list with no `modelUrl`, are one rule, to be decided before the public repository (v0.53.8, below).
- **Round 1:** the release's own checks had two faults, found in simulation before any run, with the release bytes unchanged: the version check read a dated note instead of the newest version entry, and a cut message hid a line. The lines that must name the removed option to refuse and explain it are declared by file, line and exact text.
- **Round 2:** approved, on the host machine's numbers. A fault in a mutation script was found there, in tooling and not in the release: the host's `bash` 3.2 read the first byte of a non-ASCII character into a variable's name.
- **Round 3:** the host machine's first part of the promote, then live.
- Tests: `act/test/product.test.js` 1.1.0, the FAIL-FIRST test that the removed option is refused before anything is created, alone and next to `modelUrl`. The plain refusal is a suite property since v0.53.8 (below).

## 9 Nov: v0.53.7-temperature, a guard for the model's temperature (one round)

A test-only release: `act/test/temperature.test.js` 1.0.0. The kernel already sent temperature 0.2 on every request, and nothing a caller supplies reached it, so there was no old code for a test to fail on. Seven planted bugs prove the tests bite, each failing a behaviour test, not only the test that reads the source. One round, because no code changed.
- **Round 1:** approved.

## 9 Nov: v0.53.8, what `create()` refuses (rounds 1–3)

One rule, checked before anything is created: an own option name `create()` does not know is refused with the list of the names it takes; a renamed option is refused from a table, with v0.53.7's message; if `models` is given, `modelUrl` is required. Settled before round 1: the refused name is not echoed unbounded, the echoed-input class of v0.53.2's round 2.
- **Round 1:** the contract and its messages approved, with four changes:
  - the third message ends "… as modelUrl", the name a reader will copy;
  - a blank `modelUrl` is refused, at `create()` and at the model action's own guard;
  - `create()` checks own names only, so its contract does not depend on a host's prototype chain, and a guard test covers an inherited `temperature`;
  - the guard is reached by a test in the suite, without `create()`. The handler moved out of `create()` byte for byte into `modelAdapter()`, which `act.js` exports.
  - Fixed in `act.js` 1.9.0. Tests: `act/test/product.test.js` 1.2.0, "FAIL-FIRST create(): an option name it does not know is refused, with the list of known names, before anything is created", "FAIL-FIRST create(): if models is given, modelUrl is required — refused before anything is created" and the *guard* "GUARD the model action with no usable modelUrl answers a plain refusal, not a TypeError, and makes no request — reached without create()"; `act/test/temperature.test.js` 1.1.0, test 3 (an own `temperature` option is refused) and the *guard* "GUARD create(): an inherited temperature option changes nothing on the wire". A mutation that deletes the model action's guard is caught by the suite.
- **Round 2:** approved. `modelAdapter` is named in the README, so the kernel's interface is described in full.
- **Round 3:** the host machine's first part of the promote, then live.

**Releases that changed comments or names only** (`v0.53.5-headers`, `v0.53.5-changelog`, `v0.53.6-purpose`, `v0.53.6-docrefs`, `v0.53.7-cleanup`) were each reviewed in a round, and their release checks proved every other token identical before and after, names and test data changing only by declared rows. Their rounds are in the private provenance record.

## 9 Nov: two gaps in the release checks' own tools

The tools named here (`check-cleanup.js`, `check-1c.js`, `check-lab.js`) are the private release tooling of SYNTHEKOS and of this repository's predecessor; they are not in this repository. *D* is the release name check: it searches every file for the owner's name and addresses, machine names, internal document numbers and model names, decodes base64 and searches that too, and excuses a known-true line only by its own row (file, line, pattern, exact text).

- **A name-check gap, found 9 Nov:** the name check D of `check-cleanup.js` 1.0.0 reported each line once per pattern, so a second match of the same pattern on one line was hidden. It changed counts, never a verdict: a line with one match already fails, and an excused line is excused for its one pattern however often it occurs, so every earlier D result stands. `check-lab.js` 1.0.0 counts every match.
- **A regex gap, found 9 Nov:** `check-1c.js`, the token check of the 8 Nov comment-only release, read a regex token as `String(object)`, which is `[object Object]` on both sides, so a changed regex would have passed. That release changed no regex, so its result stands. Every checker since compares a regex by its pattern and flags.

## 10 Nov: the cold read of v0.3.0

Before the repository was made public, the whole `v0.3.0` tree, as `git archive` gives it and with nothing else, went to a fresh Claude Code session in an empty folder: no memory, no project notes, no instructions above the folder. Its brief: read this repository as its first outside reader, and say what is false, unclear, unfollowable or missing; try what the README says to run; change nothing. The reader is the same model family that wrote the code. It is the best cold read available before a human, and it is not a human. Its report is `docs/cold-read-v030.md`, word for word.

- **It ran:** `npm test` (371 of 371); `tools/kernel-test-check.sh` (pass); `lab/lab-check.sh` (12 of 12); the mutation harness on a copy, all 144 rows byte-identical to `lab/mutations/RUNS-0538_091126.tsv`, the table's third reproduction.
- **It could not run:** the byte-identity check (it needs the private SYNTHEKOS repository and a git clone) and the real-model run (no model server).
- **Its 30 findings, and how `v0.3.1` settles them:**
  - Fixed in this repository's text and tools: 1–7, 9–25 and 30. Among them, the README now says what can be checked here and what is taken on trust (2), `examples/minimal-host.js` is a complete host (6, 7), `tools/name-hashes.js` reproduces all three published hashes (11), the lab table has its documented-limit column (10), and the README's check order and `docs/kernel-flow.svg` follow `act/core/bus.js` (19, 20).
  - Fixed beside a file that cannot change: 26 (a note in `lab/mutations/README.md`; the sealed list keeps its sha) and 29 (a README note; `act.js` stays byte-identical).
  - Fixed in the README and `lab/mutations/README.md`: 8. Its matching comment in `lab/mutations/mutrun.sh`, and 27 (`lab.js`'s first lines), wait for the next lab release: a change to a lab program moves its version, and the mutation table's first line names that version.
  - Waiting for the next SYNTHEKOS release, because `act/` is byte-identical to it: 28 (and the comments of 29). Known gaps says so.
- **A human read:** the owner read the README and this page as a stranger before `v0.3.1` was built, and had no findings.

## 10 Nov: v0.53.9, the trigger kill switch reaches the host's `appDir` (rounds 1–3)

The second cold read's one behavioural finding (below): `act/trigger-off.js` 1.0.0 wrote its file beside `act.js` whatever `appDir` the host had given `create()`, and created the folder it wrote to, so for a host with its own `appDir` it printed ✓ and switched nothing off. SYNTHEKOS passes no `appDir`, so its own switch wrote where its kernel read.
- **Round 1:** the design approved. `node act/trigger-off.js <trigger id> [--app-dir <dir>]`: the folder is an argument only, never read from the environment, because two kernels on one machine both have an `act-files/` and a stale variable would switch off a trigger on the other one with a ✓. Without `--app-dir` the folder is the one that holds `act.js`, as before. It fails closed: unless `<dir>/act-files/` exists, it writes nothing and exits 2, and it never creates `act-files/`. The ✓ line names the file it wrote. One plant was added: a script that prints ✓ and writes into another folder must be caught by the end-to-end test, on the trigger still firing.
- **Round 2:** approved, on the host machine's numbers. Every check of the release passed there; the plant was caught on the fire.
- **Round 3:** the host machine's first part of the promote, then live.
- Fixed in `act/trigger-off.js` 1.1.0. Tests: `act/test/trigger-off.test.js` 1.0.0, "FAIL-FIRST end to end: with --app-dir, a host that passes its own appDir gets the trigger switched off — it does not fire", "FAIL-FIRST fail closed: a folder where no kernel has run is refused — exit 2, no ✓, nothing written anywhere" and the *guard* "GUARD default unchanged: with no --app-dir it writes into the folder that holds act.js (create()'s default appDir)". The two FAIL-FIRST tests fail on `v0.53.8`'s script.

## 10 Nov: the cold read of v0.3.1

The whole `v0.3.1` tree went to another fresh Claude Code session, the same way and with the same brief as the first. Its report is `docs/cold-read-v031.md`, word for word.

- **It ran:** `npm test` (371 of 371); `tools/kernel-test-check.sh` (pass); `lab/lab-check.sh` (12 of 12); `tools/name-hashes.js` (3 of 3); the example; the mutation harness on a copy, all 144 rows and the whole file byte-identical to `lab/mutations/RUNS-0538_091126.tsv`; the five suite generators, every sealed scenario regenerated byte for byte; and the fingerprint, recomputed from `lab/KERNEL-SHA256SUMS`.
- **It could not run:** the git checks (no clone), the byte-identity check (it needs the private SYNTHEKOS repository) and the real-model run (no model server).
- **Its 36 findings, and how they are settled:**
  - **The behavioural one, 1:** fixed in the kernel by SYNTHEKOS `v0.53.9` (above), which `v0.3.2` carries; the README describes the switch as it now works.
  - **The host's contract, 7–14 and 25:** `docs/host.md`, new: what `create()` returns and what a host must call, the record fields, the grants, the requests and their status codes, the 11 actions, the model server, mail and triggers. The README points to it.
  - **Fixed in this repository's text and tools:** 2–6, 15, 16, 19, 20, 22–24, 26, 27 and 29–36. Among them, the repository's address is in the README and `package.json` (2), the git checks are listed as needing a clone (3), the design records say what was not built (5, 6) and how to register a script without changing a kernel file (4, 15), and the README's example shows its fourth line (35).
  - **Fixed in a measured file, by a declared edit to one comment line:** 18 (`lab/mutations/RESULTS-0537-cleanup-words.md`, line 31) and 28 (`lab/EXPECTED-RESULTS.txt`, line 1). Their RESULT lines and table rows are unchanged.
  - **Fixed beside a file that cannot change:** 17 (a note in `lab/mutations/README.md`; the sealed list keeps its sha) and 21 (a README note on the date stamps; `act/CHANGELOG.md` is the kernel's).
  - **Still waiting:** `lab/mutations/mutrun.sh` still appends and still resolves a relative path against `lab/` (16; the README and `lab/mutations/README.md` say so), and `lab/lab.js`'s first lines (part of 19) wait for the next lab release, with the first cold read's 27: a change to a lab program moves its version, and the mutation table's first line names that version. The six `act.js` entries with no text (20) wait for a SYNTHEKOS release; Known gaps says so.

## 10 Nov: v0.54.0, the trigger kill switch reads the scheduler's list (rounds 1–3)

The third cold read's one behavioural finding (below): `act/trigger-off.js` 1.1.0 checked only that `<dir>/act-files/` existed, so a mistyped id got a ✓ and exit 0; the kernel then audited `trigger-off-unknown`, and the real trigger kept firing.
- **Round 1:** the design approved. At every start the scheduler writes the ids of the triggers it loaded to its state (`loaded: { at, ids }`; a refused entry is not among them), and the script writes the off-file only for one of those ids: it reads kernel state instead of guessing. Every refusal is exit 2, and the message tells them apart. The ✓ line says what the kernel will do, in plain text. In the same release: the approval line of an on-message trigger (the third cold read's 3) and the comment on where the scheduler keeps its state (its 5).
- **Round 2:** the host machine's numbers. Every check of the release passed there except one row of the kit's own claims table, which asked for a line no run prints. The row was fixed and the release files were unchanged. The claims template gained a rule: every proof that names a line of the host machine's check is shown matching a real one before a kit ships.
- **Round 3:** the host machine's check of the fixed kit, then live.
- Fixed in `act/trigger-off.js` 1.2.0, `act/scheduler.js` 1.3.0 and `act/make-registry.js` 1.1.1. Tests: `act/test/trigger-off.test.js` 1.1.0 (7 tests, every refusal on its own failure path), `act/test/scheduler.test.js` 1.1.0 ("FAIL-FIRST loaded ids (1.3.0): …") and `act/test/make-registry.test.js` 1.0.0, new ("FAIL-FIRST on-message trigger: …" and the *guard* "GUARD fail closed: …"). Six FAIL-FIRST tests fail on `v0.53.9`'s files: four in `act/test/trigger-off.test.js`, and one in each of the other two.

## 10 Nov: v0.54.1, the copyright line (rounds 1–3)

The third cold read's 13 (below): 36 kernel files carried a short copyright line that also named a company, beside the person that `LICENSE`, `NOTICE` and the SPDX lines name. In those lines the company name is removed: each names the author alone. No code changed and no file's version moved; every file's tokens are identical before and after. Ten of the files are action files, so `act/actions/registry.json` pins their new sha256 (11 entries: `file.js` serves two), and its approval time is kept.
- **Round 1:** the scope approved: the 36 lines, the 11 pins and one note at the top of `act/CHANGELOG.md`. A comment change in a pinned file is a data change: the suite, run on a candidate with the new lines and the old pins, failed, because the loader refused the changed action files.
- **Round 2:** the host machine's numbers, with the failure paths a release with no code change has: every token compared before and after, the release check failing on `v0.54.0`, and the loader refusing all 11 pinned entries under the old pins.
- **Round 3:** the promote. On live, with the old pins the loader refuses all 11 entries; with the new pins it loads all 11.
- No test changed: with no code change, no fail-first test can bite. The note at the top of `act/CHANGELOG.md` says what changed.

## 10 Nov: the cold read of v0.3.2

The whole `v0.3.2` tree went to a third fresh session, the same way and with the same brief as the first two. Its report is `docs/cold-read-v032.md`, word for word.

- **It ran:** `npm test` (374 of 374); `npm run test:check` (pass); `lab/lab-check.sh` (12 of 12); `tools/name-hashes.js` (3 of 3); the example; the mutation harness, all 144 rows identical to `lab/mutations/RUNS-0538_091126.tsv`; the five suite generators, every scenario regenerated byte for byte; the fingerprint; and its own trials of what the docs describe: `create()`'s refusals, the fetch kill switch, the worked example for a script, the trigger examples and the trigger kill switch.
- **It could not run:** the git checks (no clone), the byte-identity check (it needs the private SYNTHEKOS repository) and the real-model run (no model server).
- **Its 15 findings, and how they are settled:**
  - **The behavioural one, 1:** fixed in the kernel by SYNTHEKOS `v0.54.0` (above), which `v0.3.3` carries. In the same release: the on-message approval line (3) and the comment on the scheduler's state (5). SYNTHEKOS `v0.54.1` settled 13, the copyright line.
  - **The worked example, 2:** `examples/script-host.js`, new, which the release check runs. `docs/proteus-k.md` §7 shows its output and says what a script's own identity is and must hold; `docs/host.md` says what a trigger's `runsAs` must hold.
  - **Fixed in this repository's text and files:** 4 (the README's terms), 5 (`docs/host.md` names where "switched off" is kept, and that the off-files are consumed), 6 (what a long-running host adds), 7 (`.gitignore`), 8 (this page's count), 9 (the flow diagram's checks), 11, 12, 14 (the README says why no new mutation file was made) and 15 (the byte-identity check's first form names the repository it is for).
  - **Settled beside a file that cannot change:** 10, `act.js`'s header (line 51). `docs/host.md` says which handler a host uses, and Known gaps lists that comment for the next SYNTHEKOS release.

## Index: every bare tag in the kernel, by file

| File | Tag → review |
|---|---|
| `act.js` | 1.1.0's list of 7 → 28 Oct host adapter · H1 → R2 · R1 M2, R1 L4, re-review N2, third check C1/C2 → 5 Nov R1 · F04, F05, F09 → 5 Nov 2026 · round 1 → v0.53.2 |
| `act/core/bus.js` | F04, F05, F06 → 5 Nov 2026 · M3 → R2 · S4 → 30 Oct self-review |
| `act/core/targets.js` | round 2 → v0.53.2 |
| `act/core/registry.js` | C1/C2 → 5 Nov third check |
| `act/actions/fetch.js` | F09 → 5 Nov 2026 |
| `act/actions/file.js` | "adversarial review" → 28 Oct core, finding 4 |
| `act/mailbox.js` | M1, M2, M3, L2, L5 → R2 · L3 → 5 Nov R1 |
| `act/scheduler.js` | M3, L2 → R-S3 |
| `act/daemon/supervisor.js` | H1, L1 → R-S3 · round 1, round 2 → v0.53.3 |
| `act/mail/outbox.js` | M1, M2 → R-S3 |
| `act/proteus/engine.js` | S1, S3, S4, S5 → 30 Oct self-review · H2 → R-S3 |
| `act/proteus/eval.js` | S2, S2b, S4 → 30 Oct self-review · R1 → 2 Nov invariant tests · F-A, F-B, finding 1 → 2 Nov PROTEUS-K review · review F2, F3, F5, F6, F7 and round 3 → 3 Nov F-B rounds · U1, C1, C2 → R-fn |
| `act/test/core.test.js` | REVIEW 1–6, REVIEW hardening → 28 Oct core |
| `act/test/selfreview.test.js`, `eval.test.js` | S1–S6 → 30 Oct self-review |
| `act/test/invariants.test.js` | R1 → 2 Nov invariant tests |
| `act/test/size.test.js`, `size-collect.test.js` | F-A → 2 Nov PROTEUS-K review |
| `act/test/credentials*.test.js`, `collect.test.js`, `the.test.js`, `script.test.js` | F-B, finding 1 → 2 Nov · review 2, F2–F7, review 3, round 3, UNSAFE 2, focused review → 3 Nov F-B rounds |
| `act/test/review-s3.test.js` | H1, H2, M1, M2, M3, L1, L2 → R-S3 |
| `act/test/review-fn.test.js` | U1, C1, C2 → R-fn |
| `act/test/mailbox.test.js` | R2, R3 → 4 Nov mailbox reviews · "a blocker" → v0.53.2 round 1 |
| `act/test/p0.test.js` | F04, F05, F06 → 5 Nov 2026 |
| `act/test/daemon.test.js` | round 1, round 2 → v0.53.3 |
| `act/test/transient.test.js` | round 1 → v0.53.4 |
