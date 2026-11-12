# Cold read of ACTBUS v0.3.5 (scoped)

This is a first outside read of the folder as given: the `v0.3.5` tree, with no `.git`, read with nothing from outside it. The scope was the dedupe change and its tests, the lines this release changed, and every sentence that states one of the listed values. I checked every claim below against the code, or against a trial I ran on a copy in my scratch folder. This file is the only change I made to the folder.

**Summary.** The fix holds where the tests look. At the cap a new id is refused, nothing is forgotten, the 503 and its `Retry-After` agree with `retryAfterMs`, and a second identity is not touched. Everything the scoped text says to run worked and printed what it says it prints. The findings are about what a caller is told around the edges of the fix:
- a 503 `DEDUPE_FULL` sometimes keeps the caller's id, and the reply does not say which kind it is;
- a native action can turn work it has already done into a "transient, nothing ran" 503;
- one memory figure is too low;
- an empty `id` is silently replaced;
- the cap is shared by everyone who calls a script.

## Findings

1. **docs/host.md:86** · **false** · "A `DEDUPE_FULL` refusal of the caller's own identity is made at the dedupe check and does not keep the id"
   - **Why it fails a stranger:** a script runs as its `runsAs` identity, and that identity can be the caller itself: an EUser that holds its own script, or the shape every trigger uses (host.md:131–136). Then the script pre-check (`act/core/bus.js:236–237`) refuses the caller's own identity *after* the dedupe check has stored the id (`bus.js:145–146`). I gave identity `ue` a cap of 3 and sent 2 ids. Its call to its own script with id `X` answered `DEDUPE_FULL`, transient. The same `X` sent again answered 409 `DUPLICATE`, not the retry this sentence promises.
   - **What the reader needs:** "a refusal made at the dedupe check keeps no id; one made by the script pre-check, or by a script's first action call, has used the id, even when the script runs as the caller".

2. **docs/host.md:86–87** · **missing** · "A transient refusal after the dedupe check has consumed the caller's id; retry with a new id"
   - **Why it fails a stranger:** a caller that gets 503 `DEDUPE_FULL` cannot tell which of the two bullets applies. The reply's fields are the same in all three cases: `code`, `transient` and `retryAfterMs`. Only the free text of `error` differs:
     - "… none can be forgotten yet": the id was not kept;
     - "… the identity the script … runs as …": the id was kept;
     - "… did not run: DEDUPE_FULL": the id was kept.

     I checked this for a service script `svc` that other callers had filled, in-process and in a daemon. A new id `Y` got 503, and `Y` again got 409. A client that follows bullet 86 gets 409 and can wrongly decide its request ran.
   - **What the reader needs:** a field in the reply, such as `idKept: true|false`, or a rule a client can follow without parsing English. For example: "after any 503, retry with a new id: nothing ran, so a new id cannot repeat an action".

3. **docs/host.md:87** (with :186 and `act/core/bus.js:261`) · **false** · "nothing ran, so a new id cannot repeat an action."
   - **Why it fails a stranger:** the bus marks *any* action's thrown error as transient when the error has `transient: true` and a code from the list (`bus.js:261`, `:266`). The GUARD test covers only daemons (`act/test/transient.test.js:93`). I wrote a native action that:
     - writes a file;
     - calls `calc` through `ctx.send`;
     - when the reply is refused, throws it as its error (`throw Object.assign(new Error(r.error), r)`).

     At the cap, the call answered 503 `DEDUPE_FULL`, `transient: true` and `Retry-After: 86400`. The file had been written, and the audit shows `relay:run`. host.md:186 says only "a daemon's transient code keeps that code", which reads as if native actions cannot do this.
   - **What the reader needs:** "a native action must not rethrow a reply it got from `ctx.send`: an error with `transient: true` and one of the six codes answers 503, even after the action has acted". Or a bus that honours `transient` only from the script engine.

4. **docs/host.md:89** · **false** · "A `remember` before the first action call stands, and a retry writes the same value again."
   - **Why it fails a stranger:** a retry runs the script again from the start, on the state the refused run left behind. I used `(do (remember n (+ 1 (if (remembered n) (remembered n) 0))) (calc …))` with a cap of 1 and two concurrent callers. One ran and the other got 503 `DEDUPE_FULL`, but both remembers stood, so `n` was 2. The retry after the window wrote 3, not "the same value". The engine's comment (`act/proteus/engine.js:112–113`, "Only when it was the script's FIRST action call can nothing the script did have happened") says the same thing more strongly.
   - **What the reader needs:** "state written before the first action call stands, even on a 503; a retry runs the script again on that state (a counter counts twice)".

