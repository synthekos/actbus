<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# PROTEUS-K v0: specification

*This specification was written 30 Oct 2026 and has been edited for readers of this repository: the project's build notes, internal paths and meeting references are taken out. It describes v0. Functions, the standard library and the collection forms came later and are described in `functions-and-mailboxes.md` §2, which has a reference table of each collection form and library function, with an example of each. If this text and the code disagree, the code and its tests are right. The code is `act/proteus/` (reader, evaluator, engine, state).*

Three decisions shaped v0:
1. **Lisp syntax, not a general Lisp.** Every v0 script terminates. Extensions are allowed later only if registration can still list everything a script can reach.
2. **Taint rule (b), data-taint only** (§5).
3. **Scripts are written by administrators only.** Programs submitted by key holders are a later slice (§11) that has not been built.

## 1. What PROTEUS-K v0 is (and is not)
- **A script is an action.** It is a hash-pinned source file in the registry (kind `script`), called through the same bus, and checked, labelled and audited like `calc` or `fetch`. The interpreter is the sandbox: a script touches nothing but actions.
- **Total.** Every script finishes. There is no `eval`, no user macros, no `lambda`, no recursion and no `while`. The only loop is `for-each` over a list, and it is capped. Fuel (a count of evaluation steps) is a second guard.
- **Statically readable.** At registration the tree is walked, and the list of every action (and literal target) the script can reach is computed. `make-registry.js`, the approval, prints that list under the script's `✓` line (§7); at each call, the bus checks every action on it against the grants of the caller and of the script's identity. Script-to-script calls must form no cycle.
- **Not in v0:**
  - helper functions (added later, see `functions-and-mailboxes.md`);
  - routing to other nodes;
  - an authoring user interface;
  - running source that a client sends.

## 2. Reader (grammar)
```
form    := atom | '(' form* ')'
atom    := number | string | symbol | keyword | true | false | nil
number  := -?digits(.digits)?          → exact rational (act/core/rational.js); no floats, no exponent
string  := "…" with \" \\ \n \t only
symbol  := [a-z][a-z0-9-]*[?]?         (≤ 48 chars, same as action names + optional ?)
         | + - * / = < > <= >=          (the operators; '-' followed by a digit is a number; -x is an error)
keyword := :symbol                     (only as argument names in action calls)
comment := ; to end of line
```
**Limits.** Anything over a limit is refused at load, with its line and column:
- source ≤ 16 KB;
- nesting depth ≤ 64;
- ≤ 4 000 forms.

The reader also bounds a string literal at 64 K characters (`act/proteus/reader.js`), which a 16 KB source cannot reach. Strings a script builds while it runs are bounded at 65 536 characters (`LIMITS.STR`, `act/proteus/eval.js`).

Anything else that does not parse is a read error. Source is strict UTF-8, and non-ASCII is allowed only inside strings and comments.

**Canonical form.** This is the printed tree, with single spaces and no comments: `print` in `act/proteus/reader.js` gives it. The registry pins the sha256 of the *file bytes*, as it does for every action. The canonical form is only for display and diff, and `make-registry.js` does not show it: the administrator reviews the `.pk` file itself.

