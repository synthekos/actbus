# Cold read: ACTBUS v0.3.2

A first outside reader's report on this folder, the repository at tag v0.3.2. I used only what is in the folder: no web lookups, nothing about the project or its author. Everything that could write ran on a copy in my scratch directory. I checked the folder by sha256 of every file before and after, and the only change is this file.

**Bottom line.** Every command the README gives that can run here works, and its output matches what the README says. That covers `npm test`, `npm run test:check`, `lab/lab-check.sh`, `node tools/name-hashes.js`, `node examples/minimal-host.js`, the `shasum -c` check, the fingerprint recipe and the mutation harness (all 144 rows identical). The problems show up when a stranger goes past the example and follows the docs to build something of their own:
- The trigger kill switch prints ✓ for a trigger that does not exist.
- The worked example for registering a script leaves out a grant, so following it gives a 403.
- The trigger example in `docs/host.md` makes `make-registry.js` print `at undefined undefined`.

Most of the rest is small: inconsistent names, counts and comments.

Findings are ordered roughly by how badly they mislead or block a stranger.

---

## Findings

1. **docs/host.md:133** (with act/trigger-off.js:29, act.js:373)
   - Category: **false**
   - Exact text: "`node act/trigger-off.js <id> --app-dir <appDir>` writes `<appDir>/act-files/.scheduler/off/<id>`, and the running kernel switches that trigger off within 15 s and audits it."
   - Why it fails a stranger: `trigger-off.js` never checks that the id is a real trigger. `node act/trigger-off.js nosuchtrigger --app-dir <app>` printed `✓ nosuchtrigger: wrote … switches it off within 15 s` and exited 0. The running kernel then wrote `trigger-off-unknown` to the audit log, and nothing was switched off. An operator who mistypes the id under pressure gets a ✓ and the real trigger keeps firing. The test file's own first line promises the script "never reports a switch-off it did not make". With no `triggers.json`, a typo'd file also stays in the folder and would switch off a trigger added later under that name.
   - What that reader would need: either the script checks the id against `<actionsDir>/triggers.json`, or host.md says plainly that the ✓ means "file written", not "trigger off", and that the proof is a `trigger-switched-off` line (not `trigger-off-unknown`) in the audit log.

2. **docs/proteus-k.md:122** (the worked example, with :110 and :129–131; docs/host.md:126)
   - Category: **unfollowable**
   - Exact text: "Every script call still needs: the script granted to the caller …; every action the script reaches granted both to the caller and to the script's own identity."
   - Why it fails a stranger: I followed the worked example on a copy. I wrote a one-line `.pk` that calls `calc`, added it to a copied `registry.spec.json` with `runsAs` set to a second EUser, ran `make-registry.js` and passed the folder as `actionsDir`. I granted the caller `answer` and `calc`, and the script's identity `calc`, as the text says. The call was refused: `403 NOT_PERMITTED … u-…0003 may not run answer`. The script's own identity must also hold the script itself, and no doc says so. The docs also never say what "the script's own identity" is in a host. It has to be an EUser record (`u-<uniqueId>`, owned by a person, with its own grants), and in the lab it is the same EUser as the caller. Triggers have the same gap: host.md:126 says `runsAs` is "an EUser's identity name", but not what that EUser must hold.
   - What that reader would need: a complete worked example with the `.pk`, the registry entry, both EUser records and both grant JSONs, including the script granted to its own `runsAs` identity. Then one sentence on what a trigger's `runsAs` identity must hold.

3. **docs/host.md:123** (with act/make-registry.js:37)
   - Category: **false**
   - Exact text: `{ "id": "on-mail", "script": "my-script", "runsAs": "u-…0002", "on": "message", "topic": "inbox" } ] }`
   - Why it fails a stranger: with host.md's three example triggers, `make-registry.js` printed `✓ trigger on-mail answer as u-… · at undefined undefined`. Its summary line knows only `every` and `at`. A stranger approving the file sees an on-message trigger described as a timed one with no time, and cannot tell whether it was understood. The file it writes is correct; only the approval output is wrong.
   - What that reader would need: an approval line that says "on message, topic inbox", as `act.js`'s own `when()` already does. Until then, a note in host.md that this line is cosmetic.