5. **docs/host.md:85** · **false** · "At the 80-unit bound an id costs at most about 196 bytes, about 9.8 MB per identity at the cap."
   - **Why it fails a stranger:** I used the page's own method (heap with 50 000 ids held, less the heap with them dropped, over 50 000) on Node v26.7.0, the same version. An 80-unit id of two-byte characters (40 emoji, the page's own example, or 80 Cyrillic letters) cost **229 bytes, 11.4 MB** per identity, both through a plain `Map` and through the bus's `seen` map. The results were the same on two runs. An 80-character ASCII id cost 149 bytes and a 36-character UUID 109 bytes (5.4 MB), so "about 100 bytes … about 5 MB" holds. My machine may not be SYNTHEKOS's host machine, but V8 stores a string with any character above U+00FF at two bytes per unit, and "at most" does not depend on the machine.
   - **What the reader needs:** the worst case measured with two-byte ids (about 230 bytes and 11.5 MB here), or the 196 figure labelled as one-byte ids only.

6. **docs/host.md:84** · **false** (an edge the range hides) · "An `id` or a `trace` is a string of 1–80 UTF-16 code units"
   - **Why it fails a stranger:**
     - An `id` of `""` is not refused. `route` passes it on (`act.js:346`), and `envelope.root` replaces it with a new UUID (`id || newId()`). Two requests with `"id": ""` both ran (200, 200), with different ids, so a client that sends `""` gets no duplicate check at all.
     - A host cannot set `trace` at all: `route` always makes a fresh one (`act.js:345`). Only the bus and the test edge take one.
     - The refusal for 41 emoji says "id must be a string of 1–80 characters" (`envelope.js:30`), although 41 emoji are 41 characters as a person counts them.
   - **What the reader needs:** "an empty `id` is treated as no `id`: the kernel makes one, and the request is not protected against repeats"; "`trace` is set by `route`"; and "characters" in the message explained as UTF-16 units.

7. **docs/host.md:83** · **missing** · "So an identity can send at most 50 000 ids in any 24 h, a sustained average of about 35 a minute"
   - **Why it fails a stranger:** 50 000 / 1 440 minutes is 34.7, so the arithmetic holds. But "ids" covers more than requests:
     - every action call a script makes is a message with an id of the script's `runsAs` identity;
     - every `ctx.send` of a native action uses an id of the identity it runs as.

     So a script that the EUser runs as itself spends 1 + N ids per run. The cap is also shared: a service script's identity is filled by all its callers together. I had three callers fill `svc` (cap 3), and a fourth caller with its own empty set got 503 `DEDUPE_FULL` for about 24 h. So one caller can deny a shared script to every other caller for up to a day. The GUARD test "one identity at the cap neither blocks nor flushes another" (`act/test/dedupe-full.test.js:81`) is true only for root messages.
   - **What the reader needs:** "child calls count against the identity they are sent as; a script's identity is shared by all its callers, so one caller can fill it for everyone (rate limits are per caller, the cap is per script)".

8. **docs/host.md:88** · **missing** · "a 422 naming `DEDUPE_FULL` means it did, and what it did stands."
   - **Why it fails a stranger:** the 422 carries neither `retryAfterMs` nor `Retry-After` (`bus.js:266` keeps them only for a transient refusal, and `act.js:350` sets the header only for a transient one). A caller learns that the script's identity is full, but not when it frees. A retry before then is refused, now as 503 before the script starts. The pre-check is also not the only gate: two concurrent calls both pass it, and the second is refused at its first action call, still 503 (`dedupe-full.test.js:200`; I saw the same in-process).
   - **What the reader needs:** "a 422 naming `DEDUPE_FULL` has no `retryAfterMs`; send the request again (with a new id) to learn it". Or the bus could keep `retryAfterMs` on that 422.

