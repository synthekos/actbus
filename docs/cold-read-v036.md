# Cold read of v0.3.6 (scoped)

The scope: the dedupe and rate text of `docs/host.md` (lines 42, 56, 65, 78, 81, 83–86, 140); the authority scenario that replaced another (`r2p`, its generator, the seals, `lab/SEALS.md` line 18, `lab/EXPECTED-RESULTS.txt`, README lines 164 and 188); and every sentence in the folder that states one of the listed values. I used only this folder. I ran everything on copies in a scratch folder. This file is the only change to the folder.

## Findings

1. **docs/host.md:140** · **false** · "is tried again after 5 s and then 30 s"
   - **Why it fails a stranger:** the scheduler looks at a pending retry only when it ticks, and `act.js` ticks every 15 s (`act.js:380`). So the first retry runs at the first tick at least 5 s later, which is about 15 s after the refusal. I drove `create()`'s scheduler with an injected clock and a tick every 15 s. The fire was refused at +0 s, retried at +15 s, retried again at +45 s, and then `trigger-lost`. `act/test/transient.test.js:184` passes because it calls `tick()` at times it chooses, not at the kernel's 15 s.
   - **What the reader needs:** "is tried again at the first tick (every 15 s) at least 5 s later, then at least 30 s after that".

2. **docs/host.md:140** · **missing** · "A time trigger's fire that is refused with a transient code is tried again"
   - **Why it fails a stranger:** `DEDUPE_FULL` is one of those transient codes, and the scheduler ignores its `retryAfterMs`. In my run, a trigger whose `runsAs` identity was at the cap made two pointless retries (with `retryAfterMs` near 86 400 000), and then the fire was lost. The next period's fire did exactly the same. So a full identity loses every scheduled fire until its oldest id ages out, which can take up to 24 h. Lines 81 and 83 call `retryAfterMs` "when it clears", so a reader expects the scheduler to wait for it. The sixth cold read's #10 asked for this sentence. Line 140 now covers transient codes in general, but not this one.
   - **What the reader needs:** "the scheduler does not read `retryAfterMs`: a fire refused `DEDUPE_FULL` is retried on the same ladder and then lost, and so is every fire after it until the identity's oldest id leaves the window".

3. **docs/host.md:42** · **missing** · "a script's calls count against the caller who started it"
   - **Why it fails a stranger:** the rule held when I tested it (see the list below), but the page does not say how the caller sees it. My caller at rate 4 ran a two-call script twice. The second request answered **HTTP 422 `ACTION_ERROR`** ("ACTION: calc did not run: RATE u-…02 exceeded 4 messages per minute (a call made for it by u-…04)"), not the 429 `RATE` of the table at line 75. The audit line for that refusal has `from` set to the script's identity (`u-…04`). The caller who paid is named only inside `reason`. A host that groups refusals by `from`, or retries on 429, misses it.
   - **What the reader needs:** "when a script's call is refused `RATE`, the caller gets 422 `ACTION_ERROR` naming RATE; the audit line's `from` is the script's identity and its `reason` names the caller who paid".

4. **docs/host.md:42 with :56** · **unclear** · "counts the request against the EUser's rate"
   - **Why it fails a stranger:** one grant's `rate` is applied by two separate counters. Each has its own 60 s window. `route` counts each request once (`act.js:309`, not audited). The bus counts that request again, plus every call its script makes (`bus.js:159–162`). My rate-4 caller made 2 requests at the route and 5 messages at the bus, and the bus refused the 5th. Read together, line 56 and line 42 suggest a single count.
   - **What the reader needs:** "the rate is applied twice: at the route to each request, and in the bus to each request and every call its script makes; either can refuse".

5. **docs/host.md:86** · **unclear** · "After any 503, retry with a new id."
   - **Why it fails a stranger:** the two kinds of 503 need different handling, and the sentence gives neither a reason nor a wait. After a `DAEMON_…` 503 the id was kept, though nothing ran: retrying the same id answered 409 `DUPLICATE`, so a new id really is needed. After `DEDUPE_FULL` the refused id was not kept. A new id sent at once was refused 503 again (my `a5`). Once `Retry-After` has passed, the same id or a new one both run. A caller who follows the sentence literally retries at once with new ids and gets one 503 per try, each also counted against the route's rate.
   - **What the reader needs:** "After a `DAEMON_…` 503, wait `Retry-After` and retry with a new id: the old id was kept although nothing ran. After `DEDUPE_FULL`, wait `Retry-After`; the id was not kept, so either id will do."

