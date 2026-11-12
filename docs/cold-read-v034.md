# Cold read of ACTBUS v0.3.4

This is a first outside read of the folder as given: the `v0.3.4` tree, with no `.git`, read with nothing from outside it. I checked every claim below against the code, or against a command I ran on a copy in a scratch folder. This file is the only change I made to the folder. I took a checksum of every file before I started and again at the end, and they match.

**Summary.** Everything the README says to run that can run here worked, and printed what the README says it prints. That covers the tests, the test check, the lab, the sums file, the fingerprint, the name hashes, all three examples, the mutation harness (all 144 rows identical), every PROTEUS-K example in the reference tables, and the trigger example with its kill switch. The findings below are about the text: one gap in a security claim, one trust consequence the host contract leaves out, a side effect of the lab generators that nothing documents, and some contradictions and smaller inaccuracies.

## Findings

1. **README.md:9** (also `docs/kernel-flow.svg:35`) · **missing** · "the id has not been seen before, kept on disk for 24 h;"
   - **Why it fails a stranger:** the bus keeps at most 50 000 ids per identity (`act/core/bus.js:53`, `dedupeCap = 50000`). When an identity passes that number, its oldest ids are dropped (`bus.js:126`, `:132`), even if they are less than 24 h old. With the highest rate a grant allows (10 000 a minute, `docs/host.md:42`), the cap fills in 5 minutes. At the default 120 a minute it fills in about 7 hours. After that, an id the reader believes is protected for 24 h can be replayed. The threat model's "replay: durable dedupe" (README.md:203) has the same gap.
   - **What the reader needs:** "remembered for 24 h, or for the identity's last 50 000 ids if that comes first", in the check list, in the threat model and in the diagram.

2. **docs/host.md:43** (with `docs/functions-and-mailboxes.md:179` and README.md:207–210) · **missing** · "Refused together with an action that brings web or model text into the EUser itself, such as `fetch`, `model` or `file-read`"
   - **Why it fails a stranger:** `messages` is a source of web and model text (`functions-and-mailboxes.md:104`), but the person flag does not refuse it. I saved `{ "operatedByPerson": true, "actions": { "messages": … } }` through `saveGrants` and it was accepted. That is on purpose (`act.js:9–10`, and `relayRisk` at `act.js:306` drops `messages`): a person-operated EUser can read web-labelled messages, and what it then `send`s is labelled `person` and is not escalated. This is a trust decision with a security effect. Only the `act.js` header states it. The host contract, the mailbox page (whose refusal list also leaves out `messages`) and the threat model's "What it trusts" all leave it out.
   - **What the reader needs:** one sentence in `docs/host.md` and in the threat model saying that `messages` stays allowed, and that the administrator's `operatedByPerson` claim is trusted to vouch for whatever that EUser sends after reading web text.

3. **README.md:45 and :151** (with `lab/SEALS.md:20`, `:31`) · **missing** · "`lab/` | the attack lab: sealed scenarios, the runner, the mutation harness"
   - **Why it fails a stranger:** the five scenario generators, `lab/gen-suite*.py`, appear in no README or `lab/` guide. Only `SEALS.md` mentions them, and only as history. Running one, as `SEALS.md` describes regenerating, changes the tree:
     - it moves the sealed suite to `lab/suites/_superseded/<suite>-<time>/`, which `.gitignore` does not cover;
     - it writes the scenarios back without `SEALED.json`.

     I ran all five on a copy. The scenarios came back byte-identical, but every `node lab.js run` on those suites then failed, so `lab/lab-check.sh` would fail too until someone runs `node lab.js seal`. The `selftest` suite has no generator. All of this contradicts "no other file in the repository is changed" for a reader who goes on from the lab to its generators.
   - **What the reader needs:** a line naming the generators and the `seal` step, saying that a generator unseals the suite and leaves `_superseded/` behind, and saying where the `selftest` scenarios come from.