9. **docs/host.md:65** · **unclear** · "`"retryAfterMs"`: the milliseconds until the identity can be served again."
   - **Why it fails a stranger:** "the identity" is the caller's own only for a refusal at the dedupe check. For a script refusal it is the script's `runsAs` identity (my `svc` trial: 86 399 998 ms for `svc`, while the caller's own set held one id). And "served again" means one slot frees, which any caller of that identity may take first.
   - **What the reader needs:** "until one id of the identity named in `error` leaves the window; another request may take that slot first".

10. **docs/host.md:83** (with `act/test/dedupe-full.test.js:142`) · **missing** · "At that cap a new id is refused 503 `DEDUPE_FULL` until the identity's oldest id leaves the window"
    - **Why it fails a stranger:** a time trigger whose `runsAs` identity is full does not wait for that time. The scheduler ignores `retryAfterMs`, retries at 5 s and 30 s, and then the fire is `trigger-lost` (the test asserts exactly this). An administrator reading "The dedupe check" or "Triggers" is not told that a full identity loses its scheduled fires for up to 24 h.
    - **What the reader needs:** one sentence under either heading: "a fire refused `DEDUPE_FULL` is retried at 5 s and 30 s and then lost (audited `trigger-lost`); the next period fires as usual".

11. **README.md:248** · **unclear** · "ids past the window not dropped before the cap is counted, so an identity at the cap is locked out for good"
    - **Why it fails a stranger:** it held: `npm test` does not catch it. But two lines drop ids by age: `bus.js:101` (in `dedupeFull`) and `bus.js:141` (in `dispatch`).
      - Removing `:141` alone changes nothing, because `dedupeFull` drops them anyway.
      - Removing both is caught (the "ageing out" test fails).
      - Removing only `:101` passes all 404 tests, and the lock-out it causes is on the script pre-check path only. With a script identity filled at cap 2, the original bus ran the script 25 h later; with that mutation it answered `DEDUPE_FULL` 25 h and 31 days later.

      A reader cannot tell which line the sentence means, nor that the request path is still safe under it.
    - **What the reader needs:** "removing the age drop in `dedupeFull` (`bus.js:101`): a script whose identity reached the cap is refused at the pre-check for good".

12. **README.md:248** with **act/test/dedupe-full.test.js:136** · **unclear** · "no floor of 1 s on `Retry-After`"
    - **Why it fails a stranger:** it held: with `Math.max(1, …)` removed from `edge.js:18`, all 404 tests pass. But the test that claims to check the floor cannot:
      - it sends `retryAfterMs: 1`, and `Math.ceil(1/1000)` is already 1 without the floor;
      - through the bus the floor is never reached at all, because `retryAfterMs` is at least 1 ms (`bus.js:103`, and the strict window test), so `Math.ceil(ms/1000)` is at least 1.

      Only a hand-made reply shows the difference: `retryAfterMs: 0` gives `1` in the original and `0` in the mutant. So the assertion message "at least 1" reads as coverage that is not there.
    - **What the reader needs:** the test to use `retryAfterMs: 0` (or a negative value), and the Known-gaps line to say that the floor guards against a value the bus cannot produce today.

13. **README.md:249** · **missing** · "a reader that splits the audit log with Python's `splitlines()` sees a record broken at U+2028, U+2029 or NEL"
    - **Why it fails a stranger:** the claim held. Seven audit lines with ids holding U+2028 and NEL split into 18 pieces under `splitlines()`, and 16 of them do not parse. Split on `\n`, all 7 parse, and the injected `{"forged":1}` stays escaped inside a string, so no forged record appears. U+202E is written raw. But the audit is not the only place these characters land:
      - the HTTP reply echoes the id raw (I checked U+2028, U+202E and U+0085 in the body);
      - through the test edge, `trace` repeats it;
      - the `reason` of a `DUPLICATE` refusal repeats it;
      - `.dedupe.jsonl` holds it too.

      A host that shows replies or logs them line by line has the same problem.
    - **What the reader needs:** "the id is echoed raw in the reply, in `trace` when the caller did not set one, in refusal reasons and in `.dedupe.jsonl`, as well as in the audit".

14. **README.md:246** · **unclear** · "apart from the first measurement (9 Nov, `v0.53.7-cleanup`, Node 22.23.4), whose machine this repository does not record"
    - **Why it fails a stranger:** this release's fix for the fifth read's #4 names the first measurement as 9 Nov. Higher up, README.md:164 says "identical to the first measurement, on 7 Nov at SYNTHEKOS `v0.53.5-headers`". That 7 Nov run is not in the list, and its machine is not recorded either. So there are two "first measurements" and two runs with no machine. The fifth read's #5 (still open) is the same ambiguity, and the new sentence makes it sharper.
    - **What the reader needs:** "apart from the 7 Nov (`v0.53.5-headers`) and 9 Nov (`v0.53.7-cleanup`, Node 22.23.4) measurements, whose machine is not recorded".

15. **README.md:77** · **unclear** (minor) · "it prints one `ok` or `FAIL` line per suite run and a last line, `LAB PASS` or `LAB FAIL`"
    - **Why it fails a stranger:** a `FAIL` is followed by `want:` and `got:` lines, or by the last 5 lines of the run (`lab/lab-check.sh:18–19`). A `STOP: …` line ends the script with exit 2 and no last line (`:9`, `:10`, `:14`, `:21`). A wrapper that waits for `LAB PASS`/`LAB FAIL` hangs or misreads a STOP. The run here printed 12 `ok` lines and `LAB PASS — 12/12 suite runs exactly as recorded`, as written.
    - **What the reader needs:** "…or a `STOP` line and exit 2 if it cannot start".

16. **docs/cold-read-v034.md** (new) · **unclear** (minor) · "README.md:203", "README.md:242", "docs/host.md:87–101"
    - **Why it fails a stranger:** the report is kept word for word (README.md:33), and its line numbers are those of the `v0.3.4` tree. In this tree, "replay: durable dedupe" is at README.md:205, the machine sentence at :246, and the actions table at host.md:95–107. A reader who follows the numbers here lands on other text. Its findings 1, 4, 9 and 13 are also settled now, and nothing in the file says so.
    - **What the reader needs:** one line above the report, outside the reader's text (or in `docs/reviews.md`'s entry), saying that its line numbers are of `v0.3.4` and pointing to the settlement list at `docs/reviews.md:379–384`.