6. **docs/host.md:83** · **missing** · "The bus keeps the id of every request that passes this check"
   - **Why it fails a stranger:** a trigger's fire is a root message of its `runsAs` identity, so its id is kept too. My `trig2` held 2 ids after 2 fires, while the children of those fires held none. A trigger and that EUser's own requests therefore share one 50 000. At the cap, the trigger's fires are lost (finding 2). The page says this only for "requests".
   - **What the reader needs:** "each trigger fire also spends one id of its `runsAs` identity".

7. **docs/host.md:85** · **unfollowable** · "A second method, through the bus's own path, gives 8–14% less there (100 and 196 bytes)"
   - **Why it fails a stranger:** this method is not described beyond "through the bus's own path", so it cannot be repeated. My guess was: fill a real `Bus` by `ask()` with 50 000 ids, read `heapUsed` after forced GCs, delete `bus.seen`'s set for that identity, read again, and divide by 50 000. That gave 97.5 B and 193.5 B, which is 10.6% and 15.4% less than method 1. The page says 100 B and 196 B, 8–14% less (100/109 is −8.3% and 196/229 is −14.4%, so the page's own numbers agree with its own range).
   - **What the reader needs:** the script, or its steps: what is filled, what is dropped, which heap number is read, how many GCs are forced, and the Node flags.

8. **docs/host.md:85** · **unclear** · "measured by one method on SYNTHEKOS's host machine with Node 26.7.0"
   - **Why it fails a stranger:** method 1 can be repeated only by guessing several things:
     - which heap figure (I used `heapUsed` after four `gc()` calls under `--expose-gc`);
     - what is held per id (I used an id → timestamp `Map` inside a per-identity `Map`, as `bus.seen` does);
     - how 50 000 distinct 80-unit emoji or Cyrillic ids were built;
     - how many runs were made.

     With my guesses I got 109.1 B and 108.7 B (5.5 MB), and 228.7 B (11.4 MB) for both 80-unit kinds. So the figures hold. Who measured them is unclear, though. `docs/reviews.md:404` says "the memory figures are the reader's method's". `docs/cold-read-v035.md:41` got the same 109 and 229 on a machine it says "may not be SYNTHEKOS's host machine". This sentence says SYNTHEKOS's host machine.
   - **What the reader needs:** the measuring script (for example under `tools/`), and one line saying who ran it, where and how many times.

9. **docs/host.md:84** · **unclear** (minor) · "one emoji is two units"
   - **Why it fails a stranger:** this is not true of every emoji. 41 × ☺ (U+263A, one unit each) was accepted, and 21 × 👍🏽 (four units each, 84 in all) was refused. The refusal also says "id must be a string of 1–80 characters" (`act/core/envelope.js:30`), so a caller who counts characters is misled.
   - **What the reader needs:** "most emoji are two units; some are one, and a skin-tone or joined emoji is four or more. The error's 'characters' are UTF-16 units."

10. **docs/host.md:42** · **unclear** (minor) · "a time trigger's root is its `runsAs` identity"
    - **Why it fails a stranger:** an on-message trigger fires through the same `schedBus.ask` (`act.js:363–364`), so it is a root of its `runsAs` identity too and pays the same way. "Time" suggests that only `every`/`at` triggers do. I read this in the code but did not run it.
    - **What the reader needs:** "a trigger's root (time or message) is its `runsAs` identity".

11. **lab/gen-suite3-authority.py:4–5 (and :7)** · **false** · "bus rate per sending identity per minute"
    - **Why it fails a stranger:** since kernel 0.54.4 and this generator's own 1.1.0, the bus charges a child call to the root caller (`bus.js:159`), not to the identity that sends it. Line 7, "the rate limit counts per IDENTITY", is ambiguous for the same reason. Line 44 of the same file says it correctly ("per ROOT caller").
    - **What the reader needs:** "bus rate per root caller per minute (a script's calls count against the caller who started it)".