4. **README.md:44** (against README.md:72 and docs/host.md:137)
   - Category: **unclear**
   - Exact text: "**the reference host**: the native actions and the HTTP/host adapter that SYNTHEKOS runs."
   - Why it fails a stranger: the README uses "host" and "kernel" for overlapping files. Line 44 calls `act.js` and `act/actions/` "the reference host". Line 72 defines "the kernel" as `act.js` + `act/**`. host.md:137 says `act/actions/` "is part of the kernel". `examples/minimal-host.js` is also "a host", and it calls `create()` from that same "reference host" file. A newcomer can't tell whether `act.js` is the thing they embed (kernel) or the thing they would replace (host).
   - What that reader would need: one sentence that fixes the terms. For example: "`act.js` is the kernel's host adapter: your host calls its `create()`; `examples/minimal-host.js` is a host".

5. **act/scheduler.js:18** (with docs/host.md:133)
   - Category: **false**
   - Exact text: "state (last fire per trigger, triggers switched off) lives in <filesRoot>/.pk-state/scheduler.json"
   - Why it fails a stranger: on my copy the state was at `<appDir>/act-files/.scheduler/scheduler.json`, because `act.js` passes `stateDir: <FILES_ROOT>/.scheduler`. The kernel also deletes each file in `.scheduler/off/` once it has applied it. So host.md:133's "the off-folder is state" holds only while no scheduler runs. Someone checking which triggers are off would look in two wrong places: `.pk-state/` and the emptied `off/`.
   - What that reader would need: host.md to name `act-files/.scheduler/scheduler.json` as where "switched off" is kept, and to say the `off/` files are consumed. The comment can wait for the next kernel release, as Known gaps already says of other comments.

6. **README.md:81** (with docs/host.md:20)
   - Category: **missing**
   - Exact text: "`examples/minimal-host.js` is a complete host in about 40 lines"
   - Why it fails a stranger: host.md:20 says "A host wires it once": `installShutdown({ stop: () => act.stop(), server })`, or else a busy script daemon can outlive the server. The "complete" example doesn't do this. It is short-lived and calls `act.stop()` itself. A stranger who copies the example into a long-running server will leave out the wiring.
   - What that reader would need: a commented line in the example, or a sentence in the README, saying what a long-running host adds (`installShutdown`).

7. **README.md:102** (with .gitignore:1–3)
   - Category: **missing**
   - Exact text: "**the folder that holds `act.js`** (the repository root)"
   - Why it fails a stranger: a host that leaves out `appDir`, the documented default, writes `logs/act.jsonl` and `act-files/` (identity files, mailboxes, outbox) into the clone. `.gitignore` covers only `lab/results/`, `node_modules/` and `.DS_Store`. So `git add .` would stage an audit log and mail queue. The lab and tests are careful never to do this, but a stranger's first host may not be.
   - What that reader would need: `logs/` and `act-files/` in `.gitignore`, or a warning next to the default.

8. **docs/reviews.md:10**
   - Category: **unclear**
   - Exact text: "**20 findings are pinned only by host tests:**"
   - Why it fails a stranger: the list that follows names 7 + 2 (R2 H1, M4) + 1 (H1-bis) + 2 (R4) + 3 (R1 M2, L3, L4) + 1 (N2) + 2 (C1, C2) + 1 (F09) + "SAVE and LOAD". That is 20 only if SAVE and LOAD count as one finding (reviews.md:195 describes them as one), and 21 if they are two tests. A reader checking the count can't tell which.
   - What that reader would need: write it as "round 1's SAVE/LOAD finding (two tests)", or give the count of tests next to the count of findings.

9. **docs/kernel-flow.svg:32–45** (against README.md:8–19)
   - Category: **unclear**
   - Exact text: "The bus (core) checks"
   - Why it fails a stranger: the diagram lists 10 bus checks. The README, which says it follows `act/core/bus.js`, lists 12. The diagram leaves out "the action is served on this machine" (`NO_ROUTE`) and "the hop limit is not reached" (`HOP_LIMIT`), though both codes appear in host.md's status table. A reader comparing the two sees a mismatch.
   - What that reader would need: the two missing lines in the diagram.