## What I read, what I skipped, what I ran

**Read in full:** `act/core/bus.js`, `act/core/edge.js`, `act/proteus/engine.js`, `act/daemon/supervisor.js`, `act/test/dedupe-full.test.js`, `docs/host.md`, `docs/cold-read-v034.md`, `lab/KERNEL-VERSION.txt`.

**Read in part:**
- `README.md`: lines 1–80, 150–190, 200–212 and 226–252.
- `act/test/transient.test.js`: lines 1–124 and the test names.
- `act/core/envelope.js`: lines 1–60.
- `act.js`: `route` (320–352) and the `require` of edge.
- `act/scheduler.js`: how fires and retries are sent.
- `act/core/registry.js`: the `runsAs` rules.
- `act/proteus/eval.js`: how a refused call ends a script.
- `docs/proteus-k.md` §4.
- `docs/reviews.md`: 355–414.
- `docs/capability-architecture.md`: 30–37.
- `lab/EXPECTED-RESULTS.txt`: 1–6.
- `lab/lab-check.sh`: the output lines.
- `lab/mutations/README.md`: the run line.
- `act/CHANGELOG.md`: the top notes and the v0.54.3 entries.

**Skipped:** the rest of the kernel, the other tests, the other docs, the other cold reads, the lab scenarios and the mutation result files, apart from the comparison below.

**Ran** (all on copies in my scratch folder, macOS, Node v26.7.0, Python 3):