12. **lab/gen-suite3-authority.py:14–15** · **unfollowable** · `os.rename(D, … '_superseded', 'authority-' + time.strftime(…))`
    - **Why it fails a stranger:** the natural way to check `SEALS.md`'s "the other 13 byte-identical" is to run the generator, and doing that moves the sealed suite, `SEALED.json` included, into `_superseded/authority-<timestamp>`. It then writes 14 unsealed files, and `lab.js run` refuses them until someone reseals. Nothing tells the reader to run it on a copy. Also, the kept `_superseded/authority-r2/` holds only `r2` and a seal of its own, so it was not made by this code path, and nothing says how it was made. (On a copy, generator 1.1.0 reproduced all 14 sealed hashes. With r2's old parameters (boss 120, svc 3, the old `about`) it reproduced the kept `r2` file byte for byte, sha256 `992e9033…`.)
    - **What the reader needs:** "run it on a copy of the repository and compare with `SEALED.json`; it moves the existing suite away", plus a line on how `authority-r2/` was made and sealed.

13. **lab/SEALS.md:18** · **missing** · "sealed alone at 2026-11-12T14:23:16.542Z: on this kernel it fails"
    - **Why it fails a stranger:** the line gives no seal hash for the kept suite (its `SEALED.json` sha256 begins `b821f0e95604`), no command, and no result. I ran `cd lab && node lab.js run suites/_superseded/authority-r2 1` with `PK_DAEMON=0` and `=1`. Both gave `RESULT authority-r2: 0/1 runs as expected`: step 1 is ok, and there is no `RATE` audit line. The old seal `47ad4e16855d`'s `SEALED.json` is not in the folder either. So "the other 13 byte-identical" can be checked against the generator, but not against the old seal.
    - **What the reader needs:** the seal hash, that command, the expected `0/1` line, and the old `SEALED.json`, or the 13 old hashes.

14. **docs/reviews.md:393** · **unclear** · "hold 11 FAIL-FIRST tests that fail on `v0.54.3`'s files"
    - **Why it fails a stranger:** the three files' own headers name 10 such tests:
      - `caller-pays.test.js`: 5 (the shared-script test runs twice, in-process and in a daemon);
      - `dedupe-full.test.js`: 3 (the empty-id test and the two non-string-id tests);
      - `transient.test.js`: 2 ("the two tests marked FAIL-FIRST native").

      Altogether, the three files hold 26 FAIL-FIRST tests, and all 32 of their tests passed for me. The 11th may be `transient.test.js`'s "the same five codes" test, which changed in 1.3.0, but its file does not say that it fails on 0.54.3. I could not run anything against 0.54.3, because that code is not here.
    - **What the reader needs:** the names of the 11 tests.

## What held, with no finding

- **The cap, as a caller** (a `Bus` with `dedupeCap: 3` behind `createEdge` on a real HTTP port, injected clock):
  - three ids ran, and the fourth got **503 `DEDUPE_FULL`** with `retryAfterMs` 86 397 000 (exactly 24 h − 3 s) and `Retry-After: 86397`;
  - the oldest id sent again answered 409;
  - a request with no `id` was also refused 503;
  - 1 ms before the oldest id aged out, `retryAfterMs` was 1 and `Retry-After` 1. At 24 h exactly, a new id ran, and the next one waited 1000 ms (`Retry-After: 1`).
- **The same through `create()`'s `route`** (I set `bus.dedupeCap` to 7 after `create()`, which itself refuses `dedupeCap` as an unknown option): 503, `retryAfterMs` 86 399 838, `Retry-After: 86400`.
- **The rate, as a caller:**
  - a rate-120 caller ran the script three times (nine bus messages) although the script's identity is at rate 1, so the script's identity is never charged;
  - the rate-4 caller was refused at its 5th bus message;
  - a time trigger whose `runsAs` is at rate 4 was refused at its own 5th message, with the reason naming the `runsAs` identity.
- **The lab:**
  - `bash lab/lab-check.sh` on a copy gave `LAB PASS — 12/12`;
  - the authority suite gave the recorded line in both modes, under the ENV line `kernel e69cd45a00e3 (= the recorded copy of live 0.54.4) · sealed 2026-11-12T14:10:14.664Z (3bae106a454c)`;
  - `r2p` passed, refused `calc:RATE` once.

  All of this is what `lab/SEALS.md:18`, `lab/EXPECTED-RESULTS.txt` and README:164 say.
- **README:188:**
  - `bash lab/mutations/mutrun.sh <abs path> LIVE M1 … M15` wrote 146 lines, and its 144 rows are byte-identical to `RUNS-0538_091126.tsv` from line 2 on;
  - 13 of 15 mutants were caught (M1 and M13 were not);
  - in mode B, M3 was as expected in 14 of 38 injection runs (so caught in 24) and M4 in 26 of 38 (caught in 12);
  - `mutate.py` is 1.2.3, and M12 now keys the window by `env.trace` in place of `payer`, which is the same mutation.