4. **README.md:242** · **false** (or unclear) · "The lab numbers above were measured on a different machine, on the same bytes"
   - **Why it fails a stranger:** README.md:157–160 says four of the five measurements were made "on SYNTHEKOS's host machine". This sentence, under "Some gates run only on SYNTHEKOS's host machine", says the opposite: that the numbers come from a different machine. A reader cannot tell which machine produced which numbers. Only the first measurement (`v0.53.7-cleanup`, Node 22.23.4) gives no machine.
   - **What the reader needs:** for each measurement, which machine made it, or the sentence narrowed to the 9 Nov `v0.53.7-cleanup` run.

5. **README.md:162** · **unclear** · "Every line except injection's is identical to the first measurement, on 7 Nov at SYNTHEKOS `v0.53.5-headers`"
   - **Why it fails a stranger:** the list just above starts on 9 Nov, so to the reader "the first measurement" is that 9 Nov run. This sentence brings in an earlier, unlisted 7 Nov measurement.
   - **What the reader needs:** the 7 Nov run as the first item of the list, or wording like "the lab's first measurement ever, on 7 Nov, not listed above".

6. **README.md:186** · **unclear** · "reproduced again by the cold read (below)"
   - **Why it fails a stranger:** "below" describes four cold reads, not one, and `docs/reviews.md:281`, `:302`, `:332` and `:353` say each of them reproduced the 144 rows. "The cold read" reads as if only one did.
   - **What the reader needs:** "by each of the four cold reads".

7. **docs/proteus-k.md:123** · **unclear** · "Its first line is the `✓ answer` line of `make-registry.js`'s output, and under it the tool prints `    reach: calc`."
   - **Why it fails a stranger:** this sits in a passage describing what `examples/script-host.js` prints. The example keeps only the `✓ answer` line (`examples/script-host.js:35`), and the output shown below it has no `reach:` line. A reader who runs the example looking for the reach line will not find it. Only running `make-registry.js` directly shows it, which I did in my trigger trial.
   - **What the reader needs:** "the example keeps only the ✓ line; run `node act/make-registry.js <folder>` to see the `reach:` line under it".

8. **docs/capability-architecture.md:30** · **unclear** · "It turns language into a *proposed* script, and a person approves it before it is registered."
   - **Why it fails a stranger:** it reads as a feature, but the repository contains no step that turns language into a script. Client-submitted programs are "designed, not built" (`docs/proteus-k.md` §11). Other sections of this page mark what was not built. This sentence does not.
   - **What the reader needs:** "(designed, not built)", or a pointer to whatever does this, if it is in SYNTHEKOS.

9. **docs/capability-architecture.md:35** · **false** (superseded) · "**Every run is audited:** who, the action and its hash, the input, the outcome…"
   - **Why it fails a stranger:** for `send` and `email`, the run line records the body's sha256 and size instead of the input (`act/core/bus.js:33–35`; `docs/functions-and-mailboxes.md:123`). In the audit lines of my lab run, `email`'s `input` held `to`, `subject`, `textBytes` and `textSha256`, not the text.
   - **What the reader needs:** "the input (for `send` and `email`, the body's sha256 and size only)". The reverse also deserves one sentence: every other action's input, including model prompts and `file-append` text, is written to the audit log in full.

10. **docs/host.md:87–101** · **missing** · "| `calc` | `expr` | computed | no | — |"
    - **Why it fails a stranger:** the table names the input fields but never says what values they accept. That information exists only in the actions' file headers, and nothing points there. The formats in those headers are:
      - `calc`: `+ - * / ^`, parentheses and decimals; `^` is right-associative;
      - `units`: the supported dimensions, with `value` given as a string;
      - `date-diff`: strict `YYYY-MM-DD`;
      - `read-number`: what `after` selects;
      - plus the shape of each reply, and the rules for a file name.

      A host writing its first request has to read the action source to learn them.
    - **What the reader needs:** a line per action on the accepted formats and the reply, or a pointer to the headers in `act/actions/*.js`.

