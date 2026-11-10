# Cold read: ACTBUS v0.3.1

A first outside reader's report on this folder, the repository at tag v0.3.1. I used only what is in the folder: no web lookups, nothing about the project or its author. Every command that could write was run on a copy in my scratch directory. The folder itself is unchanged apart from this file (checked by sha256 of every file before and after).

**Bottom line.** Everything the README tells a reader to run that can run here works, and the output matches what the README says:
- `npm test`;
- `npm run test:check`;
- `lab/lab-check.sh`;
- `node tools/name-hashes.js`;
- `node examples/minimal-host.js`;
- the mutation harness: all 144 rows, and the whole file, are byte-identical to `lab/mutations/RUNS-0538_091126.tsv`.

The suite generators also reproduce every sealed scenario byte for byte. The weak points are elsewhere:
- **A host's contract is only half written down.** The request shape, the grant schema, the model-server protocol, the mail settings and the trigger file are described only in code comments, or not at all.
- **One documented control does not work for a real host.** `trigger-off.js` writes to the kernel's own folder, not to the host's `appDir`.
- **Some design-record statements are false for the code here.** These are the "world" field, the message-graph cycle check and the example scripts.
- **The git-based checks and the contact routes cannot be followed** from the tree. No repository address is given anywhere.

Findings are ordered roughly by how badly they mislead or block a stranger.

---

## Findings

1. **README.md:102** (with act/trigger-off.js:14, README.md:89)
   - Category: **false**
   - Exact text: "and `node act/trigger-off.js <id>` switches one trigger off."
   - Why it fails a stranger:
     - `trigger-off.js` writes to `path.join(__dirname, '..', 'act-files', '.scheduler', 'off')`. That is the folder that holds `act.js`, which is the default `appDir`, whatever the current directory is.
     - The README tells a host to pass its own `appDir` (README:89), and the kernel then reads `<appDir>/act-files/.scheduler/off` (act.js:357). For such a host the kill switch writes to the wrong place and does nothing.
     - It still prints `✓ my-trigger: switched off within 15 s if the server is running`.
     - **Ran (on a copy, from an unrelated folder):** exit 0, and the file appeared under the copy's own `act-files/`, not in the current folder or any `appDir`.
     - The script's own usage line (`cd <app folder> && node act/trigger-off.js`) suggests the current directory matters. It does not.
   - What the reader needs: say that the switch only works for the default `appDir`, or give the script an `appDir` argument. Also say that README:89's "kernel's own folder" means the repository root (the folder holding `act.js`), not `act/`.

2. **README.md:59** (and README.md:54, lab/TIER2-RESULTS_091126.md:42)
   - Category: **unfollowable**
   - Exact text: "are available to reviewers: ask in an issue on this repository. Security reports go through GitHub's private vulnerability reporting"
   - Why it fails a stranger: no file names the repository. There is no URL in the README, the docs or `package.json` (no `repository`, `bugs` or `homepage` field); I searched for `github.com` and `http(s)://` and found only the Apache licence URL. A reader who has the tree can't open an issue, report a vulnerability, or make "a clone" (README:54).
   - What the reader needs: the repository URL in the README and in `package.json` (`repository`, `bugs`).

3. **README.md:54**
   - Category: **unfollowable** (from this tree)
   - Exact text: "in a clone, `git rev-list --parents -n 1 v0.3.0 | wc -w` prints `1`."
   - Why it fails a stranger: this is listed under "What you can check from this repository alone", but the tree has no `.git`. **Ran:**
     - `git rev-list --parents -n 1 v0.3.0` → `fatal: not a git repository`;
     - `git diff --stat v0.3.0 v0.3.1 -- act.js act` → the same;
     - `bash tools/check-byte-identity.sh . . v0.53.8 v0.3.0` → `STOP: . has no tag v0.53.8`, exit 2.

     So of the four "check here" items, only the tests, the lab and `name-hashes.js` can be checked from the files themselves.
   - What the reader needs: list the git checks as "needs a clone of <URL>", apart from the checks that need only the files. A file-only check would help too, for example "`shasum -a 256 -c lab/KERNEL-SHA256SUMS` matches the 36 kernel files" (it does).

