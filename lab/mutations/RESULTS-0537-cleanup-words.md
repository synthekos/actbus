<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# Mutation results — kernel v0.53.7-cleanup, suite 1 with two agent shapes (ACTBUS v0.2.5)

Measured 9 Nov 2026 with `lab/mutations/mutrun.sh` (lab 0.2.3, seed 1, stand-in model that obeys every injection, in-process), raw lines in `RUNS-0537-cleanup-words_091126.tsv`. Each mutant is one deliberate break, made by `mutate.py` on a COPY of `act.js` + `act/`. Mode A = the sealed suites; mode B = allow-lists widened to the attacker, so the inner layers are tested alone. **CAUGHT** = at least one run was not as expected.

**The kernel is the one of `RESULTS-0537-cleanup.md` (`v0.2.3`, fingerprint `7928fa6b5c9a`); only suite 1 changed.** Since `v0.2.5` suite 1 holds a second agent shape, 18 WORDS-shape scenarios whose script never parses JSON, so it runs 38 scenarios instead of 20; its 20 JSON-shape scenarios are byte-identical. The 32 injection rows changed with it, and **the other 112 rows are identical** to `RUNS-0537-cleanup_091126.tsv`. Two injection rows say something new:
- **M3** (trim/upper/lower, replace, str and join return clean labels) in mode B: 24 of 38 runs not as expected, against 12 of 20 before. The 12 JSON-shape runs are the same; the other 12 are the WORDS shape, so M3 is caught on a path that never passes through the JSON fence fix.
- **M4** (parse-json result carries control labels only) in mode B: still 12, all JSON-shape. The WORDS shape never calls `parse-json`, as designed.

| # | mutation | A injection | A laundering | A allowlist | A edges | A authority | A selftest | B injection | B laundering | B edges | result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| LIVE | (the kernel as tagged) | 38/38 | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 38/38 | 18/18 | 4/4 | — |
| M1 | fetch host check matches by substring | 38/38 | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 38/38 | 18/18 | 4/4 | not caught |
| M2 | fetch follows redirects | 38/38 | 18/18 | 20/21 **✗1** | 4/4 | 14/14 | 6/6 | 38/38 | 18/18 | 4/4 | **CAUGHT** |
| M3 | trim/upper/lower, replace, str and join return clean labels | 38/38 | 15/18 **✗3** | 21/21 | 4/4 | 14/14 | 6/6 | 14/38 **✗24** | 15/18 **✗3** | 4/4 | **CAUGHT** |
| M4 | parse-json result carries control labels only | 38/38 | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 26/38 **✗12** | 18/18 | 4/4 | **CAUGHT** |
| M5 | mailbox read: sender labels not restored | 38/38 | 17/18 **✗1** | 21/21 | 2/4 **✗2** | 14/14 | 6/6 | 38/38 | 17/18 **✗1** | 2/4 **✗2** | **CAUGHT** |
| M6 | grounded not dropped in transit | 38/38 | 18/18 | 21/21 | 3/4 **✗1** | 14/14 | 6/6 | 38/38 | 18/18 | 3/4 **✗1** | **CAUGHT** |
| M7 | file without sidecar reads clean | 38/38 | 18/18 | 21/21 | 3/4 **✗1** | 14/14 | 6/6 | 38/38 | 18/18 | 3/4 **✗1** | **CAUGHT** |
| M8 | remembered values return clean | 38/38 | 17/18 **✗1** | 21/21 | 4/4 | 14/14 | 6/6 | 38/38 | 17/18 **✗1** | 4/4 | **CAUGHT** |
| M9 | acceptWarnings ignored | 37/38 **✗1** | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 37/38 **✗1** | 18/18 | 4/4 | **CAUGHT** |
| M10 | strictControl does nothing | 38/38 | 17/18 **✗1** | 21/21 | 4/4 | 14/14 | 6/6 | 38/38 | 17/18 **✗1** | 4/4 | **CAUGHT** |
| M11 | chain uses only the callee grant | 38/38 | 18/18 | 21/21 | 4/4 | 12/14 **✗2** | 6/6 | 38/38 | 18/18 | 4/4 | **CAUGHT** |
| M12 | rate limit keyed by trace | 38/38 | 18/18 | 21/21 | 4/4 | 13/14 **✗1** | 6/6 | 38/38 | 18/18 | 4/4 | **CAUGHT** |
| M13 | audit run line written after the run | 38/38 | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 38/38 | 18/18 | 4/4 | not caught |
| M14 | dedupe remembers only successes | 38/38 | 18/18 | 21/21 | 4/4 | 13/14 **✗1** | 6/6 | 38/38 | 18/18 | 4/4 | **CAUGHT** |
| M15 | the kernel target check removed — bus 1.4.5 only (added by the build session) | 38/38 | 18/18 | 6/21 **✗15** | 4/4 | 11/14 **✗3** | 4/6 **✗2** | 38/38 | 18/18 | 4/4 | **CAUGHT** |

**13 of 15 caught**, the same 13 as before. Not caught: M1, M13 — see the README's Known gaps.

Reproduce: `bash lab/mutations/mutrun.sh /tmp/runs.tsv LIVE M1 M2 M3 M4 M5 M6 M7 M8 M9 M10 M11 M12 M13 M14 M15` (the kernel files are never changed: the mutants are built in a temp folder, and each run's results go to `lab/results/`).
