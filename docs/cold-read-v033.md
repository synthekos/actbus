# Cold read: ACTBUS v0.3.3

This is a first outside reader's report on this folder, which holds the repository at tag v0.3.3. I used only what is in the folder: no web lookups, and nothing about the project or its author. Everything that could write ran on a copy in my scratch directory. I took the sha256 of every file in the folder before I started and again before writing this file, and the two lists match. This file is the only change.

**Bottom line.** Every command the README gives that can run here works, and its output matches what the README says. That covers `npm test`, `npm run test:check`, `lab/lab-check.sh`, `node tools/name-hashes.js`, both examples, the `shasum -c` check, the fingerprint recipe and the mutation harness (all 144 rows identical). All 15 findings of the v0.3.2 cold read that I re-checked are settled.

The problems start when a stranger goes past the examples and writes a script or an action of their own:
- The approval step (`make-registry.js`) approves scripts that the kernel then refuses at load. It never shows the administrator the reach list or the warnings the spec says they approve.
- A script input named the way the language invites (`old-rate`) is approved and then refused, and the message blames the type, not the name.
- The collection forms have no documentation anywhere, though `docs/proteus-k.md` says they do.
- Nothing says how to write a native action.

The rest is small: one stale version line, one count that doesn't add up, and a few gaps in the host contract.

Findings are ordered roughly by how badly they mislead or block a stranger.

---

## Findings

1. **docs/proteus-k.md:14** (with :41, :113, :122; act/make-registry.js:23)
   - Category: **false**
   - Exact text: "That list is shown to the administrator and checked against the script identity's grants."
   - Why it fails a stranger: the spec says the administrator approves a script by running `make-registry.js` (:122, "running it is the approval"). It also says they are shown the reach list (:14), the canonical form (:41) and the warnings they accept (:113). `make-registry.js` shows none of these. For each script it prints only `✓ name version file sha`, and it exits 0 for scripts the kernel then refuses. On a copy I tried three such scripts:
     - one that calls an unregistered `nosuch`;
     - one with `"world": false` that reaches `fetch` and `file-append`;
     - one with a world action under a web condition and no `acceptWarnings`.
     
     Each got `✓` and exit 0. The refusal turned up only later, as a line through `create()`'s `log` (`action refused: my-script — needs the admin to accept (acceptWarnings: true): world action file-append …`). After that, `saveGrants` answered `"my-script" is not a registered action`. So an administrator who sets `acceptWarnings: true` accepts warnings that no tool has shown them.
   - What that reader would need: either `make-registry.js` loads each script the way the kernel does, prints its reach list and warnings, and refuses what the loader would refuse, or the spec says plainly that approval only pins hashes and that the reach list and warnings appear in the host's `log` at start.

2. **docs/proteus-k.md:68** (with act/core/registry.js:77)
   - Category: **missing**
   - Exact text: "`(input name)` | the script's input field `name` (declared in the registry entry's `input`)"
   - Why it fails a stranger: the grammar (:27) allows dashes in a symbol, and the docs' own examples use dashed names (`rate-before`, `read-number`). So I declared `"input": { "old-rate": "string" }` and wrote `(number (input old-rate))`. `make-registry.js` printed ✓. The kernel then refused the script with `input field old-rate: type must be string | number | integer | boolean | object | array`, though the type was `string`. The real rule is that a field name must match `^[a-z][a-zA-Z0-9]{0,31}$` (camelCase, no dashes). No doc says so, and no doc gives the list of input types or the trailing `?` for an optional field. Those appear only in a comment in `act/core/registry.js:23`.
   - What that reader would need: one paragraph in proteus-k.md §7 (or host.md) on the `input` declaration: the field-name rule, the six types and `?`. A message that names the real fault would help too, but that waits for a kernel release.