11. **README.md:100** (and `docs/host.md:52`) · **missing** · "`act.route(req, res)` is an Express-style handler."
    - **Why it fails a stranger:** the file a host is most likely to compare with, `act/core/edge.js:10`, says it "works as a plain node:http handler… reads the body itself". `route` does neither. It never reads the body, so `req.body` must already be parsed. It answers only through `res.status(n).json(body)`, plus `res.set('Retry-After', …)` when `set` exists (`act.js:329`, `:350–351`). A plain `node:http` response has no `status()`, so `route` throws inside its promise. The examples' hand-made `reply()` shows those three methods, but nothing says they are the contract.
    - **What the reader needs:** "`req.body` must already be parsed JSON. `res` needs `status()` and `json()`, and `set()` if you want `Retry-After`. Wrap the response for plain `node:http`."

12. **README.md:121** · **false** (minor) · "Every refusal writes nothing and exits 2"
    - **Why it fails a stranger:** `node act/trigger-off.js` with no id prints its usage and exits **1**, and so does `node act/make-registry.js` with no folder. A script that checks for exit 2 to mean "refused" misreads a missing argument.
    - **What the reader needs:** "a usage error exits 1; every refusal of an id or folder exits 2".

13. **README.md:76** · **false** (minor) · "`lab/lab-check.sh` reads that line and prints only `ok` lines"
    - **Why it fails a stranger:** it also prints `FAIL` lines with want and got, `STOP` lines, and a closing `LAB PASS — 12/12 …` or `LAB FAIL …` line (`lab/lab-check.sh:18–22`). The sentence means it does not echo the ENV line, but it says something else.
    - **What the reader needs:** "it does not print the ENV line; it prints one `ok` or `FAIL` line per suite run and a final `LAB PASS` or `LAB FAIL`".

14. **docs/kernel-flow.svg:54** · **unclear** · "Native actions"
    - **Why it fails a stranger:** the box under this heading holds `fetch`, `email`, `file-append`, `file-read`, `send` and `messages`. The registry gives those the kind `tentacle`, not `native` (`act/actions/registry.spec.json`), and `model` has its own kind. `docs/capability-architecture.md:21–26` and `docs/host.md:192` treat native and tentacle as different kinds, so the diagram's heading contradicts them.
    - **What the reader needs:** a heading such as "Built-in actions (native · tentacle · model)".

## What I read, what I skipped, what I ran

**Read in full:** `README.md`, `package.json`, `.gitignore`, `NOTICE`, `docs/host.md`, `docs/proteus-k.md`, `docs/functions-and-mailboxes.md`, `docs/capability-architecture.md`, `lab/SEALS.md`, `lab/TIER2-RESULTS_091126.md`, `lab/EXPECTED-RESULTS.txt`, `lab/KERNEL-VERSION.txt`, `lab/lab-check.sh`, `lab/mutations/README.md`, `lab/mutations/mutrun.sh`, `lab/mutations/RESULTS-0537-cleanup-words.md`, `tools/kernel-test-check.sh`, the three examples, and the text of `docs/kernel-flow.svg`.

**Read in part:**
- `docs/reviews.md`: the opening section, the 28 Oct and 30 Oct reviews, everything from 9 Nov on, and the index.
- `docs/cold-read-v033.md`: its finding list only, so as not to repeat it.
- `act/CHANGELOG.md`: the notes at the top, the `act.js` section and every heading.
- `act.js`: lines 1–14, `create()`, `route()`, `taintSources`/`relayRisk`, the scheduler wiring and the exports.
- `act/core/bus.js`: the order of the checks, the dedupe code, the `ctx` passed to an action, and the audit of `send` and `email`.
- The headers of `act/core/edge.js`, `act/core/registry.js`, `act/shutdown.js`, `act/daemon/supervisor.js` (and its permission flags), `act/actions/*.js`, `tools/pk-run.js`, `tools/check-byte-identity.sh` and the five `lab/gen-suite*.py`.
- `lab/lab.js`, around its fingerprint code (lines 150–162).
- `act/test/temperature.test.js`, its first 40 lines.