## 3. Values
The value types are:
- string;
- rational number;
- boolean;
- nil;
- list (≤ 1 000 items);
- record (an action's reply value: a JSON object, read with `get`).

Every value carries **data labels**, a subset of: person, device, computed, grounded, model, web.
- **Literals in the source:** labelled `person` (an administrator wrote them).
- **The script's input values:** labelled with the incoming envelope's labels.
- **Arithmetic, comparison, `str`, `get`, `len`:** the union of the operands' labels; arithmetic also adds `computed`.
- **An action call's result:** the reply's labels (the bus has already added the action's `produces` label).

## 4. Special forms and built-ins (the closed set)
| Form | Meaning |
|---|---|
| `(let ((a e1) (b e2)) body…)` | sequential binding (b may use a); value of the last body form |
| `(if c then else)` `(when c body…)` `(unless c body…)` | `nil` and `false` are false; everything else is true |
| `(and …)` `(or …)` `(not x)` | short-circuit |
| `(do body…)` | sequence; value of the last |
| `(= a b)` `(< a b)` `(> a b)` `(<= a b)` `(>= a b)` | numbers compared exactly (rational); `=` also on strings, booleans, nil |
| `(+ …)` `(- …)` `(* …)` `(/ a b)` | exact rationals, bounded at 8 192 bits; `/` by 0 is a script error |
| `(str …)` `(len x)` `(list …)` `(get rec "key")` `(number "1.3725")` | text join · length · list · field of a record · exact parse (an error if not a number) |
| `(input name)` | the script's input field `name` (declared in the registry entry's `input`, below) |
| `(for-each (x list) body…)` | ≤ 100 iterations (an error above that); value nil |
| `(remember key value)` `(remembered key)` | script state (§6); `remembered` of an unknown key is nil |
| `(fail "reason")` | stop the script with an error (audited) |
| `(name :arg e …)` | **action call**: `name` must be a registered action; the keyword arguments become the input object |

A symbol in call position that is not registered is a **load error**, not a surprise at run time. A failed action reply stops the script, with an error carrying the reply's code. v0 has no `try`.

## 5. Labels: rule (b), exactly
During evaluation there are two sets of labels:
- **data labels** on each value (§3);
- the **control set C**: the labels of every condition the current code runs under. That covers the conditions of `if`, `when`, `unless`, `and` and `or`, and the list a `for-each` iterates over.

The rules:
1. **A world action is refused if any of its input values carries `model` or `web`**, unless every identity in the chain has `allowTainted` for that action. This is the bus's own rule.
2. **C alone does not refuse.** A page can decide *whether* a fixed action fires, never *what* it writes or *where*.
   - Every child message records C in an envelope field, **`ctl`**, which is written to the audit line ("fired under web").
   - An identity whose grant says `"strictControl": true` for an action gets the stricter rule for it: C counts as taint.
3. **The value of a conditional carries its condition's labels as data.** For example, `(if c "A" "B")` is labelled with c's labels. Otherwise a script could copy web text into a file bit by bit, as "constants". The same applies to the values of `and` and `or`.
4. **State and the return value keep C.** `(remember k v)` stores v's labels ∪ C. The script's return value carries its data labels ∪ C. Outputs stay conservative; rule 2 only relaxes the decision to fire.
5. **Sticky control.** Once the script has computed a value with labels L, everything after it runs under L as well. The reason is that the script could have stopped there (with a `fail`, or an action refusing that value), so whether any later step happens depended on L.
   - Calls send C ∪ seen as `ctl`.
   - `remember` stores v ∪ C ∪ seen.
   - A script *called* under a web condition starts under that `ctl`.
   - A script's reply and errors carry everything it saw, including its state and input.

   Data labels are unchanged: a page still decides whether, never what.

**What rule (b) does not protect against:** a script *written* to transcribe, for example one fixed action per web character inside a `for-each`. That is the author's choice, and it is visible at approval. The static check raises a warning, which the administrator must accept, for any world action that is inside a condition or loop, or that comes after the script read model or web data, its state or its input (in evaluation order).

## 6. Script state
Each script identity has:
- at most 64 keys (symbols);
- each value at most 4 KB as JSON;
- the values stored *with their labels* in the script's own folder (written to a temp file, then renamed; one writer at a time per script).

Script state is visible only to that script. Every write is audited (`state-set`: the key, labels and size, but not the value). If the file is corrupt, the script refuses to run; there is no silent reset.

## 7. Registration (administrator only)
A registry entry (`registry.spec.json`, compiled by `make-registry.js`, sha256-pinned):
```
{ "name": "rate-watch", "version": "1.0.0", "kind": "script", "file": "rate-watch.pk", "produces": "computed",
  "world": false, "runsAs": "<the script's own identity>", "needs": [], "acceptWarnings": false,
  "input": {}, "timeoutMs": 300000 }
```
**`world` must be declared,** `true` or `false`. At load it is checked against what the script can reach, and a mismatch is refused (`act/core/registry.js`). `acceptWarnings: true` is the administrator's acceptance of the warnings (§5); without it, a script with a warning is refused. `make-registry.js` prints each warning it accepts, as an `accepted warning:` line under the script.
**`input`** maps each field the script reads with `(input name)` to its type: `string`, `number`, `integer`, `boolean`, `object` or `array`, ending in `?` when the field is optional. A field name must match `^[a-z][a-zA-Z0-9]{0,31}$`: a lower-case letter, then letters or digits, with no dash. So a script reads `(input oldRate)`, not `(input old-rate)`, although a symbol may contain dashes. A name that breaks the rule is refused at approval, with that rule in the message.
**At load,** the script is read, then statically walked. The walk checks:
- (a) every called name is registered;
- (b) there is no cycle through script-to-script calls;
- (c) the list of reachable actions and literal targets;
- (d) the warnings (§5).

Any failure means that script is refused at start, as an action file would be. **`runsAs` is allowed for `kind: script` only.** A native action may not run as another identity.

**A worked example.** An administrator copies `act/actions/` to a folder of the host's own, writes the entry into that copy's `registry.spec.json`, puts the `.pk` file next to it, runs `node act/make-registry.js <that folder>`, and passes the folder to `create()` as `actionsDir` (`docs/host.md`). `make-registry.js` checks every entry as the loader will, pins every file's sha256 into `registry.json`, and running it is the approval. If it refuses an entry, it writes no `registry.json` (`docs/host.md`, "The approval"). Doing this in `act/actions/` itself would change kernel files: `registry.json` is rewritten, with a new approval time. `examples/script-host.js` does all of this, end to end, with a one-line script, `answer.pk`, that calls `calc`. Its first line is the `✓ answer` line of `make-registry.js`'s output, and under it the tool prints `    reach: calc`. Run it from the repository root with `node examples/script-host.js`; it works in a new temp folder. It has three records: the person `alex`, who owns both EUsers; `caller`, the EUser that calls the script; and `helper`, the EUser the script runs as (`"runsAs": "u-00000000-0000-4000-8000-000000000003"`). A script's own identity is an EUser record like any other: owned by a person, with grants of its own. The grant JSON of each call is `{ "owner": "alex", "actions": { … } }`, with the actions its line names. It prints one line per call (each call's id and trace are shown here as `…`, and the temp folder is shortened):
```
approved: ✓ answer 1.0.0 answer.pk 11cb86ab7a73
caller holds answer, calc · helper holds calc → HTTP 403 {"ok":false,"id":"…","trace":"…","action":"answer","code":"NOT_PERMITTED","error":"not permitted: u-00000000-0000-4000-8000-000000000003 may not run answer"}
caller holds answer, calc · helper holds answer, calc → HTTP 200 {"ok":true,"id":"…","trace":"…","action":"answer","basis":"computed","labels":["device","person","computed"],"value":{"result":"42","exact":true,"fraction":"42"},"sha256":"11cb86ab7a73"}
caller holds calc · helper holds answer, calc → HTTP 403 {"ok":false,"id":"…","trace":"…","action":"answer","code":"NOT_PERMITTED","error":"not permitted: u-00000000-0000-4000-8000-000000000002 may not run answer"}
caller holds answer · helper holds answer, calc → HTTP 422 {"ok":false,"id":"…","trace":"…","action":"answer","code":"ACTION_ERROR","error":"ACTION: calc did not run: NOT_PERMITTED not permitted: u-00000000-0000-4000-8000-000000000002 may not run calc (line 1:1)","labels":["device","person","computed"]}
caller holds answer, calc · helper holds answer → HTTP 422 {"ok":false,"id":"…","trace":"…","action":"answer","code":"ACTION_ERROR","error":"ACTION: calc did not run: NOT_PERMITTED not permitted: u-00000000-0000-4000-8000-000000000003 may not run calc (line 1:1)","labels":["device","person","computed"]}
audit log: <temp folder>/actbus-script-…/app/logs/act.jsonl
```
The first call is refused because `helper`, the script's own identity, does not hold `answer`: the script runs as `helper`, so `helper` must be granted the script too. The second call runs. The last three show that each of the other grants is needed: without `answer`, the caller is refused (403); without `calc`, for either EUser, the script runs and its `calc` is refused (422). The lab's scenarios carry more scripts, each run as the EUser that calls it (`runScenario` in `lab/lab.js`).