3. **docs/proteus-k.md:4** (with docs/functions-and-mailboxes.md:22 and :27–34)
   - Category: **false**
   - Exact text: "Functions, the standard library and the collection forms came later and are described in `functions-and-mailboxes.md`."
   - Why it fails a stranger: `functions-and-mailboxes.md` names `collect`, `filter` and `count` once, in passing (:22), and never gives their syntax. `act/proteus/eval.js:45` has eight collection forms: `filter`, `collect`, `count`, `sum`, `max-by`, `min-by`, `sort-by` and `the`. Their shape, `(filter (x list) cond)`, is only in a code comment (eval.js:21). `the` is cited in reviews.md (F-D, F7) but never explained. The standard library is also only a list of names by label class, with no arguments: `split`, `replace`, `nth`, `record`, `has?`, `round` and so on. A stranger can't write a script that uses any of them without reading `eval.js`.
   - What that reader would need: a table in functions-and-mailboxes.md §2 with each collection form and each library function, its arguments, and what it returns. Or the sentence on proteus-k.md:4 should say they are documented only in `act/proteus/eval.js`.

4. **docs/host.md:141** (with README.md:44)
   - Category: **missing**
   - Exact text: "Copy `act/actions/` to a folder of your own, edit that copy, run `node act/make-registry.js <your folder>`, and pass the folder to `create()` as `actionsDir`."
   - Why it fails a stranger: the section is called "Your own actions and scripts", but it only covers scripts. Nothing in the README or docs says what a native action file looks like: that it exports `run(input, ctx)`, what `ctx` holds, what it returns, or how a thrown error surfaces (`ACTION_ERROR`). Nothing says what the registry fields `kind` (`native | tentacle | model | script`), `produces`, `needs` (only `fs`, `path`, `crypto`, `url`, `util` and `rational`) and `timeoutMs` mean, or what their defaults are. All of this is only in comments in `act/core/registry.js:11–27` and in the existing action files.
   - What that reader would need: a short "A native action" section in host.md with a ten-line example action, its registry entry, and the field list. Or at least a pointer to `act/core/registry.js`'s header.

5. **docs/host.md:133** (with act/make-registry.js:37–38)
   - Category: **unclear**
   - Exact text: "At most 20 triggers; a bad entry is refused and the others load (`act/scheduler.js`, `validate`)."
   - Why it fails a stranger: through the approval step this documented way, the opposite happens. I wrote a `triggers.spec.json` with one good trigger (`every: 3600`) and one bad one (`every: 30`). `make-registry.js` printed `✗ trigger fast: every must be 60–2678400 seconds` and `✗ triggers.json NOT written (registry.json was)`, then exited 1. The good trigger was not approved either, and any older `triggers.json` stays in force. "The others load" is true only of a `triggers.json` that was not written by `make-registry.js`.
   - What that reader would need: say that `make-registry.js` refuses the whole file if any entry is bad, and leaves the previous `triggers.json` in place, while the scheduler on its own skips a bad entry.

6. **docs/capability-architecture.md:4**
   - Category: **false**
   - Exact text: "the code in this repository is SYNTHEKOS `v0.53.9`'s kernel."
   - Why it fails a stranger: the README (:63, :66), `lab/KERNEL-VERSION.txt` and the lab's ENV line all say the code here is SYNTHEKOS `v0.54.1`'s kernel. This line was not updated for v0.3.3. A reader comparing versions finds two answers.
   - What that reader would need: `v0.54.1`. Better still, a line that does not need to change with every release ("the code in this repository is the kernel the README names").

7. **docs/reviews.md:10**
   - Category: **unclear**
   - Exact text: "**20 findings (21 host tests) are pinned only by host tests:**"
   - Why it fails a stranger: the page's own entries give 26 host tests: REVIEW 1–7 (7), R2 H1 ×2, R2 M4, R3 H1-bis, R4 and its load check, R1 M2 ×2, R1 L3 ×2, R1 L4, N2, C1, C2, F09 ×3, and SAVE and LOAD. You get 21 only if each "×2" or "×3" counts as one test, while SAVE/LOAD in the same sentence counts as two. The 20 findings do add up. The v0.3.2 cold read's finding 8 was about this sentence, and the fix added a number that is counted in a different way.
   - What that reader would need: one way of counting. Either "26 host tests", or "21 host test names" with a note that ×N means N tests.

