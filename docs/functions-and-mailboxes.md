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

### Reference: the collection forms and the library
Each example below was run through the kernel, one script per example called through `act.route`, and shows the script's reply value. A reply writes a number as decimal text (`"14"`). From the repository root, `node tools/pk-run.js . '(+ 1 2)'` prints `(+ 1 2)  →  "3"`; it takes any number of expressions. A script error answers 422 `ACTION_ERROR`, and its text begins with the script's own code: `RUN` for a wrong kind of argument, which names the form.

**The collection forms** (`act/proteus/eval.js`:45) are written `(form (name list) one-form)`. Each binds `name` to every item of the list in turn (at most 1 000 items) and evaluates its one form for each item. The one form may not call an action or `remember`: the approval refuses it (`no action call inside (filter …): calc — its one form must only compute`). The result carries the list's labels and the labels of every value the form gave. `count` and `sum` also add `computed`.

| Form | Its one form gives | The result | Example → reply value |
|---|---|---|---|
| `filter` | true or false | the items it is true for, in order | `(filter (x (list 3 8 1 9)) (> x 2))` → `["3","8","9"]` |
| `collect` | any value | the list of the values | `(collect (x (list 1 2 3)) (* x 10))` → `["10","20","30"]` |
| `count` | true or false | how many items it is true for | `(count (x (list 3 8 1 9)) (> x 2))` → `"3"` |
| `sum` | a number | their sum; text is a script error | `(sum (x (list 1 2 3)) (* x x))` → `"14"` |
| `max-by`, `min-by` | numbers, or text | the item with the largest (smallest) value, the first on a tie; nil for an empty list | `(max-by (x (list "ab" "abcd" "abc")) (len x))` → `"abcd"` |
| `sort-by` | numbers, or text | the items in ascending order of the value, equal values in the list's order | `(sort-by (x (list 3 1 2)) x)` → `["1","2","3"]` |
| `the` | true or false | the one item it is true for | `(the (x (list 3 8 1)) (> x 5))` → `"8"` |

With no match, `the` stops the script with code `FAIL`: `(the (x (list 3 8 1)) (> x 9))` answers `FAIL: not in the documents: (the …) matched no item`. With two or more, it stops with code `AMBIGUOUS` and chooses none: `(the (x (list 3 8 1)) (> x 2))` answers `AMBIGUOUS: (the …) matched 2 items: the possibilities are returned, none is chosen`. The reply carries that text, not the items. `max-by`, `min-by` and `sort-by` refuse a number and text in one list: `(sort-by (x (list 1 "a")) x)` answers `RUN: (sort-by …) cannot compare a number with text`.

**The library.** Arguments are evaluated first. "A whole number" is 0 to 1 000 here, except where its row says otherwise.

| Function | Arguments | The result | Example → reply value |
|---|---|---|---|
| `upper`, `lower`, `trim` | text | the text in upper case, in lower case, or without leading and trailing space | `(trim "  a b  ")` → `"a b"` |
| `contains?`, `starts-with?`, `ends-with?` | text, text | whether the first contains, starts with or ends with the second | `(contains? "rate 1.37" "1.3")` → `true` |
| `split` | text, a separator | the list of parts; the separator `""` splits into characters | `(split "a,b,c" ",")` → `["a","b","c"]` |
| `join` | a list of text and numbers, a separator | one text | `(join (list "a" "b" 3) "-")` → `"a-b-3"` |
| `replace` | text, what to find (not empty), what to put | the text with every occurrence replaced | `(replace "a.b.c" "." "/")` → `"a/b/c"` |
| `first`, `last` | a list | its first or last item; nil for an empty list | `(first (list))` → `null` |
| `nth` | a list, a whole number | the item at that place, counting from 0; nil past the end | `(nth (list "a" "b" "c") 1)` → `"b"` |
| `take`, `drop` | a list, a whole number | its first n items, or the items after them | `(drop (list 1 2 3) 2)` → `["3"]` |
| `reverse` | a list | its items in reverse order | `(reverse (list 1 2 3))` → `["3","2","1"]` |
| `append` | lists | one list of all their items (at most 1 000) | `(append (list 1) (list 2 3))` → `["1","2","3"]` |
| `range` | n; or a and b, each 0 to 1 000 000, b − a at most 1 000 | 0 to n − 1; or a to b − 1 | `(range 2 5)` → `["2","3","4"]` |
| `empty?` | text, a list or nil | whether it is empty; nil is | `(empty? nil)` → `true` |
| `has?` | a record, a key | whether the record has that key | `(has? (record "a" 1) "a")` → `true` |
| `keys` | a record | the list of its keys | `(keys (record "a" 1 "b" 2))` → `["a","b"]` |
| `record` | key, value, key, value … (keys are text, each once) | a record; the keys `__proto__`, `constructor` and `prototype` are refused | `(record "a" 1 "b" "x")` → `{"a":"1","b":"x"}` |
| `min`, `max` | numbers | the smallest or largest, the first on a tie | `(max 3 1 2)` → `"3"` |
| `abs` | a number | its absolute value | `(abs -2.5)` → `"2.5"` |
| `round` | a number, and places (0 to 30, default 0) | the number rounded half away from zero, exactly | `(round -2.5)` → `"-3"` |
| `parse-json` | text | the JSON value; a number with an exponent, or one that cannot be read exactly, is refused; depth at most 32, the outer value at depth 0 | `(get (parse-json "{\"a\": 7}") "a")` → `"7"` |
| `to-json` | any value | its JSON text; a number is written as text | `(to-json (list 1 "a" nil))` → `"[\"1\",\"a\",null]"` |
| `number?`, `text?`, `list?`, `record?`, `nil?` | any value | whether it is of that kind | `(nil? nil)` → `true` |
| `now` | none | the time of the message that started the run, as text, labelled `device` | `(text? (now))` → `true` |

`(parse-json "1e3")` answers `RUN: (parse-json …) got a number with an exponent (1e3): not read`. A record read by `parse-json` keeps JSON's numbers inside it; `get` reads one as a number.

**Review (second-reader review R-fn, `reviews.md`).** Each finding was fixed with a test (`act/test/review-fn.test.js`):
- U1: a RangeError escaped without labels.
- C1: `parse-json` precision.
- C2: `constructor` was reachable from `Object.prototype`.

**Kept by design:** `(take x 0)` gives an empty list labelled `grounded`, because an empty selection asserts nothing.

## 3. Mailboxes
- **Where they live.** The core owns every mailbox, one folder per identity. Messages are written to a temp file and then renamed, inside a dot folder that no identity can own. Scripts never touch a mailbox file.
- **`send {to, topic, body}`** is a tentacle, but not a world action.
  - `to` is an identity name.
  - `topic` is a name: `a-z`, `0-9` and `-`, starting with a letter, at most 48 characters (`act/mailbox.js`). Any other answers 422 `ACTION_ERROR`, `a topic is a name (a-z, 0-9, -)`, for `send` and for `messages`.
  - `body` is text up to 16 KB. Use `to-json` and `parse-json` for structure.
- **`messages {topic}`** returns up to 20 `{id, from, topic, body, at, labels}`, oldest first. `labels` are the labels the message carries ("Labels travel", below): a message from an EUser carries at least `device`.
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
- **On-message triggers.** A trigger `{ id, script, runsAs, on: "message", topic }` fires the script when its identity has messages waiting on that topic. There is no overlap, a cap per identity, and a kill switch. Because collection forms take only pure functions (§2), an action cannot run inside `collect`. So a worker reads its batch and sends one reply.

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