**Skipped:**
- The other three cold-read reports (`docs/cold-read-v030.md`, `-v031.md`, `-v032.md`), except one search of `-v032.md` for the copyright finding.
- Most of `docs/reviews.md` from 2 Nov to 9 Nov.
- The bodies of the kernel modules not named above (`act/proteus/*`, `act/mailbox.js`, `act/scheduler.js`, `act/mail/*`, `act/daemon/pkd.js`, `act/core/*` apart from bus, edge and registry).
- The test files, apart from the parts named above.
- The scenario JSON, which I checked only by regenerating it.
- The mutation `RESULTS-*.md` and `RUNS-*.tsv` files, apart from the two I compared.
- `mutate.py`, `LICENSE` and `SEALED-LIST_061126.md`.

**Ran:** everything below ran on copies in my scratch folder, on macOS with Node v26.7.0 and Python 3.10.11.

| Command or trial | Result |
|---|---|
| `npm test` | 391 of 391 passed, 0 skipped reported, about 7 s |
| `npm run test:check` | `full run: 392 tests, 1 failed · skipping run: 391 tests, 391 passed`, then `KERNEL TESTS PASS` |
| `bash lab/lab-check.sh` | `LAB PASS — 12/12`, about 13 s; it wrote only under `lab/results/` |
| `node lab.js run suites/edges 1` (from `lab/`) | ENV line showed fingerprint `897cab7d03ee (= the recorded copy of live 0.54.2)`; the ENV line does name the host, as the README warns |
| `shasum -a 256 -c lab/KERNEL-SHA256SUMS` | 36 of 36 OK. The 36 match exactly the files the README's fingerprint definition picks out |
| The README's awk/sort/perl fingerprint pipeline | `897cab7d03ee…` |
| `node tools/name-hashes.js` | `NAME-HASHES PASS — 3 of 3` |
| `node examples/minimal-host.js`, `script-host.js`, `native-host.js` | each printed the documented lines, apart from ids, traces and temp paths |
| `bash lab/mutations/mutrun.sh <abs path> LIVE M1 … M15` | 2 min 20 s. All 144 rows identical to `RUNS-0538_091126.tsv` from line 2 on; line 1 names kernel `0.54.2`. Caught: 13 of 15 (not M1 or M13), matching the README's per-mutant notes |
| `node tools/pk-run.js .` with every example from `docs/functions-and-mailboxes.md` §2 | every documented reply value and error text matched; the errors also end with a `(line l:c)` suffix |
| An impure `filter` example through `pk-run.js` | `NOT APPROVED`, which refused the whole batch, as its header says |
| The five `lab/gen-suite*.py`, with `python3 -I`, on a separate copy | see finding 3 |
| `create()` refusals | `ollamaUrl`, an unknown option name (cleaned as described), `models` without or with a blank `modelUrl`, and bad `productName` values: all refused with the documented messages |
| `route` trials | an unknown label gives 400; `web` on `calc` runs and carries the label; `web` on `file-append` gives 403 `TAINTED`; a repeated `id` gives 409; an unknown action gives 404 |
| `saveGrants` trials | refused: targets on `calc`, an unknown owner, an upper-case fetch host, an email target not on `MAIL_ALLOW`, `operatedByPerson` with `fetch`. Accepted: `operatedByPerson` with `messages` (finding 2) |
| The fetch kill switch | `.web-egress-disabled` stopped `fetch` (422, nothing fetched) |
| `email` trials | an EUser that also holds `fetch` had its email escalated to 403 `TAINTED`. With `email` alone and no mail settings, it answered 200 `queued` |
| The `docs/host.md` triggers example | approved by `make-registry.js` with three ✓ lines. I booted a kernel on it, then ran `act/trigger-off.js` with a typo (exit 2, lists the loaded ids), a real id (✓, exit 0), a relative `--app-dir` (works), no id (usage, exit 1) and no `--app-dir` (exit 2, act-files missing) |

**Could not run:**
- Any git check (README.md:59–64): the folder has no `.git`.
- `tools/check-byte-identity.sh`: it needs the private SYNTHEKOS repository.
- The real-model run (`lab/TIER2-RESULTS_091126.md`): there is no model server here.
- Node 22, so "≥ 22.1, tested on Node 22" stays unchecked by me.
- Real SMTP delivery.