8. **docs/host.md:52** (with README.md:97)
   - Category: **missing**
   - Exact text: "`labels` is an optional list of at most 6 labels, added to the message."
   - Why it fails a stranger: it doesn't say which labels exist, why a host would send one, or what happens to each. On a copy:
     - `["foo"]` gave 400 `labels must be a list of: person, device, computed, grounded, model, web`.
     - `["web"]` was added, so a later world action is tainted.
     - `["grounded"]` was accepted with 200 and silently dropped. That matches reviews.md:97 ("a caller cannot declare it"), but host.md says labels are "added".
     
     Every request also gets `device` without asking, and nothing in host.md says so. The README's request line (:97) leaves `labels` out entirely.
   - What that reader would need: the list of six labels. Add that a host sends `web` or `model` for text it got from those sources, that `grounded` is dropped, and that every request from an EUser is labelled `device`.

9. **docs/host.md:13**
   - Category: **missing**
   - Exact text: "`saveGrants(euser, json, adminLoginId)` | checks and saves an EUser's grants; the change is audited before it is saved | when an administrator changes an EUser's actions"
   - Why it fails a stranger: the kernel checks the grant, but not the third argument. `saveGrants(euser, …, 'nobody-at-all')` saved the grant and wrote `"by":"nobody-at-all"` to the audit log. A host author could easily assume the kernel checks that `adminLoginId` is an admin, as it checks that `owner` is a person.
   - What that reader would need: one sentence: "`adminLoginId` is recorded as given; the host must check that the caller is an administrator."

10. **README.md:152**
    - Category: **unclear**
    - Exact text: "on 10 Nov against SYNTHEKOS `v0.53.9`, the kernel of `v0.3.2` (fingerprint `04e0a467c093`), and on 11 Nov against SYNTHEKOS `v0.54.1`, the kernel here (fingerprint `2da6d5b99950`), both on the same machine"
    - Why it fails a stranger: the sentence lists four measurements in one run of clauses (v0.53.7-cleanup, v0.53.8, v0.53.9, v0.54.1), with machines and Node versions attached to some of them. "both" then refers to two of them, after three have been named since the last machine. A reader can't tell which runs were on SYNTHEKOS's host machine with Node 26.7.0. (`lab/EXPECTED-RESULTS.txt:3` says it more clearly: the last three.)
    - What that reader would need: a four-row list (date, kernel, fingerprint, machine, Node), or the wording from `EXPECTED-RESULTS.txt`.

11. **docs/functions-and-mailboxes.md:49**
    - Category: **false**
    - Exact text: "**`messages {topic}`** returns up to 20 `{id, from, topic, body, at}`, oldest first."
    - Why it fails a stranger: each item also carries `labels`. My read returned `{"id":"g-…","from":"u-…","topic":"inbox","body":"hello","at":"…","labels":["device"]}`. That field is what §3's "Labels travel" means in practice, so a host or script author parsing the reply should know it is there. The doc also never says that a topic must be `a-z, 0-9, -`. A topic `"In Box"` gave 422 `a topic is a name (a-z, 0-9, -)`.
    - What that reader would need: `{id, from, topic, body, at, labels}`, and the topic rule next to `send`.

12. **docs/proteus-k.md:180** (with docs/host.md:105)
    - Category: **unclear**
    - Exact text: "settled at 300 s, because a model call alone may take 120 s."
    - Why it fails a stranger: host.md:105 and `act.js:160` give the model action's timeout as 115 s. A reader sizing `timeoutMs` for a script with several model calls doesn't know which figure to use.
    - What that reader would need: "115 s (`act.js`)", or a note that 120 s was the figure when this was written.

13. **tools/check-byte-identity.sh:5** (with README.md:69)
    - Category: **unclear**
    - Exact text: "TAG alone, for the private provenance record (this repository's predecessor), whose root commit 81f4ee1 is its tag v0.53.5-headers"
    - Why it fails a stranger: README.md:69 says the predecessor's tags were `v0.1.0`–`v0.2.6`, and the second form's example uses `v0.1.1`. This line says the predecessor also has a tag `v0.53.5-headers`, a SYNTHEKOS-style name. A reader can't tell whether the predecessor carried both kinds of tag, or which of its tags the first form is for.
    - What that reader would need: one clause in README.md:69, for example: "it also carries tags named after the SYNTHEKOS release whose kernel it held (`v0.53.5-headers`, …)", or a correction here.

