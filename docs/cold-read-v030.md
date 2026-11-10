# Cold read: ACTBUS v0.3.0

This is a first outside reader's report on this folder, the repository at tag v0.3.0. It used nothing from outside the folder: no web lookups, and nothing about the project or its author.

**Bottom line.** Everything the README tells a reader to run that *can* run here works and matches what the README says:
- `npm test`;
- `tools/kernel-test-check.sh`;
- `lab/lab-check.sh`;
- the mutation harness, whose 144 result rows reproduced byte for byte.

The weak points are elsewhere:
- **Provenance:** the claim that this is the live code can't be checked from this folder, and the repository's own history is described in contradictory ways.
- **Using the kernel from a host:** the README's example can't get as far as a first successful call, and it writes into the repo.
- **Numbers and records** that point to material that is private or missing.

The findings are ordered roughly by how badly they mislead or block a stranger.

---

## Findings

1. **README.md:48 (with lab/TIER2-RESULTS_091126.md:10 and lab/SEALS.md:35)**
   - Category: **false** (the statements contradict each other)
   - Exact text: "It is the first commit of this repository."
   - Why it fails a stranger:
     - TIER2-RESULTS:10 says the real-model run used "tag `v0.2.5` (commit `3c41b57`)" and checked "the tag's 214 files".
     - SEALS.md:35 says the originals "are in this repository's history up to tag `v0.2.3`".
     - README:160-165 cites v0.2.0, v0.2.3, v0.2.4 and v0.2.5 as if they were tags of this repository.
     - If v0.3.0 is this repository's first commit, those tags and that history can't be in it. A reader can't tell whether there are two repositories (a private one with history and a public one re-rooted at v0.3.0), or whether one of the statements is wrong.
   - What the reader needs: one sentence such as "v0.1.x–v0.2.x were tags of a private predecessor repository; this public repository starts at v0.3.0". Use the same wording in all three files.

2. **README.md:50**
   - Category: **unfollowable**
   - Exact text: "`tools/check-byte-identity.sh <synthekos-repo> <actbus-repo> v0.53.8 v0.3.0` compares the kernel files of the two tags entry by entry."
   - Why it fails a stranger:
     - The section is titled "Proof that this is the live code", but the proof needs the private SYNTHEKOS repository.
     - This folder isn't even a git repository: there is no `.git`, so the ACTBUS side can't be checked either.
     - I ran it as `bash tools/check-byte-identity.sh . . v0.53.8 v0.3.0` and got `fatal: not a git repository` / `STOP: . has no tag v0.53.8`, exit 2.
     - Only the closing sentence ("It can only be run where both repositories are present") hints at this.
   - What the reader needs:
     - a published, checkable artefact, for example the `git ls-tree -r` listing of SYNTHEKOS v0.53.8's `act.js`+`act/` (blob hashes) committed here, so a reader with a clone can at least compare their side;
     - or the section retitled as an attestation that the reader has to take on trust.

3. **README.md:48-50 vs tools/check-byte-identity.sh:7-8, 17, 27**
   - Category: **false**
   - Exact text: "nothing missing and nothing extra under those paths. It is the first commit of this repository."
   - Why it fails a stranger:
     - The README offers the 4-argument command as the check for these claims.
     - In that form (TAG `v0.53.8` ≠ REF `v0.3.0`) the script compares only `act.js`+`act/`. By its own header (line 8), "REF may have history".
     - The root-commit test (line 27) runs only when TAG = REF.
     - So the given command never checks "first commit", even where both repositories are present.
   - What the reader needs: either the command that checks the claim (the script has no form that compares different tag names *and* checks the root commit), or the claim cut back to what the command proves.

4. **tools/check-byte-identity.sh:9 and :11**
   - Category: **unclear** (out of date)
   - Exact text: "`[tag, default v0.53.5-headers]`"
   - Why it fails a stranger: the README pairs this repository with v0.53.8. Someone who leaves out the third argument compares against an older release, and nothing warns them.
   - What the reader needs: a default of v0.53.8, or no default (make the tag required).

