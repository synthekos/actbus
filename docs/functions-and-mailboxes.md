<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# PROTEUS-K functions and standard library, and mailboxes

*This design record was written 4–5 Nov 2026 and has been edited for readers of this repository. Build notes, release tags, internal paths and meeting references are taken out. If this text and the code disagree, the code and its tests are right. The code is `act/proteus/` (functions, standard library), `act/mailbox.js`, and `act/actions/send.js` and `messages.js`.*

## 1. Why
Scripts needed two things:
- (a) reuse inside one script, without copy-paste;
- (b) a way to hand work to each other.

Three decisions were taken for (b):
- mailboxes with on-message triggers;
- both sides must allow a message;
- a message is removed only when the run that read it succeeds (at most 3 deliveries, then it is dead).

## 2. Functions and the standard library
**`(define (name arg …) body …)`**
- Allowed **at top level only**.
- A function may call only functions defined *above* it. There is no recursion and there are no cycles, so scripts stay total.
- There are **no closures**: a body sees only its arguments.
- At most 64 functions per script, and at most 8 arguments per function.
- A function that calls an action or remembers is *impure*, and cannot be used inside `collect`, `filter`, `count` and the other collection forms.
- The reach list includes the actions inside every function body, whether or not the function is called.
- Labels are exactly as if the body were written out in place.
- Fuel stops a doubling chain.

**The standard library, by label class (the literal rule):**
- **Selection keeps an item's credential:** `first`, `last`, `nth`, `take`, `drop`, `reverse`, `min`, `max`.
- **Parsing keeps it and adds `computed`:**
  - `parse-json`: exact decimals only, with exponents and inexact numbers refused; depth at most 32.
  - `number`.
- **Containers are data:** `append`, `record` (values are data, keys are control).
- **Everything else is computed:** `upper` `lower` `trim` `contains?` `starts-with?` `ends-with?` `split` `join` `replace` `range` `empty?` `has?` `keys` `abs` `round` (half away from zero, exact) `to-json` `number?` `text?` `list?` `record?` `nil?`.
- **`(now)`** is the time of the message that started the run, labelled `device`.

**Review (second-reader review R-fn, `reviews.md`).** Each finding was fixed with a test (`act/test/review-fn.test.js`):
- U1: a RangeError escaped without labels.
- C1: `parse-json` precision.
- C2: `constructor` was reachable from `Object.prototype`.

**Kept by design:** `(take x 0)` gives an empty list labelled `grounded`, because an empty selection asserts nothing.

## 3. Mailboxes
- **Where they live.** The core owns every mailbox, one folder per identity. Messages are written to a temp file and then renamed, inside a dot folder that no identity can own. Scripts never touch a mailbox file.
- **`send {to, topic, body}`** is a tentacle, but not a world action.
  - `to` is an identity name.
  - `topic` is a name.
  - `body` is text up to 16 KB. Use `to-json` and `parse-json` for structure.
- **`messages {topic}`** returns up to 20 `{id, from, topic, body, at}`, oldest first.
- **Both sides must allow.** The sender's `send` grant must name the recipient (in its targets, intersected along the chain), *and* the recipient's `messages` grant must name the sender. This is checked when the message is sent *and* again when it is read. Only the recipient's own grant can mark a message dead; a narrower caller in the chain simply doesn't see it.
- **Delivery.** A message read by a run is *claimed* for that run's trace. When the run ends:
  - success → the message is removed;
  - failure → it is delivered again;
  - after 3 failed runs → it is **dead**: kept for inspection, never delivered again.

  A claim that is not reported back within 10 minutes (a crash, say) counts as a failure. Dead messages are removed after 7 days, and at most 100 are kept per recipient. Every message has a unique id, and a script may see the same message twice.
- **Labels travel.** The message stores the warning labels the sender's input carried, and the conditions it ran under (web, model, person, device, computed). They are added to the reader's result. **A credential label (`grounded`) never passes between identities.**
- **No laundering.** An identity that can receive web or model text (through `fetch`, `model`, or `messages` itself) has those labels added to:
  - its world actions;
  - what it sends;
  - every call it makes to a script that declares input. (A script can keep what it is given with `remember` and write it out on a later run.)

  A script that reads messages and then calls a world action needs the administrator's `acceptWarnings`.

  **Not protected (stated):** two keys held by the same client. Labels cannot follow text from one key to the other. As a consequence, a key holder with `messages` needs `allowTainted` on any world action.