14. **README.md:75** (with lab/lab-check.sh:17)
    - Category: **unclear**
    - Exact text: "the lab's kernel fingerprint, 12 hex digits (`2da6d5b99950` for the code here), printed on every lab run's ENV line."
    - Why it fails a stranger: the command the README gives for the lab, `bash lab/lab-check.sh`, reads the ENV line but never prints it. Its output is 12 `ok` lines and `LAB PASS`, so the reader never sees the fingerprint. I saw it only by running `node lab.js run suites/edges 1` from `lab/`, a command the README doesn't give. The same ENV line also contains the machine's host name, and it is written into the results under `lab/results/`. `lab/TIER2-RESULTS_091126.md` gives that as the reason its own raw results are kept private. A stranger who shares their `lab/results/` may not expect to be sharing their host name.
    - What that reader would need: "printed by `node lab/lab.js run <suite>`" (or `lab-check.sh` printing the fingerprint once), and a note that the results name the host.

15. **docs/kernel-flow.svg:22–23** (with README.md:97, docs/host.md:63)
    - Category: **unclear**
    - Exact text: "EUser with a key" · "POST /api/act"
    - Why it fails a stranger: the diagram's entry box shows a key holder calling `POST /api/act`. The README and host.md say the kernel ships no HTTP server, reads no key, and takes `req.euser` already authenticated by the host. `act.js:51` has the same issue, and Known gaps already lists it. The diagram is not under `act/` and could be fixed now.
    - What that reader would need: "a host's authenticated EUser → `act.route`" (with "SYNTHEKOS: POST /api/act, Bearer key" as an aside).

16. **act/core/registry.js:11** (and :18; act.js:119; with docs/proteus-k.md:120 and README.md:234)
    - Category: **unclear**
    - Exact text: "// registry.json (admin-written):"
    - Why it fails a stranger: until finding 4 is fixed, `registry.js`'s header is the only place a stranger can learn the registry format, and parts of it are stale:
      - `registry.json` is not written by the administrator: `make-registry.js` writes it from `registry.spec.json`.
      - :18 describes `runsAs` for any action ("a service identity: an EUser offering a job to others"), but proteus-k.md:120 says `runsAs` is for `kind: script` only.
      - `act.js:119`'s refusal tells a host's administrator to fix `MAIL_ALLOW in the .env`. The kernel reads it from `create()`'s `env`, and a host may have no `.env`.
      
      Known gaps (README.md:234) lists some stale kernel comments, but not these.
    - What that reader would need: these added to the Known gaps list for the next SYNTHEKOS release, so that a reader who finds them knows the docs are right.

---

## What I read, what I skipped, what I ran

**Read in full:**
- `README.md`, `package.json`, `.gitignore`, `NOTICE`
- `docs/host.md`, `docs/proteus-k.md`, `docs/capability-architecture.md`, `docs/functions-and-mailboxes.md`, `docs/reviews.md`, `docs/cold-read-v032.md`
- the text of `docs/kernel-flow.svg`
- both files in `examples/`
- `lab/lab-check.sh`, `lab/EXPECTED-RESULTS.txt`, `lab/KERNEL-VERSION.txt`, `lab/SEALS.md`, `lab/TIER2-RESULTS_091126.md`, `lab/mutations/README.md`
- the header of `tools/check-byte-identity.sh`
- the top section and the `act.js` section of `act/CHANGELOG.md`

**Read in part or by search:**
- `act.js`: every line the docs cite (51, 89, 92, 156–163, 171, 243, 321–349, 378, 381–399, 461–465).
- `act/core/registry.js`: its header and the input checks.
- `act/core/bus.js`: its limits and codes.
- `act/daemon/supervisor.js`: the numbers in the diagram.
- `act/proteus/eval.js`: the collection forms.
- the `run` exports of the action files, the names of the tests in `act/test/trigger-off.test.js` and `temperature.test.js`, `lab/lab.js` (its header and fingerprint code), and `act/make-registry.js`'s output lines.
- the line 1 of every kernel `.js` file, to check its changelog pointer: all 67 have one.