5. **docs/capability-architecture.md:4**
   - Category: **false**
   - Exact text: "The code in this repository is the kernel at `v0.53.5-headers`."
   - Why it fails a stranger: README:48 and lab/KERNEL-VERSION.txt say the code is v0.53.8. A reader who believes the doc looks for the wrong behaviour; for example, the `create()` refusals came in v0.53.7 and v0.53.8.
   - What the reader needs: "v0.53.8", or "this record was edited when the kernel was at v0.53.5-headers".

6. **README.md:58-67**
   - Category: **missing**
   - Exact text: "A host creates the kernel once and sends every request through it:"
   - Why it fails a stranger: the snippet stops at `create()`. Nothing says how to send a request. In the code:
     - `route` is an Express-style handler `(req, res)`. It expects an already-authenticated `req.euser` and `req.body = { action, input, id? }` (act.js:321-357).
     - No HTTP server is shipped. "`POST /api/act`" is a path the host has to mount itself.
     - The `prisma` stand-in "in lab/lab.js" has to provide `user.findMany`, `user.findUnique` and `user.update`, with records `{ uniqueId, loginId, role, auth, actGrants }` (lab.js:50-55). None of this is stated.
     - **Ran:** the snippet exactly as written, with a minimal `prisma`, followed by one `route()` call. The result was `HTTP 403 {"code":"NOT_PERMITTED","error":"no actions are granted to this EUser (Admin › Edit › Actions)"}`. That "Admin › Edit › Actions" screen belongs to the host and isn't in this repository, and the README doesn't say how to grant an action (`saveGrants`, or the grant JSON shape).
   - What the reader needs: a 15-line end-to-end example, as follows:
     - the `prisma` shape;
     - `saveGrants(user, JSON, admin)` with a minimal grant, `{ owner, actions: { calc: {} } }`;
     - one `act.route(...)` call with the reply it gives.

7. **README.md:61 (with act.js:173, 177-180)**
   - Category: **missing**
   - Exact text: "`const act = require('./act.js').create({`"
   - Why it fails a stranger:
     - `appDir` defaults to `__dirname`, the repository root.
     - **Ran (on a scratch copy):** the README snippet created `logs/act.jsonl`, `act-files/.outbox` and `act-files/.mailbox` inside the repository root.
     - `create()` accepts 13 options (act.js:144): prisma, models, modelUrl, productName, appDir, fetchImpl, log, actionsDir, env, daemon, mailTls, triggersFile, clock. The README names 4, and `appDir`, which decides where the audit log and every identity's files go, isn't one of them.
   - What the reader needs: a table of all 13 options with their defaults. For `appDir`, say plainly that it defaults to the kernel's own folder.

8. **README.md:93 (lab/lab.js:155) and lab/mutations/mutrun.sh:4, lab/mutations/RESULTS-0537-cleanup-words.md:31**
   - Category: **false / missing**
   - Exact text: "(the repo is never changed; mutants live in a temp folder)"
   - Why it fails a stranger:
     - Every `lab.js run` writes a results folder into `lab/results/` inside the repository.
     - **Ran:** `bash lab/lab-check.sh` left 12 folders and 416 files under `lab/results/` in this folder. They are git-ignored (`.gitignore:1`) but are new files all the same.
     - `mutrun.sh` makes 144 such runs. Its mutant *kernels* do live in a temp folder, but the results don't.
     - The README never says the lab writes anything.
   - What the reader needs: "lab runs write to `lab/results/` (git-ignored)", and the mutrun comment reworded to "the kernel files are never changed".

9. **README.md:81-83 and package.json:11**
   - Category: **unclear** (the text is close to false)
   - Exact text: "It is skipped by its exact name. The file itself is unchanged."
   - Why it fails a stranger:
     - The skip is a regex *prefix*, `--test-skip-pattern="^FAIL-FIRST server\.js wires it"`, not the test's exact name.
     - **Ran:** `npm test` gave exit 0 with `tests 371 · pass 371 · skipped 0`, and the excluded test is never named. A reader can't see from `npm test` that anything was left out.
     - Only `bash tools/kernel-test-check.sh` shows it. **Ran:** that gave `full run: 372 tests, 1 failed · skipping run: 371 tests, 371 passed, 0 failed` → `KERNEL TESTS PASS`, exit 0.
   - What the reader needs: "excluded by a name pattern; `npm test` reports it as neither run nor skipped; `npm run test:check` proves it is the only one".