10. **act.js:51** (with act/core/edge.js:5 and :38)
    - Category: **unclear**
    - Exact text: "POST /api/act   Authorization: Bearer <the EUser's key>"
    - Why it fails a stranger: the README and host.md say the kernel ships no HTTP server and does no authentication: `req.euser` is "already authenticated by the host". But `act.js`'s header describes Bearer keys. `act/core/edge.js` also exports `createEdge` and `keyResolver`, a second, key-checking `POST /api/act` handler that no doc mentions except for its status table. A stranger reading the code finds two entry points and doesn't know which one a host is meant to use.
    - What that reader would need: one line in host.md, for example: "`act/core/edge.js`'s `createEdge` is the core's own test edge; hosts use `act.route`". Known gaps could also list this header among the stale comments.

11. **docs/functions-and-mailboxes.md:78**
    - Category: **unclear**
    - Exact text: "Because PROTEUS-K is total, an action cannot run inside `collect`."
    - Why it fails a stranger: the reason given doesn't explain the rule. Totality is about termination. §2 (line 22) gives the real reason: a function that calls an action is *impure* and is barred from the collection forms.
    - What that reader would need: "Because collection forms take only pure functions (§2), …".

12. **lab/TIER2-RESULTS_091126.md:42**
    - Category: **unclear**
    - Exact text: "The tar is available to reviewers, as is the private provenance record: ask in an issue on this repository."
    - Why it fails a stranger: the README now gives the address, but this page, where a reviewer reads about the tar, still says only "this repository". Someone sent straight to this file can't find where to ask.
    - What that reader would need: the issues URL here too, as README.md:68 has it.

13. **act/core/bus.js:3** (and 35 other kernel files; README.md:3, NOTICE:1)
    - Category: **unclear**
    - Exact text: "// (C) John Koperwas 2026 · Koperwas Systems"
    - Why it fails a stranger: 36 kernel headers name "Koperwas Systems" as well as, or instead of, the person in `LICENSE`, `NOTICE` and the SPDX lines. Some files (e.g. `act/actions/calc.js`) carry only this line and the SPDX tag, with no "Copyright (c)" line. Nothing says whether "Koperwas Systems" is a separate rights holder. Someone checking licence provenance would have to ask.
    - What that reader would need: one sentence in the README's Licence section or `NOTICE` that says who "Koperwas Systems" is, or that it holds no separate rights.

14. **README.md:171**
    - Category: **missing**
    - Exact text: "and on `v0.53.9`, the kernel here, they are again."
    - Why it fails a stranger: every other kernel the README names has its mutation rows on file (`RUNS-0535…` to `RUNS-0538…`). The claim for the kernel actually in this repository has no file, so the reader has to run the harness to check it. I did, and it is true: all 144 rows match, and the header names `kernel = 0.53.9`. Without a record, it's an unrecorded claim.
    - What that reader would need: a `RUNS-0539_101126.tsv`, or a sentence saying the rows were not recorded separately because they equal `RUNS-0538`'s.