## What I read, skipped and ran

- **Read:**
  - `docs/host.md` lines 1–160;
  - `act.js` (whole);
  - `act/core/bus.js`, `edge.js` and `envelope.js` (whole);
  - `act/scheduler.js` (the header, `validate`, the constructor and `tick`);
  - `act/core/capabilities.js` (the rate lines) and `act/core/registry.js` (load/check, by grep);
  - the headers and test names of `act/test/dedupe-full.test.js`, `caller-pays.test.js` and `transient.test.js`;
  - `lab/SEALS.md`, `lab/EXPECTED-RESULTS.txt`, `lab/lab-check.sh`;
  - `lab/lab.js` (the header, the seal functions and the fingerprint lines 155–162);
  - `lab/gen-suite3-authority.py` lines 1–80;
  - `lab/suites/authority/SEALED.json`, `r2p-root-pays-across-traces.json`, and both files in `lab/suites/_superseded/authority-r2/`;
  - `lab/mutations/mutrun.sh`, `mutate.py`'s header and M12;
  - README lines 1–19, 58–80, 120–200 and 225–236;
  - the `act/CHANGELOG.md` entries for v0.54.3/v0.54.4 and `dedupe-full.test.js`;
  - `docs/reviews.md` lines 350–410;
  - `docs/cold-read-v035.md` (the list of findings, and items 5–10).
- **Skipped:** the rest of `docs/` (I opened the cold-read reports only to count their findings), `act/proteus/`, `act/daemon/`, `act/mail/`, the other suites' scenarios, `examples/` (apart from `script-host.js`'s first 40 lines, as a model for my host), and `tools/`.
- **Ran (all on copies, with `TMPDIR` in the scratch folder):**
  - `bash lab/lab-check.sh`;
  - `node lab.js run suites/authority 1` and `node lab.js run suites/_superseded/authority-r2 1`, each with `PK_DAEMON=0` and `=1`;
  - `gen-suite3-authority.py`, twice: once as it is, once with r2's old parameters;
  - `bash lab/mutations/mutrun.sh … LIVE M1 … M15`;
  - README:78's fingerprint pipeline (it prints `e69cd45a00e3`) and `shasum -c lab/KERNEL-SHA256SUMS` (36 OK);
  - `node --test` on `caller-pays`, `dedupe-full` and `transient` (32 of 32 pass);
  - four scripts of my own: the cap (`Bus` + `createEdge` + HTTP), the rate and triggers (`create()` + `route` + `schedTick` with an injected clock), the id lengths, and the memory, run with `node --expose-gc` on Node v26.7.0, darwin arm64.
- **Could not run:**
  - the `git diff` of README:66, because the folder has no `.git`;
  - anything against v0.54.2 or v0.54.3, because that code is not here;
  - `tools/check-byte-identity.sh`, which needs the private repository.

  I did not run the full `npm test`.

## The "only", "every" and number sentences I tried