10. **README.md:102 and :108**
    - Category: **unclear** (the numbers don't add up)
    - Exact text: "| injection (two agent shapes) | 38/38 | 25/25 | 12/12 | 0 |"
    - Why it fails a stranger:
      - 25 + 12 = 37, not 38.
      - The "all" row has the same gap: 62 + 32 + 6 selftest = 100, not 101.
      - The 38th run is `lab/suites/injection/limit-page-decides-whether.json`, whose `twin` is `"limit"`: "documented limit (rule b): an injected page CAN make the script send its FIXED mail to Alex".
      - TIER2-RESULTS:23 has a "Documented limit" column; the README's table doesn't.
    - What the reader needs: a "documented limit 1/1" column, or a footnote naming the scenario. It is also the most instructive scenario for a reader judging the threat model.

11. **README.md:52**
    - Category: **unfollowable**
    - Exact text: "mail footer `c800d61e…`, message with its X-Mailer header `406f6641…`, fetch User-Agent `66195a05…`"
    - Why it fails a stranger:
      - The hashes are "built from fixed inputs" by a private release check (`after-checks-0536`). The inputs aren't given.
      - No file in the repository contains these hashes, and `act/test/product.test.js` asserts strings, not hashes.
      - **Ran:**
        - `sha256("SYNTHEKOS-fetch/1.0")` = `66195a05…`, so the User-Agent hash matches.
        - `footer({identity:'alex', authority:['alex','bot'], trace:'t-1', labels:[], product:'SYNTHEKOS'})`, built with the inputs from product.test.js, gives `be10e264…`, not `c800d61e…`.
        - So 1 of 3 hashes can be reproduced, and the other two can't without their inputs.
    - What the reader needs: the exact inputs (identity, authority, trace, labels, message fields, date), or a script in `tools/` that prints the three hashes.

12. **docs/reviews.md:10 (and :40, :140, :144-145, :151-170, :179-181, :195)**
    - Category: **unfollowable**
    - Exact text: "A *host test* is in the reference host's application tests (`test/act*.test.js` in SYNTHEKOS), which are not in this repository"
    - Why it fails a stranger:
      - README:42 promises "the test that pins" each finding.
      - For a large share of the findings, that test isn't here:
        - all 7 `act.js` 1.1.0 findings;
        - R2 H1, M3 and M4;
        - R3 H1-bis;
        - R4;
        - every 5 Nov R1, N2, C1 and C2 fix;
        - F09;
        - the v0.53.2 SAVE/LOAD tests.
      - Those fixes are the escalation and no-laundering rules in `act.js`, which are central to the threat model.
    - What the reader needs: a count up front ("N of M findings are pinned by tests in this repository"), or the host tests ported to `act/test/` against the stand-in `prisma`.

13. **docs/reviews.md:272-273**
    - Category: **missing**
    - Exact text: "the name check D of `check-cleanup.js` 1.0.0 reported each line once per pattern"
    - Why it fails a stranger: `check-cleanup.js`, `check-lab.js` and `check-1c.js` aren't in the repository. README:164 also leans on "the release check D" without saying what it is.
    - What the reader needs: either the checkers in `tools/`, or a plain statement that they are private release tooling.

14. **README.md:54 and :145; lab/TIER2-RESULTS_091126.md:42; lab/mutations/README.md:3**
    - Category: **missing**
    - Exact text: "Versions before 0.3.0 are in the private provenance record."
    - Why it fails a stranger:
      - Many claims rest on this record:
        - earlier tags;
        - the earlier mutation results "on kernel 0.53.2";
        - "Ask 2";
        - the 6 Nov real-model run;
        - the raw tar of the 760 real-model runs.
      - TIER2:42 says the tar "is available to reviewers on request", and act/CHANGELOG.md:5 says the record is "offered to a reviewer on request". Neither says *whom* to ask or how. There is no contact anywhere except the author's name.
    - What the reader needs: a contact route, such as an issue tracker or an address, and one list of which claims depend on private material.

15. **README.md:1 (and NOTICE:4)**
    - Category: **unclear**
    - Exact text: "ACTBUS is the capability kernel inside SYNTHEKOS."
    - Why it fails a stranger:
      - SYNTHEKOS is never defined. The reader learns only that it is private, has releases v0.53.x, an "appliance" and "a host machine".
      - NOTICE also excludes "TRUTHGATE™", which appears nowhere else.
    - What the reader needs: one sentence on what SYNTHEKOS is, and one on TRUTHGATE, or remove TRUTHGATE.

16. **README.md:150 (and :98, :118, :149)**
    - Category: **unclear**
    - Exact text: "On kernel 0.53.2, M1 together with M15 (the kernel target check removed) let 3 attacks reach the attacker."
    - Why it fails a stranger:
      - The README uses three version schemes without explaining them:
        - ACTBUS tags (v0.3.0);
        - SYNTHEKOS tags (v0.53.x, many with suffixes such as `-headers`, `-cleanup`, `-temperature`);
        - per-file versions (1.x.y).
      - "kernel 0.53.2" mixes the first two.
      - lab/EXPECTED-RESULTS.txt:1-3 adds a fourth identifier, kernel fingerprints such as `7928fa6b5c9a`.
    - What the reader needs: a short "Versions" paragraph that maps the schemes onto each other, and a statement of which identifier the reader should use.

17. **README.md:149**
    - Category: **unclear**
    - Exact text: "on `v0.53.5-headers`, `v0.53.5-changelog`, `v0.53.6`, `v0.53.6-purpose`, `v0.53.6-docrefs` or `v0.53.7-cleanup`:"
    - Why it fails a stranger: the list leaves out v0.53.8, the only kernel in this repository. README:118 says v0.53.8's rows are identical, and I reproduced them (see Ran). Even so, the Known-gaps list reads as if the code here hadn't been measured.
    - What the reader needs: v0.53.8 at the head of the list.

18. **README.md:112-118**
    - Category: **missing**
    - Exact text: "`lab/mutations/` deliberately breaks the kernel, on a copy, in 15 named ways, and runs the suites again."
    - Why it fails a stranger:
      - The README gives no command for this.
      - `lab/mutations/README.md` is 5 lines with no usage.
      - The reproduce command sits at the bottom of `RESULTS-0537-cleanup-words.md:31`, and it requires `python3`, which the README never mentions (README:75 says "no dependencies").
    - What the reader needs: the `mutrun.sh` command in the README, a note that it needs `python3` and takes about 2½ minutes, and a note that it writes into `lab/results/`.

19. **docs/kernel-flow.svg:43**
    - Category: **false**
    - Exact text: "· rate per identity"
    - Why it fails a stranger:
      - The diagram puts the rate check last, after taint.
      - In `act/core/bus.js`, rate is checked at line 140, before "action registered" (144), grant (156), input shape (158) and taint (160-162).
      - README:12 also puts rate before the grant check.
      - README:7 stresses "in the same order", so the order is part of the claim.
    - What the reader needs: the diagram's list in code order.

20. **README.md:14-15 vs act/core/bus.js:158-166**
    - Category: **unclear**
    - Exact text: "the input matches its declared shape and allowed targets;"
    - Why it fails a stranger:
      - In the code, the target check (`NO_TARGET`, bus.js:166) comes *after* the taint check (160-162), not before it.
      - The README also leaves out the "action registered" check (bus.js:144), which the diagram shows.
    - What the reader needs: the eight-step list as it runs in the code.

21. **README.md:69 (act/core/product.js:7, :11)**
    - Category: **unclear** (incomplete)
    - Exact text: "The name must be a plain token (1–32 letters, digits, dots, dashes or underscores)"
    - Why it fails a stranger: the code also requires the first character to be a letter or digit (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/`), so `-lead` and `.lead` are refused (product.test.js). The README's rule allows them.
    - What the reader needs: add "starting with a letter or a digit".

22. **docs/capability-architecture.md:46 (and §6 item 3, :74)**
    - Category: **missing**
    - Exact text: "**Isolation must be proved, not trusted.** The test: identity A is told a secret word."
    - Why it fails a stranger:
      - The doc describes this as an acceptance test, but I found no test for it under `act/test/` or `lab/`. I searched for "isolation", "secret word" and "leak"; the only hits were unrelated.
      - The doc never says whether the test was built.
    - What the reader needs: a pointer to the test, or "not built" next to the description, in the style of §11.

23. **docs/proteus-k.md:161-163**
    - Category: **unclear** (out of date)
    - Exact text: "`timeoutMs` for scripts: 300 s is proposed, because a model call alone may take 120 s."
    - Why it fails a stranger: the "Open" section lists two points the code has already settled:
      - the script default is 300 000 ms (act/core/registry.js:153);
      - the `.pk` extension is enforced (registry.js:65).
      - A reader will think the spec is undecided where it isn't.
    - What the reader needs: move these to "settled" and cite the code.

24. **docs/proteus-k.md:107 and README.md:21**
    - Category: **missing**
    - Exact text: "`{ "name": "rate-watch", "version": "1.0.0", "kind": "script", "file": "rate-watch.pk", …`"
    - Why it fails a stranger:
      - There is no `.pk` file anywhere in the repository.
      - The only complete PROTEUS-K programs are embedded as strings in `lab/suites/*/*.json` (`"scripts": [{ "source": … }]`), and nothing tells a reader to look there.
      - Nothing explains how an administrator writes `registry.spec.json` and runs `act/make-registry.js` to register a script.
    - What the reader needs: one example `.pk` file and its registry entry, plus the `make-registry.js` command, or a pointer to one lab scenario as the worked example.

25. **lab/TIER2-RESULTS_091126.md:45-47**
    - Category: **unclear / unfollowable here**
    - Exact text: "On a machine with a local model server on `localhost:11434` and the four models pulled, for each model:"
    - Why it fails a stranger:
      - The model server is never named. Only its version, "0.40.11", is given (line 5); the port and the `/api/generate` API (lab.js:41) hint at one product without saying so.
      - Model names such as `gemma4:26b` are server-specific tags.
      - **Not run:** no model server or models are in this folder, and fetching them would mean going outside it.
    - What the reader needs: the server's name and how to install the four models by digest.

26. **lab/mutations/SEALED-LIST_061126.md:1, :3, :22, :24**
    - Category: **unclear**
    - Exact text: "Suite 3 as planned — go. No registrar, no kernel-to-kernel, until after the demo: agreed."
    - Why it fails a stranger:
      - The file is an internal working note: "Ask 3", "the paper", "the demo", "registrar".
      - Line 3 says mode B widens allow-lists "to `*`". What's built adds only the attacker's host and address (lab.js:14), and README:114 describes that correctly.
      - A stranger can't tell which description is right.
      - Its sha256 does match the one `mutate.py` cites (`42e73dce…6d74`, checked).
    - What the reader needs: a one-line note in `lab/mutations/README.md` that the list is reproduced verbatim as sealed, and that mode B as built widens to the attacker only.

27. **lab/lab.js:1-3**
    - Category: **unclear** (out of date)
    - Exact text: "Boots the REAL kernel (./kernel = a read-only copy of live, shas in"
    - Why it fails a stranger: since lab 0.2.0 the kernel is the repository root (lab.js:11, `KDIR = … path.join(LAB, '..')`). There is no `./kernel` folder. A reader of the runner's own description looks for a copy that doesn't exist.
    - What the reader needs: "boots the kernel at the repository root (or `LAB_KERNEL`)".

28. **act/CHANGELOG.md:19-20 and :25-27**
    - Category: **unclear**
    - Exact text: "- v1.6.0 (SYNTHEKOS v0.53.0 · 051126):"
    - Why it fails a stranger:
      - Five entries for `act.js` have no content: v1.6.0 and v1.5.0 end in a colon with nothing after it, and three are "Kept from v1.x.0" with no text.
      - What changed in those versions is described only in `act.js`'s header comment.
      - Line 15 cites "capcore-281028 v1.1.0", which is never defined.
    - What the reader needs: the entries filled in, or a pointer ("described in act.js's header, section ## Design").

29. **act.js:16-17 (and act.js:328)**
    - Category: **unclear**
    - Exact text: "the Admin web kill switch ("Pull the plug" → .web-egress-disabled, the file websearch.js honours)"
    - Why it fails a stranger:
      - The kernel's own comments and refusal messages refer to host parts that aren't here: an Admin panel, `websearch.js`, `server.js`, and "Admin › Edit › Actions".
      - The mechanism does work without them: a file `<appDir>/.web-egress-disabled` stops `fetch` (act.js:231). But the README doesn't tell a host this.
    - What the reader needs: a README note on the kill-switch file and on `node act/trigger-off.js <id>` as host-independent controls.

30. **README.md:75**
    - Category: **unclear** (minor)
    - Exact text: "Tested on Node 22 and 26; Node 20 will not work. There are no dependencies."
    - Why it fails a stranger:
      - No reason is given for "Node 20 will not work". The likely reason is the `--test-skip-pattern` flag used in `package.json`.
      - "No dependencies" holds for the kernel, but the lab's generators and the mutation harness need `python3`, and the lab scripts need `bash`.
    - What the reader needs: the reason in a few words, and "python3 for `lab/mutations/` and the generators".

### Claims I checked and found true
- README:19: temperature `0.2` is at `act.js:163`.
- README:9: dedupe for 24 h (bus.js:53, `dedupeMs = 86400000`).
- README:71: the `create()` refusals behave as described.
  - **Ran:** an unknown option `bogus` is refused with the list of the 13 known names.
  - `a-b.c!d` is echoed as `abcd`.
  - A blank `modelUrl` is refused when `models` is given.
  - `ollamaUrl` is refused with "removed in 0.53.7 — pass modelUrl".
- README:163: `ollamaUrl` appears on one line of act.js (145) and three of product.test.js (164-168).
- README:161-162: `SYNTHEKOS` appears under `act/` only in CHANGELOG.md and product.test.js.
- README:39: every `.js` file under `act/` and `act.js` has a line-1 (line-3 after a shebang) header naming its version, purpose and CHANGELOG section.
- docs/functions-and-mailboxes.md:100: "Daemon mode, the default" holds (act.js:186: on unless `PK_DAEMON=0`). Note that the *lab* defaults to in-process.
- README:98: kernel fingerprint `0323a6a4c26e` (= "the recorded copy of live 0.53.8") on Node v26.7.0.
- README:118: "all 144 rows are byte-identical" was reproduced; see Ran.
- lab/mutations/README.md:5: the sha256 of the sealed list matches mutate.py.

---

## What I read
- **In full:**
  - `README.md`, `package.json`, `.gitignore`, `NOTICE`;
  - `docs/capability-architecture.md`, `docs/proteus-k.md`, `docs/functions-and-mailboxes.md`, `docs/reviews.md`;
  - `tools/kernel-test-check.sh`, `tools/check-byte-identity.sh`;
  - `lab/lab-check.sh`, `lab/lab.js`, `lab/EXPECTED-RESULTS.txt`, `lab/KERNEL-VERSION.txt`, `lab/SEALS.md`, `lab/TIER2-RESULTS_091126.md`;
  - `lab/mutations/README.md`, `RESULTS-0537-cleanup-words.md`, `SEALED-LIST_061126.md`, `mutrun.sh`;
  - `act/core/product.js`.
- **In part:**
  - `act.js`: the header (lines 1-40), `create()` and the options (144-200), `route` (321-360), the exports;
  - `act/CHANGELOG.md`: lines 1-40;
  - `lab/mutations/mutate.py`: lines 1-30;
  - `act/test/product.test.js`: lines 1-100;
  - `act/core/bus.js`: the check order (lines 53, 100-170, by grep);
  - `act/core/registry.js`: timeouts and `.pk`, by grep;
  - `docs/kernel-flow.svg`: its text labels;
  - one injection scenario's `scripts` field; the `twin` field of every injection scenario.

## What I skipped
- Most of the kernel source: `act/proteus/*`, `act/mailbox.js`, `act/scheduler.js`, `act/daemon/*`, `act/mail/*`, `act/actions/*`, and the rest of `act/core/*`, `act.js` and `act/CHANGELOG.md`.
- All test files apart from the parts of product.test.js above. I ran them but didn't read them.
- The other RESULTS-*.md and RUNS-*.tsv files apart from the two compared below.
- The five `lab/gen-suite*.py` generators and `lab/timeline.js`.
- The scenario JSONs, apart from the fields named above.
- `LICENSE` beyond its header, and `lab/KERNEL-SHA256SUMS` (it was checked by the lab's ENV line, not by hand).
- This is a documentation read. It isn't a security review of the code.

## What I ran
All of this was on macOS (Darwin 24.6.0) with Node v26.7.0 and Python 3. Where a run could write into the repository, I used a copy under my scratch directory instead; the one exception is the documented `lab-check.sh`, run in place.

| Command | Where | Result |
|---|---|---|
| `npm test` | this folder | exit 0. 371 tests, 371 pass, 0 fail, "skipped 0", about 7 s. |
| `bash tools/kernel-test-check.sh` | this folder | exit 0. `full run: 372 tests, 1 failed · skipping run: 371 tests, 371 passed, 0 failed` → `KERNEL TESTS PASS — 371/371` |
| `bash tools/check-byte-identity.sh . . v0.53.8 v0.3.0` | this folder | **could not run**, exit 2: `fatal: not a git repository` / `STOP: . has no tag v0.53.8`. The folder has no `.git`, and the SYNTHEKOS repository isn't available. |
| `bash lab/lab-check.sh` | this folder | exit 0. `ok` for all 6 suites × {inproc, daemons} → `LAB PASS — 12/12 suite runs exactly as recorded`, about 13 s. **Side effect: it created `lab/results/` (12 folders, 416 files, git-ignored) in this folder. I have left it in place.** |
| `node lab/lab.js run suites/edges 1` | scratch copy | `ENV … node v26.7.0 · kernel 0323a6a4c26e (= the recorded copy of live 0.53.8)`, RESULT line identical to EXPECTED-RESULTS. |
| `bash lab/mutations/mutrun.sh <out.tsv> LIVE M1 … M15` (the reproduce line in RESULTS-0537-cleanup-words.md:31) | scratch copy, `TMPDIR` in the scratch directory | exit 0, about 2 min 20 s. All 144 data rows are **byte-identical** to `lab/mutations/RUNS-0538_091126.tsv` and to `RUNS-0537-cleanup-words_091126.tsv`. |
| The README `create()` snippet (README:60-67) plus one `route()` call and four bad-option calls | scratch copy | `create()` ok. `route` gave 403 NOT_PERMITTED ("… (Admin › Edit › Actions)"). The refusal messages were as described in README:71. It created `logs/` and `act-files/` in the repository root (finding 7). |
| `shasum -a 256 lab/mutations/SEALED-LIST_061126.md` | this folder | `42e73dce…6d74`, matching mutate.py:3. |
| sha256 of `SYNTHEKOS-fetch/1.0`, and of `footer(...)` built with the inputs from product.test.js | this folder (read-only) | UA = `66195a05…` (matches README:52). Footer = `be10e264…` (doesn't match `c800d61e…`; the inputs are unknown). |

**Not run:**
- the Tier-2 real-model command (TIER2-RESULTS:47): there is no model server and there are no models here;
- `npm run lab` and `npm run test:check`: they are aliases of commands above;
- the suite generators: the docs don't ask a reader to run them, and regenerating would overwrite sealed files.

**This folder is unchanged except for two things:**
- this file, `COLD-READ.md`;
- the `lab/results/` folder created by the documented `lab-check.sh` run.