15. **tools/check-byte-identity.sh:5** (the first of its "two forms")
    - Category: **unclear**
    - Exact text: "TAG alone: ACTBUS's TAG holds exactly SYNTHEKOS's act.js + act/** at its TAG … nothing missing and nothing extra in the WHOLE tree — and is a root commit."
    - Why it fails a stranger: this form needs an ACTBUS tag with the same name as a SYNTHEKOS tag (`v0.53.x`), whose whole tree is only `act.js` + `act/`. ACTBUS's tags are `v0.3.x` and its tree holds README, docs and lab. As described, this form can't pass for any tag the README names. The README uses only the second form. A reader wonders what the first form is for.
    - What that reader would need: a note saying which repository the first form was for (the predecessor's early tags?), or drop it.

---

## What I read, what I skipped, what I ran

**Read in full:** `README.md`, `package.json`, `.gitignore`, `NOTICE`, the head of `LICENSE` (standard Apache-2.0, 202 lines), `docs/host.md`, `docs/capability-architecture.md`, `docs/proteus-k.md`, `docs/functions-and-mailboxes.md`, `docs/reviews.md`, the text of `docs/kernel-flow.svg`, `examples/minimal-host.js`, `tools/*`, `lab/lab-check.sh`, `lab/EXPECTED-RESULTS.txt`, `lab/KERNEL-*`, `lab/SEALS.md`, `lab/TIER2-RESULTS_091126.md`, `lab/mutations/README.md`, `mutrun.sh`, `RESULTS-0537-cleanup-words.md`, `act/make-registry.js`, `act/trigger-off.js`, `act/core/edge.js`, `act.js` lines 1–420 and 455–465, and the top and `act.js`/`trigger-off.js` sections of `act/CHANGELOG.md`.

**Read in part or by search:** `act/core/bus.js` (the check order, error codes, limits), `act/core/registry.js` (script rules), `act/core/rational.js` (the 8 192-bit limit), `act/actions/date-diff.js`, `act/scheduler.js` (state and switch-off), `act/daemon/supervisor.js` (the numbers in the diagram), `act/shutdown.js` (its export), `lab/lab.js` (header, fingerprint, model paths), `lab/mutations/mutate.py` (header), `lab/gen-suite1-injection.py` (header), the `limit-page-decides-whether.json` scenario, test names in `act/test/temperature.test.js` and `script.test.js`, and the finding headings of `docs/cold-read-v031.md` (so as not to repeat them).

**Skipped:** most of `act/proteus/*.js` (eval, engine, reader, state), `act/mailbox.js`, `act/mail/*`, the other action files, the bodies of the 32 test files, `docs/cold-read-v030.md`, most of `act/CHANGELOG.md`, the other `RESULTS-*.md`, `SEALED-LIST_061126.md`, and the bodies of most scenario files.

**Ran (all on a copy in scratch, with Node v26.7.0 and Python 3.10.11 on macOS):**
- `shasum -a 256 -c lab/KERNEL-SHA256SUMS`: 36 of 36 OK.
- The README's fingerprint recipe (README.md:74): `04e0a467c093…`, as stated.
- `node tools/name-hashes.js`: `NAME-HASHES PASS — 3 of 3`.
- `node examples/minimal-host.js`: the four lines the README shows (403, `grant saved: true`, 200 with `"result":"42"` and `sha256` `e54fbc35e393`, the audit path). The example is 37 lines.
- `npm test`: 374 tests, 374 pass, 0 fail, about 7 s. It wrote nothing outside the temp folders.
- `npm run test:check`: `full run: 375 tests, 1 failed · skipping run: 374 … KERNEL TESTS PASS`. Running the script by its bare path also works (it is executable).
- `bash lab/lab-check.sh`: `LAB PASS — 12/12`, in about 13 s. It wrote only under `lab/results/`.
- `bash lab/mutations/mutrun.sh <abs path> LIVE M1 … M15`: about 2 min 15 s. The 144 rows are identical to `RUNS-0538_091126.tsv`, and only the header differs (`kernel = 0.53.9`). I recomputed the README's catch counts from the TSV (M3 24/38, M4 12/38, M6 1/4, M14 1/14, M1 and M13 not caught) and they match.
- The five `gen-suite*.py` generators (with `python3 -I`, on a second copy): every scenario was regenerated byte for byte. They move the old suite to `suites/_superseded/` and leave no `SEALED.json`.
- The SEALED.json sha prefixes against `lab/SEALS.md`'s "new seal" column: all six match. `SEALED-LIST_061126.md`'s sha matches the `42e73dce…6d74` cited in `mutate.py`.
- My own trials, following the docs:
  - `create()`'s refusals as README.md:119 describes them: an unknown name (stripped), `ollamaUrl`, `models` without `modelUrl`, a blank `modelUrl`, a bad `productName`. All were refused as described.
  - The `.web-egress-disabled` kill switch: the fetch went from 200 to `422 ACTION_ERROR "web access is switched off…"`.
  - proteus-k's worked example (finding 2): it needed the extra grant, and then it gave 200 with `"value":"42"` both in-process and in daemons.
  - host.md's three triggers through `make-registry.js` (finding 3).
  - `trigger-off.js` with a real id, a typo'd id, a missing `act-files/` (exit 2, as documented) and no arguments. A running kernel audited `trigger-switched-off` for the real id and `trigger-off-unknown` for the typo (finding 1).

**Could not run:**
- The git checks (README.md:60–62): there is no `.git` in this folder, and the README says they need a clone.
- `tools/check-byte-identity.sh`: it needs the private SYNTHEKOS repository. Run with a missing repository, it stops with exit 2, as written.
- The Tier 2 real-model run: no model server on `localhost:11434`.
- Node 20 and Node 22.1 (to check the README's version statement): only Node 26 is installed here.