| Where | Sentence (short) | Result |
|---|---|---|
| host.md:42 | `rate` a whole number 1–10000, default 120 | held (`act.js:129`, `act.js:268`, `capabilities.js:39,53`; read in the code) |
| host.md:42 | a script's calls count against the caller who started it | held (run); see 3 and 4 |
| host.md:42 | a time trigger's root is its `runsAs`; a trigger pays for its own work | held (run); see 10 |
| host.md:56 | 30 a minute with no usable grant; 429 `RATE` not audited | held in the code (`act.js:329`); not audited is also what `r1-route-rate` checks, and it passed |
| host.md:65 | `retryAfterMs`: ms until the identity can be served again | held (exact, at the boundary too) |
| host.md:78 | six codes at 503 | held (`edge.js:22`) |
| host.md:81 | `DAEMON_…`: `Retry-After: 5` | held (`edge.js:15`; the HTTP test in `transient.test.js` passed) |
| host.md:81 | `DEDUPE_FULL`: whole seconds, rounded up, at least 1 | held (86397000→86397, 1→1, 1000→1, 86399838→86400) |
| host.md:83 | keeps every id that passes, 24 h, on disk | held; see 6 |
| host.md:83 | at most 50 000 per identity; refused until the oldest leaves | held (cap 3, run; default 50 000 in `bus.js:53`) |
| host.md:83 | at most 50 000 in any 24 h, about 35 a minute | held (50 000 / 1 440 = 34.7) |
| host.md:83 | `dedupeCap` 50 000, `dedupeMs` 86 400 000; `create()` does not take them | held (`create({dedupeCap})` throws "unknown option") |
| host.md:84 | 1–80 UTF-16 units; 41 emoji refused 400 | held (80 ok, 82 refused `BAD_ENVELOPE`) |
| host.md:84 | one emoji is two units | not always (see 9) |
| host.md:85 | about 109 B, 5.4 MB; about 229 B, 11.4 MB | held with my reading of method 1 (109.1/108.7 B, 5.5 MB; 228.7 B, 11.4 MB); see 8 |
| host.md:85 | second method 8–14% less (100 and 196 B) | not reproduced (my reading: 97.5 and 193.5 B, 10.6% and 15.4%); see 7 |
| host.md:86 | after any 503, retry with a new id | partly: right for `DAEMON_…`, no help for `DEDUPE_FULL` (see 5) |
| host.md:140 | retried after 5 s and then 30 s | did not hold at the kernel's 15 s tick: 15 s, then 30 s (see 1) |
| host.md:140 | once more, after 5 s, for `DAEMON_EVICTING`; lost, audited `trigger-lost` | held (code; `transient.test.js:229` passed; `trigger-lost` seen in my run) |
| SEALS.md:18 | 1 of 14 changed, the other 13 byte-identical | held against generator 1.1.0; the old seal is not here (see 13) |
| SEALS.md:18 | r2p's 5th message, a child, refused `RATE` by the bus | held (audit: `calc` refused `RATE`, count 1) |
| SEALS.md:18 | the suite's RESULT line is unchanged | held, both modes |
| SEALS.md:18 | new seal `3bae106a454c` · 2026-11-12T14:10:14.664Z | held |
| SEALS.md:18 | old r2 kept byte for byte, sealed alone at …14:23:16.542Z; fails on this kernel | held (regenerated byte for byte; the seal time is in the file; 0/1 in both modes) |
| EXPECTED-RESULTS.txt:3 | v0.54.4, fingerprint `e69cd45a00e3`, r2 replaced by r2p | held (fingerprint, and all 12 lines) |
| README:164 | fingerprint `e69cd45a00e3`, Node 26.7.0 | held (my ENV line, Node 26.7.0) |
| README:188 | 13 of 15 caught; M3 caught in 24 of 38, M4 in 12; all 144 rows identical; five runs; `mutate.py` 1.2.3 | held (run); "12 of them on the WORDS path" not checked |
| README:66 | `v0.3.6` changed ten | the list names ten, and the CHANGELOG has a v0.54.4 entry for each of the other nine. The git command could not be run |
| README:78 | the fingerprint, and the pipeline that gives it | held (`e69cd45a00e3`; 36 sums OK) |
| README:229, :233; reviews.md:355, :400 | 16 findings | held (16 numbered items in `cold-read-v033.md` and `cold-read-v035.md`) |
| README:233 | five of them false sentences in host.md's dedupe section | held (#1, 3, 4, 5, 6) |
| CHANGELOG.md:7, :289; reviews.md:371 | `dedupe-full.test.js` 1.0.0: 11 FAIL-FIRST on v0.54.2, 2 GUARD | the count is consistent (6 still in the file + the 5 removed script tests); 1.0.0 and v0.54.2 are not here |
| reviews.md:393 | 11 FAIL-FIRST that fail on v0.54.3 | 10 are named (see 14) |
| envelope.js:30 | "1–80 characters" | the behaviour held; the word is UTF-16 units (see 9) |
| scheduler.js:203; transient.test.js:184 | the ladder: 5 s, then 30 s | `retryMs` is `[5000, 30000]` and the test passed; the kernel's tick changes the timing (see 1) |
| cold-read-v035.md:41, :151, :182 | 109 B / 5.4 MB; 229 B / 11.4 MB | matched my method-1 run; its 149 B for an 80-char ASCII id not tried |
| cold-read-v035.md:40, :183 | 196 B / 9.8 MB | a quote of host.md's old sentence, already marked false there; not a current claim |
| cold-read-v035.md:44, :48, :181 | 1–80 UTF-16 units; 41 emoji 400 | consistent with my run |
| gen-suite3:3; r2p "about" | the other 13 byte-identical; rate 4, 2 traces × 3 messages, the 5th refused | held |