4. **docs/proteus-k.md:108**
   - Category: **false**
   - Exact text: `"world": <computed at load: true if it can reach any world action>`
   - Why it fails a stranger: a reader takes "computed at load" to mean "leave it out". The registry requires the field and refuses a mismatch (act/core/registry.js:62, :147). **Ran (on a copy):** a script entry written as §7 shows, without `world`, was refused: `registry entry "hello": world must be true or false`. With `"world": false` it loaded.
   - What the reader needs: "`world`: you must declare it; at load it is checked against what the script reaches, and a mismatch is refused". The example should also show `needs` and `acceptWarnings`.

5. **docs/capability-architecture.md:59 and :67**
   - Category: **unclear** (the examples don't run)
   - Exact text: `(every 3600 :as thoughts (email "owner@example.org" (model "<model>" "Write one random thought.")))`
   - Why it fails a stranger:
     - These read as PROTEUS-K, but they are pre-v0 sketches. `every` and `:as` are not forms: triggers live in `triggers.json`. Arguments are positional, while proteus-k.md §4 requires `:keyword` arguments. `read-rate` and `append-file` are not actions; the real ones are `read-number` and `file-append`.
     - **Ran:** the first line as a `.pk` script → `script hello.pk: no action named "every" (line 1:2)`.
   - What the reader needs: mark them as sketches, or rewrite them in v0 syntax with a pointer to the trigger file.

6. **docs/capability-architecture.md:103 and :108**
   - Category: **false** (for the code here)
   - Exact text: "Cycles in the static \"who may message whom\" graph are refused unless explicitly allowed."
   - Why it fails a stranger:
     - The only cycle check in the code is between script calls (act/core/registry.js:125-134). Nothing checks cycles in the `send`/`messages` grant graph. docs/functions-and-mailboxes.md:102 accepts the consequence: "Two daemons can ping-pong at up to 60 per hour."
     - Line 108's "static graph view, cycle-checked before anything runs" and "Explain this outcome" don't exist either.
     - The record's preamble says only §§7 and 12 report what was built, so a reader takes §9 as current.
   - What the reader needs: "designed, not built" on those rules, as §11 has.

7. **README.md:79–82**
   - Category: **missing**
   - Exact text: "What a host provides, all shown in the example:"
   - Why it fails a stranger: a host also has to do things that are neither listed nor shown:
     - call `act.stop()` (the example does, but it isn't listed);
     - wire `installShutdown({ stop, server })` from `act/shutdown.js`, so that script daemons are killed on SIGTERM, SIGINT or SIGHUP. Its header says that without it a busy daemon outlives the server, and the one test `npm test` leaves out exists to check this wiring;
     - call `clearForRoleChange(before, newRole, admin)` when a record stops being an EUser (28 Oct finding 5).

     `create()` returns about 20 members (act.js:461), and none of them is described.
   - What the reader needs: a short "what `create()` returns and what a host must call" list: `route`, `saveGrants`, `clearForRoleChange`, `stop`, `installShutdown`, `LOG`.

8. **README.md:80**
   - Category: **unclear**
   - Exact text: "`role` (`'euser'` for a machine identity; a person is a signed-in user or an admin), `auth`"
   - Why it fails a stranger:
     - The kernel treats a record as a person only if `role` is the string `'user'` or `'admin'` *and* `auth` is `'login'` or missing (act.js:89). Otherwise the grant's owner is refused with "is not a person". Neither literal is in the README, and `auth` is never explained.
     - `findMany` is called with a Prisma filter, `{ where: { actGrants: { not: null } } }` (act.js:244). A store that implements filters has to understand that one; the example ignores it.
   - What the reader needs: the exact values (`role: 'user' | 'admin' | 'euser'`, `auth: 'login' | 'key'`), and the `findMany` argument.

9. **README.md:82**
   - Category: **missing**
   - Exact text: "`{ \"owner\": \"<a person's loginId>\", \"actions\": { \"calc\": {} } }`"
   - Why it fails a stranger:
     - This is the only grant shown. The full schema is in act.js:84-136 and nowhere else: top-level `owner`, `actions`, `models`, `rate` (1–10000 per minute, default 120) and `operatedByPerson`; per action, `targets`, `allowTainted` and `strictControl`.
     - Each action has its own target syntax: a host, `http://host` or `:port` for fetch; an address on `MAIL_ALLOW` for email; identity names (`u-<uuid>`) for send and messages.
     - There are limits too: at most 50 actions and 8000 characters.
     - The return value (`{ ok, value, errors }`) isn't given either.
     - The threat model (README:174) relies on `strictControl` and `allowTainted`, but the README never says where they are written.
   - What the reader needs: a grant reference table, or a pointer to `parseGrants` in act.js.

10. **README.md:81**
    - Category: **missing**
    - Exact text: "`req.body` is `{ \"action\": \"…\", \"input\": { … } }`, with an optional `id`."
    - Why it fails a stranger:
      - `route` also accepts a caller-supplied `labels` list (at most 6) and adds it to the message (act.js:331, :342).
      - What answers come back isn't said either: HTTP 400/403/429/500/503, `Retry-After`, the error codes, and the default label a key holder's input gets.
    - What the reader needs: the full body shape including `labels`, and a table of status → code.

11. **README.md:92**
    - Category: **missing**
    - Exact text: "| `modelUrl` | none | the model server the model action calls; required when `models` is given |"
    - Why it fails a stranger:
      - The kernel speaks one specific API. It POSTs `{ model, prompt, system, stream: false, options: { temperature: 0.2 } }` to `<modelUrl>/api/generate` and reads `response` from the JSON reply, with a 115 s timeout (act.js:161-165).
      - Only lab/TIER2-RESULTS_091126.md:45 names the server ("Ollama"). A host with another server can't tell what to expose.
    - What the reader needs: the endpoint, request body and reply field, and the server it was built for.

12. **README.md:96**
    - Category: **missing**
    - Exact text: "| `env` | `process.env` | mail settings (`MAIL_ALLOW`, SMTP) and `PK_DAEMON` |"
    - Why it fails a stranger:
      - The SMTP variables are named only in a comment in act/mail/smtp.js:14: `MAIL_HOST`, `MAIL_USER`, `MAIL_APP_PASSWORD` and `MAIL_FROM` (all four needed), plus `MAIL_PORT` (default 587) and `MAIL_HELO`.
      - `MAIL_ALLOW`'s format isn't given anywhere: addresses separated by whitespace, `,` or `;` (act/mail/outbox.js:28).
      - Nothing says that with no settings, mail stays queued.
    - What the reader needs: those names, the defaults and the "no settings = delivery off" rule.

13. **README.md:99**
    - Category: **missing**
    - Exact text: "| `triggersFile` | `<actionsDir>/triggers.json` | the approved triggers; no file, nothing is scheduled |"
    - Why it fails a stranger:
      - No document gives the trigger format, or says how the file is made: `make-registry.js` writes it from `triggers.spec.json` (act/make-registry.js:27-30).
      - The format is only in act/scheduler.js:6-21 (`id`, `script`, `runsAs`, one of `every`/`at`+`tz`[+`days`]/`on:"message"`+`topic`, plus `missed`, `input`) and its validator (scheduler.js:77-102).
      - functions-and-mailboxes.md:78 shows only the on-message form.
    - What the reader needs: the trigger schema and the make-registry step, in a doc or the README.

14. **README.md:84–101** (the `create()` table) and the whole README
    - Category: **missing**
    - Exact text: "| `actionsDir` | `act/actions` | the registry and action files |"
    - Why it fails a stranger: the README never lists the 11 registered actions or their inputs. Without that a host can't write a request beyond the example's `calc { expr }`. The list is: `calc {expr}`, `units {value,from,to}`, `date-diff {from,to,weekday?}`, `model {model,prompt,system?}`, `fetch {url}`, `file-append {name,text}`, `file-read {name}`, `read-number {text,after?}`, `email {to,subject,text}`, `send {to,topic,body}`, `messages {topic,ack?,hold?}`. The README also doesn't say which of them are world actions; the information is only in `registry.spec.json`.
    - What the reader needs: a table of actions: input, `produces`, world or not, target form.

15. **docs/proteus-k.md:119**
    - Category: **unclear** (a step that silently breaks what the README asks you to trust)
    - Exact text: "An administrator writes the entry into `act/actions/registry.spec.json`, puts the `.pk` file next to it, and runs `node act/make-registry.js act/actions`"
    - Why it fails a stranger:
      - Doing exactly this edits kernel files. `registry.spec.json` is part of the kernel fingerprint (lab/KERNEL-SHA256SUMS:10), and `registry.json` is rewritten.
      - **Ran (on a copy):** `make-registry.js act/actions` rewrote `registry.json` with a new `approved` time (`2026-11-06T17:32:40.295Z` → today); every hash was the same.
      - After that, the lab's ENV line says "NOT the live copy", and the byte-identity claims stop holding.
    - What the reader needs: a host should copy the actions into its own folder and pass `actionsDir`, which is what lab.js does. Say so in the example.

16. **lab/mutations/README.md:7 and README.md:165–168** (with lab/mutations/mutrun.sh:6, :8)
    - Category: **unclear**
    - Exact text: "To run: from the repository root, `bash lab/mutations/mutrun.sh <out.tsv> LIVE M1 … M15`"
    - Why it fails a stranger:
      - `mutrun.sh` does `cd` into `lab/` before it opens `<out.tsv>`, so a relative path is resolved against `lab/`, not against the root the reader was told to run from. **Ran (on a copy):** `mutrun.sh ../runs.tsv …` from `repo/` wrote `repo/runs.tsv`, inside the repository, not next to it.
      - The script also *appends* (mutrun.sh:6). A second run doubles the rows, and the README's compare step then fails. The README never says this.
    - What the reader needs: "give an absolute path to a file that does not exist yet".

17. **lab/mutations/SEALED-LIST_061126.md:16** vs lab/mutations/mutate.py ('M10')
    - Category: **unclear**
    - Exact text: "| M10 | eval, strictControl | condition's labels not joined into branch outputs | suite 2 strictControl test |"
    - Why it fails a stranger:
      - The sealed list describes M10 as a change in the evaluator. The mutant actually run is in the bus: `const ctlTaint = [];` ("strictControl does nothing").
      - M3 is also broader as built: the sealed "replace/trim/str" became trim/upper/lower, replace, str and join.
      - The README presents the 15 mutations as "the second reader's sealed mutations". lab/mutations/README.md:6 explains the mode-B difference but not these.
    - What the reader needs: a note mapping each sealed description to the replacement that was run, and saying which ones differ.

18. **lab/mutations/RESULTS-0537-cleanup-words.md:31** (and lab/mutations/mutrun.sh:4)
    - Category: **false**
    - Exact text: "(the repo is never changed; mutants live in a temp folder)"
    - Why it fails a stranger: every run writes into `lab/results/`. **Ran:** the copy had 156 result folders and 5712 files after the lab check and the mutation run. This was finding 8 of the v0.3.0 cold read. docs/reviews.md:286 says the `mutrun.sh` comment waits for a lab release, but nothing mentions this RESULTS file, which is the reproduce line a reader is most likely to copy.
    - What the reader needs: the README:168 wording, "the kernel files are never changed; results go to `lab/results/`".

19. **README.md:193**
    - Category: **unclear** (it claims more than reviews.md does)
    - Exact text: "reported 30 findings; `v0.3.1` settles them"
    - Why it fails a stranger: docs/reviews.md:286-287 says findings 27 and 28, and part of 8, *wait* for later releases. lab/lab.js:1 still says "Boots the REAL kernel (./kernel = a read-only copy of live", and there is no `./kernel`.
    - What the reader needs: "settles 27 of them; three wait (reviews.md)".

20. **README.md:214** (act/CHANGELOG.md:19–27)
    - Category: **false** (miscounted)
    - Exact text: "**Five `act.js` entries in `act/CHANGELOG.md` have no text,**"
    - Why it fails a stranger:
      - I count six: v1.6.0 and v1.5.0 (each ends in a colon), v1.4.0, and three "Kept from v1.x.0" lines.
      - Many other files' entries are only a version and a date, for example `## act/actions/calc.js` → `- v1.0.0 (281028)`.
      - README:41 calls the changelog "the version history of every kernel file". For those files it holds no history.
    - What the reader needs: the right count, and a note that many early entries are bare.

21. **act/CHANGELOG.md** (e.g. :26, and the `281028` stamps)
    - Category: **unclear**
    - Exact text: "- Kept from v1.1.0 (SYNTHEKOS v0.48.0 · 281028)"
    - Why it fails a stranger:
      - The 6-digit dates (`061126`, `091126`) are never explained. They read as DDMMYY.
      - Under that reading, `281028`, which occurs 14 times with no `281026` anywhere, is 28 Oct **2028**, although the text means 28 Oct 2026 (README, docs/reviews.md "28 Oct").
      - `capcore-281028` (CHANGELOG:15) is never defined either.
    - What the reader needs: one line at the top giving the date format, and the 2028-looking stamps explained or corrected.

22. **README.md:1**
    - Category: **unclear**
    - Exact text: "SYNTHEKOS, a private, fully offline AI appliance."
    - Why it fails a stranger: the kernel ships a `fetch` action to web hosts and an SMTP mail client, and the threat model is about web text. "Fully offline" contradicts that, and the reader can't tell what is offline: the model? everything unless granted?
    - What the reader needs: say what "offline" means here, e.g. "the model runs locally; the web and mail are reached only through granted actions".

23. **README.md:29** (with package.json:2)
    - Category: **unclear**
    - Exact text: "The SYNTHEKOS appliance and the SYNTHEKOS name are not in it."
    - Why it fails a stranger: the name is everywhere, including the package name `@synthekos/actbus`, the README, docs and tests. The sentence presumably means "the name is not licensed under Apache-2.0", but it says the name is absent.
    - What the reader needs: "The SYNTHEKOS name is not licensed by this repository" (or whatever is meant).

24. **README.md:65**
    - Category: **unclear**
    - Exact text: "a sha256 over every kernel `.js` file and the registry spec"
    - Why it fails a stranger: a reader can't recompute `0323a6a4c26e` from this sentence. It leaves out `act/test/`, the exact input format, and that `registry.json` is not covered. Reading lab.js:157-160 shows how; I reproduced it from the sums file:
      `awk '{sub(/^\.\//,"",$2); print $2" "$1}' lab/KERNEL-SHA256SUMS | LC_ALL=C sort | perl -pe 'chomp if eof' | shasum -a 256` → `0323a6a4c26e…`.
    - What the reader needs: that recipe, or "see lab.js:157-160", plus "`act/test/` and `registry.json` are not covered".

25. **README.md:7–17**
    - Category: **unclear**
    - Exact text: "passes the same checks, in the same order (the order of `act/core/bus.js`), before anything runs:"
    - Why it fails a stranger:
      - The list matches bus.js:120-166 as far as it goes, but it leaves out the bus's hop limit (bus.js:152, :208) and the route check (bus.js:145).
      - An HTTP request first passes act.js's own checks (act.js:321-342): a per-EUser rate limit that is *not* audited, the body shape, the `labels` list, and escalation. So "every request … the same checks" is true of the bus only.
    - What the reader needs: "the bus's checks, in order; HTTP requests are first checked by `route` in act.js (…)".

26. **README.md:218**
    - Category: **false** (incomplete)
    - Exact text: "One line of `act.js` (its table of renamed options) and three of `act/test/product.test.js` name the removed option `ollamaUrl`"
    - Why it fails a stranger: `act/CHANGELOG.md` names it too, on lines 14, 16, 290, 291 and 358. The sentence is offered as the complete list of what remains.
    - What the reader needs: add "and five changelog entries".

27. **lab/TIER2-RESULTS_091126.md:10**
    - Category: **false** (a dead pointer)
    - Exact text: "tag `v0.2.5` of the private predecessor repository (commit `3c41b57`; README, \"What you can check here\")"
    - Why it fails a stranger: the README section it points to doesn't mention `3c41b57` or `v0.2.5`.
    - What the reader needs: drop the pointer, or add the commit to the README's History paragraph.

28. **lab/EXPECTED-RESULTS.txt:1**
    - Category: **false**
    - Exact text: "measured 2026-11-09 on this repo's act/ at v0.2.3"
    - Why it fails a stranger: README:59 says `v0.2.3` is a tag of the private predecessor repository, not this one. v0.3.1 fixed the same contradiction elsewhere (v0.3.0 finding 1), but not here.
    - What the reader needs: "the predecessor repository's v0.2.3".

29. **docs/capability-architecture.md:51**
    - Category: **false** (minor)
    - Exact text: "at a calendar time (date, time and time zone);"
    - Why it fails a stranger: an `at` trigger takes `HH:MM`, `tz` and an optional `days` (act/scheduler.js:97-101). There is no date: nothing can fire once on a given day.
    - What the reader needs: "at a time of day, in a time zone, on chosen weekdays".

30. **docs/capability-architecture.md:32** (and :10)
    - Category: **false** (minor)
    - Exact text: "Paths, hosts and addresses are allow-listed per identity."
    - Why it fails a stranger: paths are not allow-listed. `file-append` and `file-read` have no `targetForm`, so a grant that lists targets for them is *refused*, at save and at load (act.js:386, :262-263). They are confined to the identity's own folder instead (line 26 says so correctly).
    - What the reader needs: "hosts and addresses are allow-listed per identity; files are confined to the identity's own folder".

31. **README.md:21**
    - Category: **unclear** (claims more than the test shows)
    - Exact text: "`act/test/temperature.test.js` fails if any input field, `create()` option or environment variable could change it."
    - Why it fails a stranger: the test tries named cases: four environment variables (`TEMPERATURE`, `MODEL_TEMPERATURE`, `ACT_TEMPERATURE`, `PK_TEMPERATURE`; temperature.test.js:55), a set of input fields, and a source check. A test can't show "any". The real guarantee is structural: the value is a literal at act.js:163, `create()` refuses unknown options, and the kernel reads no such variable.
    - What the reader needs: state the structural reason, and describe the test as examples of it.

32. **docs/reviews.md:10**
    - Category: **missing** (it belongs under "take on trust")
    - Exact text: "Unless a test is marked *guard*, its file records that it fails on the code before the fix."
    - Why it fails a stranger: the code before each fix is not in this repository, so "fails on the old code" can't be checked here. It is a record, not something a reader can reproduce. README:50-57 doesn't list it among the things taken on trust.
    - What the reader needs: add it to README's "What you take on trust".

33. **README.md:63**
    - Category: **unclear** (minor)
    - Exact text: "some with a suffix that names a comment-only or names-only release (`-headers`, `-changelog`, `-purpose`, `-docrefs`, `-cleanup`)"
    - Why it fails a stranger: docs/reviews.md:251 names a sixth suffix, `v0.53.7-temperature`, which was a *test-only* release. It fits neither the list nor its description.
    - What the reader needs: add `-temperature` ("test-only").

34. **README.md:31**
    - Category: **unclear** (minor)
    - Exact text: "The two JSON files in `act/actions/` cannot carry a comment; `LICENSE` and `NOTICE` cover them."
    - Why it fails a stranger: it implies every other file carries the SPDX line. These don't: `act/CHANGELOG.md`, `docs/cold-read-v030.md`, `lab/EXPECTED-RESULTS.txt`, `lab/KERNEL-VERSION.txt`, `lab/mutations/SEALED-LIST_061126.md`, the eight `RUNS-*.tsv` files and the roughly 100 scenario JSONs. `docs/cold-read-v030.md` is a report written by another session, so its licence status is the one a reader would most want stated.
    - What the reader needs: "LICENSE covers every file; files that cannot or do not carry the line are …".

35. **README.md:71–77**
    - Category: **unclear** (minor)
    - Exact text: "HTTP 200 {\"ok\":true,\"id\":\"…\",\"trace\":\"…\",…"
    - Why it fails a stranger: **Ran:** the output matched, apart from the elided ids. But the example prints a fourth line, `audit log: /var/folders/…/actbus-host-XXXX/logs/act.jsonl`, which the README doesn't show. The temp folder is also never removed (one is left behind per run).
    - What the reader needs: show the fourth line, and say that the temp folder is kept so the log can be read.

36. **docs/proteus-k.md:26**
    - Category: **unclear** (minor)
    - Exact text: "string  := \"…\" with \\\" \\\\ \\n \\t only;  ≤ 64 KB after decoding"
    - Why it fails a stranger: the source limit is 16 KB (line 33; reader.js:15), so a 64 KB string literal is impossible. The reader can't tell whether the 64 KB limit applies elsewhere, for example to runtime strings.
    - What the reader needs: say what the 64 KB bounds, or drop it from the grammar.

---

### Claims I checked and found true
- README:21: temperature `0.2` is at act.js:163.
- README:7-17: the list's order matches act/core/bus.js:120-166.
- docs/kernel-flow.svg: its labels follow the same order, and its numbers match the code (trace budget 64, bus.js:53).
- README:41: every `.js` file under `act/` and `act.js` has a line-1 header (line 3 after a shebang) with a version and a `CHANGELOG.md#…` anchor. I checked all of them by script.
- README:55: `node tools/name-hashes.js` → `NAME-HASHES PASS — 3 of 3`, and the tool's values equal the README's.
- README:65: the ENV line of every lab run reads `kernel 0323a6a4c26e (= the recorded copy of live 0.53.8)`. `shasum -c lab/KERNEL-SHA256SUMS` matches all 36 files.
- README:106: the refused-option rules are as described (act.js:146-151).
- README:136-146: every RESULT line, in process and in daemons, equals `lab/EXPECTED-RESULTS.txt`.
- README:158-160: all 144 mutation rows are byte-identical to `RUNS-0538_091126.tsv` (the whole file is, header included).
- lab/mutations/README.md:5: the sha256 of `SEALED-LIST_061126.md` is `42e73dce…6d74`, as cited.
- lab/SEALS.md: the newest seal of each suite equals the sha256 of its current `SEALED.json` (`e85897a2a224`, `183932cc9bab`, `47ad4e16855d`, `d84f610f6b6d`, `e0c5cd60ce0e`, `169391e56497`).
- lab/SEALS.md:20, :31: running all five `gen-suite*.py` (on a copy, Python 3.10) regenerates every scenario of the five suites byte-identical to the sealed files.
- docs/proteus-k.md and docs/functions-and-mailboxes.md: these limits match the code:
  - source 16 KB, depth 64, 4000 forms;
  - mailbox: 60 sends per hour, 16 KB body, 20 per read, 10 min claim, 100 dead;
  - 64 functions and 8 arguments.
- capability-architecture.md:36: 31 Oct 2026 is a Saturday. 8 192 bits is `MAX_BITS` in both `rational.js` copies.

---

## What I read
- **In full:**
  - `README.md`, `package.json`, `.gitignore`, `NOTICE`;
  - `docs/capability-architecture.md`, `docs/proteus-k.md`, `docs/functions-and-mailboxes.md`, `docs/reviews.md`, `docs/cold-read-v030.md`;
  - `examples/minimal-host.js`;
  - `tools/kernel-test-check.sh`, `tools/check-byte-identity.sh`, `tools/name-hashes.js`;
  - `lab/lab-check.sh`, `lab/EXPECTED-RESULTS.txt`, `lab/KERNEL-VERSION.txt`, `lab/KERNEL-SHA256SUMS`, `lab/SEALS.md`, `lab/TIER2-RESULTS_091126.md`;
  - `lab/mutations/README.md`, `SEALED-LIST_061126.md`, `RESULTS-0537-cleanup-words.md`, `mutrun.sh`, `mutate.py`;
  - `act/trigger-off.js`.
- **In part:**
  - `act.js`: the header, lines 77-240 and 240-465 (grants, `create()`, identities, `route`, triggers, exports);
  - `act/make-registry.js`: lines 1-30;
  - `act/scheduler.js`: header and `validate`;
  - `act/shutdown.js`: header;
  - `act/core/registry.js`: header, world and cycles;
  - `act/core/bus.js`: refusals, by grep;
  - `act/mail/smtp.js` and `outbox.js`: the env settings and `parseAllow`;
  - `act/proteus/reader.js`: limits;
  - `act/actions/date-diff.js`: header;
  - `act/actions/registry.spec.json`, via a script;
  - `act/CHANGELOG.md`: lines 1-40, plus greps;
  - `lab/lab.js`: lines 1-120 and the run/fingerprint part;
  - `act/test/temperature.test.js`, by grep;
  - `docs/kernel-flow.svg`: its text and title;
  - the headers of `lab/timeline.js` and the generators.

## What I skipped
- Most kernel source: `act/proteus/eval.js`, `engine.js`, `state.js`, `act/mailbox.js`, `act/daemon/*`, most of `act/actions/*` and `act/core/*`, and the rest of `act/CHANGELOG.md`.
- The test files, apart from the greps above. I ran them; I didn't read them.
- The other `RESULTS-*.md` and `RUNS-*.tsv` files.
- `lab/timeline.js` beyond its header.
- The scenario JSONs. Their sha256s and the generators' output were checked, but not their content.
- `LICENSE` beyond its header.
- This is a documentation read, not a security review of the code.

## What I ran
macOS (Darwin 24.6.0), Node v26.7.0, Python 3.10.11. Commands that could write were run on copies in my scratch directory (`repo/`, `mr/`, `pk/`, `gen/`). The original folder was hashed before and after, and is unchanged apart from this file.

| Command | Where | Result |
|---|---|---|
| `npm test` | copy | exit 0: `tests 371 · pass 371 · fail 0 · skipped 0`, about 7 s |
| `npm run test:check` | copy | exit 0: `full run: 372 tests, 1 failed · skipping run: 371 tests, 371 passed, 0 failed` → `KERNEL TESTS PASS — 371/371`, 14 s |
| `bash lab/lab-check.sh` | copy | exit 0: 12 × `ok` → `LAB PASS — 12/12 suite runs exactly as recorded`, 13 s. It wrote only under `lab/results/`. |
| `node lab/lab.js run suites/edges 1` | copy | ENV `kernel 0323a6a4c26e (= the recorded copy of live 0.53.8)`; RESULT equal to EXPECTED |
| `bash lab/mutations/mutrun.sh ../runs.tsv LIVE M1 … M15` | copy | exit 0, 2 min 14 s. The file landed in the copy's root (finding 16); its 146 lines are identical to `RUNS-0538_091126.tsv` |
| `node examples/minimal-host.js` | copy | 403 NOT_PERMITTED → `grant saved: true` → 200 `{"result":"42",…,"sha256":"e54fbc35e393"}` → `audit log: …` (finding 35) |
| `node tools/name-hashes.js` | copy | `NAME-HASHES PASS — 3 of 3 equal the published values` |
| `git rev-list --parents -n 1 v0.3.0`; `git diff --stat v0.3.0 v0.3.1 -- act.js act` | this folder (read-only) | `fatal: not a git repository`: there is no `.git` (finding 3) |
| `bash tools/check-byte-identity.sh . . v0.53.8 v0.3.0` | this folder (read-only) | `STOP: . has no tag v0.53.8`, exit 2. It needs the private SYNTHEKOS repository and a clone |
| `shasum -a 256 -c lab/KERNEL-SHA256SUMS`; fingerprint recipe (finding 24); sha256 of the sealed list and of each `SEALED.json` | this folder (read-only) | all as recorded |
| `node act/make-registry.js act/actions` | copy | 11 actions, same hashes; `registry.json` rewritten with a new `approved` time (finding 15) |
| the proteus-k.md §7 registration with a one-line script; then the capability-architecture §6 thought-mail line as a script | copy, own `actionsDir` | without `world`: refused (finding 4); with `world: false`: loaded; thought-mail: `no action named "every"` (finding 5) |
| `node act/trigger-off.js my-trigger` from an unrelated folder | copy | `✓ … switched off`; the file was written under the copy's own `act-files/` (finding 1) |
| `python3 -I lab/gen-suite{1..5}-*.py` | copy | all exit 0. Every regenerated scenario is byte-identical to the sealed one |

**Not run:**
- the Tier-2 real-model command (TIER2-RESULTS:47): there is no model server or models here, and getting them would mean leaving the folder;
- `npm run lab`: it is an alias of `lab-check.sh`, which I ran;
- SYNTHEKOS's own checks and host tests: they are not in this repository.

**Left outside the folder:** the example, my host scripts and the lab each leave temp folders under the OS temp directory (`actbus-host-*`, `lab-*`, `pk-*`, `ns-*`). They are created by the documented commands and never removed.