## 8. How the core carries scripts
1. **Labels per child.** For a script, the interpreter gives each child message the labels of its own input values (plus the envelope's labels), and `ctl` = C. Native actions keep the conservative rule: every child gets every label the action has received. In both cases the script's own reply accumulates everything.
2. **The envelope** checks and carries the optional `ctl`, and the audit writes it.
3. **The registry** has kind `script`; its source file is read by the reader, not `require`d.
4. **Capabilities** have the grant flag `strictControl`.
5. **Escalation at the edge.** A key holder that can receive web or model text has those labels added to its other world calls. For a call to a script, this applies **whenever the script declares any input field**, because a boolean or a number can carry page data too, a bit at a time. A script with no input is not escalated. Every script call still needs:
   - the script granted to the caller by an administrator;
   - the script granted to its own identity too, since it runs as that identity;
   - every action the script reaches granted both to the caller and to the script's own identity.

   `examples/script-host.js` shows each of the four refused without it (§7).

## 9. Tests (each must fail on a deliberately broken interpreter)
- **Reader:** every grammar edge; the limits (16 KB, depth 64, 100 iterations, 1 000 items, fuel); errors carry line and column.
- **Totality:** no construct runs past its fuel. A script that calls itself, directly or through another script, is refused at *load*.
- **Labels** (the core of the review). Each case and its expected result:
  - web → `str` → file-append: **refused**;
  - web → an `if` value → file-append: **refused**;
  - web → `get` → `number` → `+` → file-append: **refused**;
  - `(when (< web-rate old) (file-append :name "x" :text "hello"))`: **runs**, with `ctl:[web]` in the audit;
  - the same with `strictControl`: **refused**;
  - `remember` under C, then the value used as data: **refused**;
  - `for-each` over a web list: the body runs under C.
- **State:**
  - scripts are isolated from each other;
  - a corrupt file refuses;
  - labels survive a round trip.
- **Chain:**
  - a caller without the script action gets 403;
  - a script reaching an action its caller lacks is refused;
  - run-as on a native action is still refused.
- **Acceptance test 2** (the rate watch) runs end to end against a fake page, using a deterministic native `read-number` action.
- **An adversarial second-reader review** of §5 and §8, by a separate AI session given the rules and the tree (`reviews.md`, 2 Nov).

## 10. (Removed: delivery notes.)

## 11. Later slice: programs submitted by clients (designed, not built)
In v0, a key holder can *call* a registered script but can never *send* source, and no program reaches the core (bus, registry, grants). Programs reach only actions, and no action changes grants or the registry. The later slice opens a safe door:
1. **`proteus-submit`** (an action): the client sends source. It is *not* run. It is read, statically walked and stored as a proposal.
2. **Reach check at submit:** anything the program can reach outside the *sender's* own grants is refused, with the reason.
3. **An administrator approves it.** It is then hash-pinned and registered, and it runs *as* the sender, with **`strictControl` forced** for every world action. The reason: under rule (b), a submitted program would have more power than its sender calling from outside. Scripts installed by an administrator keep rule (b).
4. **Later, and only after a review:** automatic approval for programs that reach no world action (pure computation and reads).

Capability intersection guarantees that a submitted program never exceeds its sender.

## 12. Open when this was written, settled since
- `timeoutMs` for scripts: settled at 300 s, because a model call alone may take 120 s: that is the `model` action's `timeoutMs` in `act/actions/registry.spec.json`, and its request to the model server is aborted at 115 s (`act.js`:162). 300 s is the registry's default for a script (`act/core/registry.js`).
- The file extension: settled as `.pk`. The registry refuses a script file with any other (`act/core/registry.js`).

## 13. Self-review record (not independent)
| Finding | Severity | What happened |
|---|---|---|
| S1 | High | Web text kept in a script's state was returned to another script and written to a file without a label. |
| S2 / S2b | High | `strictControl` was bypassed by making the script stop early (with `fail`, or an action error on page data) before an unconditional write. |
| S3 | Medium | The warning missed that abort-steering. |
| S4 | Medium | A called script remembered without its caller's control. |
| S5 | — | An error quoting remembered web text came back without a label. |
| S6 | — | A guard. |

Each was fixed with a test that fails on the code before the fix (`act/test/selfreview.test.js`).

**Lesson:** the labels of a value must follow it through *every* exit (reply, error, state), and control is not only lexical: stopping early is a branch.