- **Limits:**
  - at most 100 messages waiting per recipient (a full mailbox refuses: back-pressure);
  - at most 60 sends per identity per hour (kept in memory, so a restart resets it; a brake, not a guarantee);
  - at most 20 messages per read.
- **Audit.** These lines are written:
  - `msg-sent`, written first: no line, no message;
  - `read` and `done`, both written first: fail closed;
  - `retry`, `dead`, `expired`;
  - `corrupt` (a damaged file is moved once to a quarantine folder);
  - `refused`.

  The mailbox lines, and the run lines of `send` and `email`, carry the body's sha256 and size, **never the body**. Other actions log their input as they always have, so a body passed on to `file-append` or `model` appears in *that* action's line.
- **On-message triggers.** A trigger `{ id, script, runsAs, on: "message", topic }` fires the script when its identity has messages waiting on that topic. There is no overlap, a cap per identity, and a kill switch. Because PROTEUS-K is total, an action cannot run inside `collect`. So a worker reads its batch and sends one reply.

## 4. Reviews
**R2, adversarial second-reader review: 2 high, 4 medium, 6 low.**

Fixed:

| Finding | What it was |
|---|---|
| H1 | Laundering through a message. |
| H2 | Bodies reached the log through the next action. Fixed by narrowing the rule, see §3 Audit. |
| M1 | Dead messages were unbounded, and every request scanned every mailbox. |
| M2 | A corrupt file was logged on every look. |
| M3 | A narrower caller killed the owner's messages. |
| M4 | Condition labels did not travel. |
| L2 | The read and done lines were not fail-closed. |
| L5 | Looking created folders. |

Accepted:

| Finding | What it is |
|---|---|
| L1 | An in-process timeout keeps running. Daemon mode, the default, kills it. |
| L3 | The reach list does not show `send :to`. The grant enforces it. |
| L4 | Two daemons can ping-pong at up to 60 per hour. |
| L6 | The cap of 100 can overshoot by one. |

**R3, focused re-review of the fixes:**
- **High:** a script that takes input and reaches `send` was not escalated. Fixed; reading messages now also counts for the warnings.
- **Medium:** a timed-out in-process run kept claiming after it had finished. Fixed: a finished trace cannot read.
- **Lows, fixed:**
  - a `null` record stopped mailbox work;
  - old dead messages expired at once;
  - an unmovable damaged file was logged on every look.
- **Accepted:** over-tainting of an identity holding `messages`, which errs in the safe direction.

**R4, narrow laundering check.** The one question was: can web or model text reach a world action through a message?
- 12 paths were blocked.
- 1 leak: a script with input that only *remembers* was not escalated, and a no-input script then wrote the kept text out. Fixed: every script with input is escalated.
- 1 by design: two keys held by one client (§3).
- Also fixed: a script reaching another script that runs as the same identity waited for itself until its time limit. That is now refused at load.

Not checked by R4:
- `file-read` with a tainted-allowed `file-append`;
- `strictControl` beyond two hops;
- concurrent claim races;
- `email` and `fetch` as sinks.

## 5. Acknowledged reads
A key holder calling `messages` over `POST /api/act` would otherwise lose a batch if the HTTP reply were lost, because a run counts as successful when the server answers. Delivery is therefore opt-in and acknowledged:
- `messages {topic, hold:true}` holds the messages until they are acknowledged with `ack:[ids]`. That is at most 100 ids matching `^g-[a-z0-9-]{1,40}$`, and they can piggy-back on the next call. If no acknowledgement arrives within 10 minutes, the messages are redelivered, and they are dead after 3 deliveries.
- Without `hold`, a message is removed on success, as before.
- `ack` removes only messages held *for that reader*. It never removes a message that was never delivered, and never one a script has claimed.
- **A person flag, `operatedByPerson`:**
  - that identity's own sends are labelled `person` and are not escalated;
  - it is refused together with `fetch`, `model`, `file-read`, or a script whose reply can carry web or model text.
- **A script counts as a source** for the no-laundering rule when either:
  - it reaches a web, model, messages or file-read action other than the one being called; or
  - it reads memory that may hold such text.