**Skipped:**
- `docs/cold-read-v030.md` and `docs/cold-read-v031.md`. Their findings are summarised in reviews.md.
- most of `act/proteus/*.js`, `act/mailbox.js` and `act/mail/*`.
- the bodies of the 29 test files.
- most of `act/CHANGELOG.md`, the `RESULTS-*.md` files and `SEALED-LIST_061126.md`.
- the bodies of the scenario files.
- the five `gen-suite*.py` generators. The previous two cold reads regenerated every scenario byte for byte, and I did not repeat that.
- `LICENSE`, beyond confirming that it is there.

**Ran (all on a copy in scratch, with Node v26.7.0 and Python 3.10.11 on macOS):**
- `shasum -a 256 -c lab/KERNEL-SHA256SUMS`: 36 of 36 OK.
- The fingerprint recipe (README.md:75): `2da6d5b99950…`, as stated.
- `node tools/name-hashes.js`: `NAME-HASHES PASS — 3 of 3`.
- `node examples/minimal-host.js`: the four lines the README shows, including `sha256` `097079ff4d28`. The file is 37 lines.
- `node examples/script-host.js`: the six lines proteus-k.md §7 shows, byte for byte apart from ids and the temp path.
- `npm test`: 381 tests, 381 pass, about 7 s.
- `npm run test:check`: `full run: 382 tests, 1 failed · skipping run: 381 … KERNEL TESTS PASS — 381/381`.
- `bash lab/lab-check.sh`: `LAB PASS — 12/12`, in about 13 s. I also ran `node lab.js run suites/edges 1` to see the ENV line, which named kernel `2da6d5b99950 (= the recorded copy of live 0.54.1)`.
- `bash lab/mutations/mutrun.sh <abs path> LIVE M1 … M15`: all 144 rows are identical to `RUNS-0538_091126.tsv` from line 2 on. Line 1 is `# lab 0.2.3 · kernel = 0.54.1 · …`, as README.md:174 says.
- The six `SEALED.json` sha prefixes against `lab/SEALS.md`'s new-seal column: all six match. The sha of `SEALED-LIST_061126.md` matches the one cited in `mutate.py`.
- The README's arithmetic:
  - The lab table's totals add up: 101, 62, 32 and 1.
  - The "41 files" of v0.3.3 (README.md:63) are consistent with the files: 36 files carry the new copyright line, 34 of them on the sums list and 2 tests. Only `targets.js` and `registry.spec.json` lack it.
  - The "20 findings" in reviews.md add up; the host-test count does not (finding 7).
- My own trials, following the docs:
  - A script with input and a `define`: works.
  - A dashed input name: approved, then refused (finding 2).
  - Three broken scripts: each approved with ✓ (finding 1).
  - host.md's three triggers through `make-registry.js`: all three approval lines are now correct, including `on message, topic inbox`.
  - One good and one bad trigger: the whole file refused (finding 5).
  - `trigger-off.js` against a running kernel:
    - with a real id, ✓, then `trigger-switched-off` and `trigger-skip … switched off` in the audit, with the state in `act-files/.scheduler/scheduler.json`;
    - with a mistyped id, exit 2 and `Loaded: hourly, evening, on-mail`;
    - with no scheduler state, exit 2.
  - The request `labels`, duplicate ids, the status codes 400/403/404/409/429, the taint refusal on `file-append`, and about ten grant refusals from host.md's tables: all as documented, except as noted in finding 8.
  - `send` and `messages` between two EUsers, with both grants: works (finding 11).
  - `saveGrants` with an unknown admin id (finding 9).
- Before writing this file, the sha256 of every file in the folder matched the list I took at the start. On the copy, nothing changed outside `lab/results/`.

**Could not run:**
- The git checks (README.md:60–63): there is no `.git` in this folder.
- `tools/check-byte-identity.sh`: it needs the private SYNTHEKOS repository.
- The Tier 2 real-model run: there is no model server on `localhost:11434`.
- Node 20 and Node 22, to check README.md:126's version statement: only Node 26 is installed here.