| Command or trial | Result |
|---|---|
| `npm test` | 404 of 404 passed, 0 skipped reported |
| `npm run test:check` | `full run: 405 tests, 1 failed · skipping run: 404 tests, 404 passed` → `KERNEL TESTS PASS — 404/404` |
| `bash lab/lab-check.sh` | 12 `ok` lines, `LAB PASS — 12/12 suite runs exactly as recorded` |
| `node lab.js run suites/edges 1` (from `lab/`) | ENV line: `node v26.7.0 · kernel 1618d6a9149d (= the recorded copy of live 0.54.3)`; it names the host, as README.md:77 warns |
| `shasum -a 256 -c lab/KERNEL-SHA256SUMS` | 36 of 36 OK |
| README.md:77's awk/sort/perl pipeline | `1618d6a9149d…` |
| `bash lab/mutations/mutrun.sh <abs> LIVE M1 … M15` | 144 rows identical to `RUNS-0538_091126.tsv` from line 2 on; line 1 names `kernel = 0.54.3` |
| Caller at the cap: a bus with `dedupeCap: 3` behind `createEdge`, a stepped clock | ids 1–3: 200. Id 4: **503**, `Retry-After: 86397`, body `retryAfterMs: 86397000` (= oldest + 24 h − now; ceil(ms/1000) = header). A request with no id: 503. Second identity, same id `a4`, same moment: 200. `a4` again while full: 503. `a4` after the oldest left: 200, then 409. The oldest id after it left: 503 (a new id). 1 ms before a slot frees: `Retry-After: 1`, `retryAfterMs: 1` |
| Through `act.route` (`A.bus.dedupeCap` set by hand, since `create()` refuses `dedupeCap`) | 503 `DEDUPE_FULL`, `Retry-After: 86400`; `create({ dedupeCap })` → `unknown option "dedupeCap"` |
| Scripts at the cap (in-process and daemon) | own-identity script: 503, then 409 for the same id (finding 1). Service script filled by others: 503, then 409 (2). File-append then calc: 422 naming `DEDUPE_FULL`, no `retryAfterMs` (8). Counter `remember`: 2, then 3 on retry (4) |
| Native action rethrowing a refused child reply | 503 transient after writing a file (3) |
| The three README-248 mutations, each on its own copy, full `npm test` | all three: 404 of 404 pass. Behaviour: the `:101` drop removed locks a script identity out (11); the edge floor removed changes `retryAfterMs: 0` from `1` to `0` (12); `watch` removed from the in-process `callAction` turns the second concurrent call's 503 into 422 `ACTION_ERROR` with no `retryAfterMs`. Extra: removing `:141` alone passes 404/404 and changes nothing; removing both `:101` and `:141` fails "ageing out" |
| Ids with U+2028, U+202E, U+0085 through the edge | 200 each; raw in the reply and the audit file; Python `splitlines()` 7 → 18 pieces, 16 unparseable; split on `\n`, 7 of 7 parse |
| 41 and 40 emoji ids | 400 and 200 |
| `""` as id, twice, through `route` | 200 and 200, two fresh UUIDs (6) |
| Memory per id, the page's method, `--expose-gc`, twice | UUID 109 B / 5.4 MB; 80 ASCII 149 B / 7.4 MB; 80 two-byte units 229 B / 11.4 MB (5) |

**Could not run:** `git diff` for README.md:65 (no `.git`); `tools/check-byte-identity.sh` (README.md:68, it needs the private repository); the claim that the 11 FAIL-FIRST tests fail on `v0.54.2`'s files (that code is not here); SYNTHEKOS's release check (README.md:248).

## The "only", "every" and number sentences I tried

