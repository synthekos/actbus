<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# Mutation results — kernel v0.53.5-headers

Measured 7 Nov 2026 with `lab/mutations/mutrun.sh` (lab 0.2.0, seed 1, stand-in model that obeys every injection, in-process), raw lines in `RUNS-0535-headers_071126.tsv`. Each mutant is one deliberate break, made by `mutate.py` on a COPY of `act.js` + `act/`. Mode A = the sealed suites; mode B = allow-lists widened to the attacker, so the inner layers are tested alone. **CAUGHT** = at least one run was not as expected.

| # | mutation | A injection | A laundering | A allowlist | A edges | A authority | A selftest | B injection | B laundering | B edges | result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| LIVE | (the kernel as tagged) | 20/20 | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 20/20 | 18/18 | 4/4 | — |
| M1 | fetch host check matches by substring | 20/20 | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 20/20 | 18/18 | 4/4 | not caught |
| M2 | fetch follows redirects | 20/20 | 18/18 | 20/21 **✗1** | 4/4 | 14/14 | 6/6 | 20/20 | 18/18 | 4/4 | **CAUGHT** |
| M3 | trim/upper/lower, replace, str and join return clean labels | 20/20 | 15/18 **✗3** | 21/21 | 4/4 | 14/14 | 6/6 | 8/20 **✗12** | 15/18 **✗3** | 4/4 | **CAUGHT** |
| M4 | parse-json result carries control labels only | 20/20 | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 8/20 **✗12** | 18/18 | 4/4 | **CAUGHT** |
| M5 | mailbox read: sender labels not restored | 20/20 | 17/18 **✗1** | 21/21 | 2/4 **✗2** | 14/14 | 6/6 | 20/20 | 17/18 **✗1** | 2/4 **✗2** | **CAUGHT** |
| M6 | grounded not dropped in transit | 20/20 | 18/18 | 21/21 | 3/4 **✗1** | 14/14 | 6/6 | 20/20 | 18/18 | 3/4 **✗1** | **CAUGHT** |
| M7 | file without sidecar reads clean | 20/20 | 18/18 | 21/21 | 3/4 **✗1** | 14/14 | 6/6 | 20/20 | 18/18 | 3/4 **✗1** | **CAUGHT** |
| M8 | remembered values return clean | 20/20 | 17/18 **✗1** | 21/21 | 4/4 | 14/14 | 6/6 | 20/20 | 17/18 **✗1** | 4/4 | **CAUGHT** |
| M9 | acceptWarnings ignored | 19/20 **✗1** | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 19/20 **✗1** | 18/18 | 4/4 | **CAUGHT** |
| M10 | strictControl does nothing | 20/20 | 17/18 **✗1** | 21/21 | 4/4 | 14/14 | 6/6 | 20/20 | 17/18 **✗1** | 4/4 | **CAUGHT** |
| M11 | chain uses only the callee grant | 20/20 | 18/18 | 21/21 | 4/4 | 12/14 **✗2** | 6/6 | 20/20 | 18/18 | 4/4 | **CAUGHT** |
| M12 | rate limit keyed by trace | 20/20 | 18/18 | 21/21 | 4/4 | 13/14 **✗1** | 6/6 | 20/20 | 18/18 | 4/4 | **CAUGHT** |
| M13 | audit run line written after the run | 20/20 | 18/18 | 21/21 | 4/4 | 14/14 | 6/6 | 20/20 | 18/18 | 4/4 | not caught |
| M14 | dedupe remembers only successes | 20/20 | 18/18 | 21/21 | 4/4 | 13/14 **✗1** | 6/6 | 20/20 | 18/18 | 4/4 | **CAUGHT** |
| M15 | the kernel target check removed — bus 1.4.5 only (added by the build session) | 20/20 | 18/18 | 6/21 **✗15** | 4/4 | 11/14 **✗3** | 4/6 **✗2** | 20/20 | 18/18 | 4/4 | **CAUGHT** |

**13 of 15 caught.** Not caught: M1, M13 — see the README's Known gaps.

Reproduce: `bash lab/mutations/mutrun.sh /tmp/runs.tsv LIVE M1 M2 M3 M4 M5 M6 M7 M8 M9 M10 M11 M12 M13 M14 M15` (the repo is never changed; mutants live in a temp folder).