| Where | Sentence (short) | Result |
|---|---|---|
| README.md:9 | at most 50 000 ids per identity inside 24 h; a new id beyond them refused `DEDUPE_FULL` | held (`bus.js:53`, `:143–144`; trial at cap 3); child calls count too (7) |
| README.md:33 | "the five cold-read reports in `docs/`" | held: `cold-read-v030` … `-v034` |
| README.md:65 | `v0.3.5` changed eight … prints these eight paths | not runnable (no `.git`); the eight match the `111126` entries in `act/CHANGELOG.md` |
| README.md:68 | only its owner can run the byte-identity check; run against `v0.54.3` for `v0.3.5` | taken on trust |
| README.md:77 | fingerprint `1618d6a9149d`, on the ENV line of every `node lab.js run …` | held (pipeline and ENV line) |
| README.md:77 | `lab-check.sh` prints one `ok`/`FAIL` line per run and a last line | held for a pass; not for STOP (15) |
| README.md:77 | sha256 over `act.js`, every `.js` under `act/` outside `act/test/`, and the spec | held (36 of 36 sums) |
| README.md:161–162 | 11 Nov, `v0.54.2` `897cab7d03ee` / `v0.54.3` `1618d6a9149d`, on that machine, Node 26.7.0 | fingerprint held; machine and Node taken on trust (same as `EXPECTED-RESULTS.txt:3`) |
| README.md:186 | all 144 rows byte-identical … on `v0.54.3` again; "Those four runs" | held: 144 rows identical; four kernels listed after `v0.53.8` |
| README.md:186 | harness `mutate.py` 1.2.2; M14's anchor moved, the mutation the same | M14 still caught in the run (row identical) |
| README.md:229 | 14 findings; three more settled (4, 9, 13); the other ten open | held against `docs/cold-read-v034.md` (14 items) and `docs/reviews.md:379–384` |
| README.md:229 | "The four reads before it had missed it" | held for the reports here (none names the cap) |
| README.md:237 | two sealed mutations not caught on `v0.54.3` | held: M1 and M13 rows unchanged in my run |
| README.md:246 | lab numbers on the host machine, apart from the first measurement | unclear (14) |
| README.md:248 | three ways of breaking the fix caught only outside, not by `npm test` | held: each survives 404/404 (11, 12) |
| README.md:249 | `splitlines()` breaks a record at U+2028/U+2029/NEL; the JSON is intact | held; more places than the audit (13) |
| host.md:65 | a 503 `DEDUPE_FULL` also has `retryAfterMs` | held; whose identity is unclear (9) |
| host.md:78 | 503 for six codes, `DEDUPE_FULL` included | held (`edge.js:22`) |
| host.md:81 | `DAEMON_…` → `Retry-After: 5`; `DEDUPE_FULL` → whole seconds, rounded up, at least 1 | held (`edge.js:18`; 86397000 → 86397; 1 → 1; 0 → 1) |
| host.md:83 | keeps every id 24 h on disk; at most 50 000; no id forgotten | held (trial; start path test) |
| host.md:83 | at most 50 000 ids in any 24 h, about 35 a minute | arithmetic held (34.7); missing child calls (7) |
| host.md:83 | `create()` does not take `dedupeCap`/`dedupeMs` | held (refused as unknown option) |
| host.md:84 | 1–80 UTF-16 units; 41 emoji refused 400 | 41 emoji held (400; 40 → 200); `""` not refused (6) |
| host.md:85 | about 100 bytes / about 5 MB per 36-char id | held (109 B, 5.4 MB) |
| host.md:85 | at most about 196 bytes / 9.8 MB at 80 units | did not hold for two-byte ids (5) |
| host.md:85 | measured on the host machine with Node 26.7.0 | not checkable; same Node here |
| host.md:86 | a caller's own `DEDUPE_FULL` keeps no id | did not hold when the script runs as the caller (1) |
| host.md:87 | transient after the check consumed the id; nothing ran | id part held; "nothing ran" did not hold for a native action (3) |
| host.md:88 | a script at the cap refused before it starts; 503 = not started; 422 = started | held in my trials, with a caveat on concurrency (8) |
| host.md:89 | a `remember` before the first call stands; a retry writes the same value | first half held; second did not (4) |
| host.md:186 | `bus.js`:185–258; output cut at 300 characters; a daemon's transient code keeps it | line range held; incomplete for natives (3) |
| capability-architecture.md:35 | `send`/`email` audited as sha256 and size; every other input as given, cut at 300 | held (`bus.js:34–35`, `:239`) |
| reviews.md:363 | 10 000 a minute fills the cap in 5 minutes; 120 a minute in about 7 hours | held (5 min; 6.9 h) |
| reviews.md:369 | first call refused → `DEDUPE_FULL` transient; later → 422; `retryAfterMs` in body and header | held (trials; 422 has neither, see 8) |
| reviews.md:371 | 11 FAIL-FIRST tests and 2 guards in `dedupe-full.test.js` | count held (6 + 4 in the loop + 1 = 11; 2 GUARD); "fail on `v0.54.2`" not checkable |
| reviews.md:377 | the fifth read ran `npm test` 391/391, lab 12/12, 144 rows | held against `docs/cold-read-v034.md`; 391 + 13 new = the 404 here |
| reviews.md:379 | 14 findings, four settled | held |
| reviews.md:391, :411 | every bare tag of bus.js / dedupe-full.test.js indexed | held for "the fifth cold read's #1" (`bus.js:68`) and M14 |
| EXPECTED-RESULTS.txt:3 | every RESULT line identical on `v0.54.3` (`1618d6a9149d`), Node v26.7.0 | held here: 12/12 with that fingerprint on v26.7.0 |
| KERNEL-VERSION.txt | at the cap a new id is refused, none is forgotten | held |
| dedupe-full.test.js:136 | "at least 1" | the assertion passes without the floor (12) |
| transient.test.js:106 | the bus and the supervisor name the same six codes | held (`bus.js:41`, `supervisor.js:27`) |
