<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# Lab reseals

Each suite's `SEALED.json` freezes its scenarios (sha256 of each file) before any run, and `lab.js run` refuses a suite whose files do not match.
This page lists every time a suite was sealed again after its first seal, and why. A reseal is a deliberate act, recorded here.

| Date | Suite | Old seal (SEALED.json sha256) · sealed at | New seal · sealed at | Why | Scenarios changed |
|---|---|---|---|---|---|
| 2026-11-08 | injection | `c5109fc7ef24` · 2026-11-06T15:48:03.623Z | `49ed93815481` · 2026-11-08T14:38:19.032Z | **names only**: the model name in the scenarios became the neutral `model-a` | 20 of 20 |
| 2026-11-08 | laundering | `cb9ed1a245e1` · 2026-11-06T15:36:20.132Z | `cf1c8dd7ba30` · 2026-11-08T14:38:19.056Z | **names only**: the same | 12 of 18 (the other 6 name no model) |
| 2026-11-09 | injection | `49ed93815481` · 2026-11-08T14:38:19.032Z | `313910289491` · 2026-11-09T19:34:31.830Z | **persona and tooling names only; RESULT lines identical**: the scenarios' person is now `alex` | 20 of 20 |
| 2026-11-09 | laundering | `cf1c8dd7ba30` · 2026-11-08T14:38:19.056Z | `183932cc9bab` · 2026-11-09T19:34:31.876Z | **persona and tooling names only; RESULT lines identical**: the scenarios' person is now `alex` | 18 of 18 |
| 2026-11-09 | authority | `fa59551fe4b1` · 2026-11-06T18:23:14.952Z | `47ad4e16855d` · 2026-11-09T19:34:31.929Z | **persona and tooling names only; RESULT lines identical**: the scenarios' person is now `alex` | 6 of 14 (the other 8 name no person) |
| 2026-11-09 | allowlist | `09527c5c91c9` · 2026-11-06T18:18:56.934Z | `d84f610f6b6d` · 2026-11-09T19:34:31.983Z | **persona and tooling names only; RESULT lines identical**: the scenarios' person is now `alex` | 21 of 21 |
| 2026-11-09 | edges | `81e6f6bb8070` · 2026-11-06T16:47:34.487Z | `e0c5cd60ce0e` · 2026-11-09T19:34:32.042Z | **persona and tooling names only; RESULT lines identical**: the scenarios' person is now `alex` | 2 of 4 (the other 2 name no person) |
| 2026-11-09 | selftest | `9a701728afd1` · 2026-11-06T18:18:57.400Z | `169391e56497` · 2026-11-09T19:34:32.101Z | **persona and tooling names only; RESULT lines identical**: the scenarios' person is now `alex` | 6 of 6 |
| 2026-11-09 | injection | `313910289491` · 2026-11-09T19:34:31.830Z | `e85897a2a224` · 2026-11-09T21:57:38.147Z | **+ the WORDS shape**: 18 scenarios added (a second agent shape that never parses JSON); the 20 JSON-shape scenarios byte-identical; the injection RESULT line is new (20 → 38 runs) | 0 of 20 changed, 18 added |

How the 8 Nov reseal was checked:
- **Byte-identical apart from the name.** The scenarios were regenerated from `gen-suite1-injection.py` 1.1.1 and `gen-suite2-laundering.py` 1.0.2. Every new file is byte-identical to its old file with only the model name replaced (38 of 38). No expectation, step, grant or source changed.
- **The results did not move.** `lab/lab-check.sh` gives 12/12 RESULT lines identical to `EXPECTED-RESULTS.txt` as recorded before the reseal, in-process and in daemons. The RESULT lines carry no model name, so they are identical outright, not just apart from the renamed strings.
- **The mutations did not move.** All 144 rows are identical to the run before the reseal (`mutations/RESULTS-0535-changelog.md`).

How the 9 Nov reseal was checked:
- **Only declared names changed.** Every changed line of a lab file is a declared row (file, line, exact old line, exact new line), and every changed token in a scenario, a generator or the runner is one of the declared exact pairs, in the strings that hold them: the person's name became `alex`, `Alex` or `ALEX` in its own case, and `alexs-notes` in one URL; the two base64 payloads decode to the same text with the same name replaced. The generated suites were regenerated from `gen-suite1-injection.py` 1.1.2, `gen-suite2-laundering.py` 1.0.3, `gen-suite3-authority.py` 1.0.3, `gen-suite4-allowlist.py` 1.1.1 and `gen-suite5-edges.py` 1.0.1, and every file is byte-identical to its old file with the declared rows applied. The six selftest scenarios have no generator and changed by the rows alone. No expectation, step, grant or source changed.
- **The runner's accountable user is `alex`** (`lab.js` 0.2.3, its login and identity): the one code change, and every scenario runs through it.
- **The results did not move.** `lab/lab-check.sh` gives 12/12 RESULT lines identical to `EXPECTED-RESULTS.txt` as recorded before the reseal, in-process and in daemons, and all 144 mutation rows are identical to `mutations/RUNS-0537-cleanup_091126.tsv`.
- **The tests still bite, scenario by scenario.** Thirteen of the sealed mutations (M1 and M13 make no suite fail, as the README's Known gaps say) and six further planted kernel bugs were each run on the same planted kernel, against the old suites with the old runner and against the new suites with the new runner. Each one makes the same scenarios fail on both sides, scenario by scenario and mode by mode, none makes none fail, and every one of the 73 changed scenarios is made to fail by at least one of them.

How the 9 Nov WORDS-shape addition was checked (`v0.2.5`):
- **The JSON shape did not move.** `gen-suite1-injection.py` 1.2.1 regenerates the 20 JSON-shape scenarios byte-identical to `v0.2.4`'s.
- **The WORDS shape is the 6 Nov one, under this repo's names.** The 18 WORDS-shape scenarios were first written on 6 Nov by generator 1.2.0, outside this repository, and sealed with the JSON shape as `145468f77ea2`; they were the second agent shape of that day's real-model run. Generator 1.2.1 is 1.2.0 with the same name rows the 9 Nov reseal applied (the model name `model-a`, the person `Alex`, `alex@lab.example`, `alexs-notes`). Each new file is byte-identical to its sealed 6 Nov file with only those rows applied, the base64 payloads decoded, mapped and re-encoded. No expectation, step, grant or source changed.
- **The results.** The injection RESULT line is new: 38/38 runs as expected, hostile held 25/25, benign 12/12, in-process and in daemons. The other 10 RESULT lines are unchanged. `mutations/RESULTS-0537-cleanup-words.md` has the mutation table: only the injection rows changed, and the same 13 of 15 are caught.

**9 Nov 2026 · names in the lab's records.** On this page, in `mutations/RESULTS-*.md` and in the version lines of the lab's tools, names were replaced in place by declared rows and nothing else changed: a reviewer is "the second reader", the build model is "the build session", internal document numbers are dropped, and the build machine is "macOS". The originals are in the history of the private predecessor repository, up to its tag `v0.2.3`, kept as the private provenance record.

Real-model runs (`LAB_MODEL=real`) take the model from `LAB_MODEL_NAME`, so a neutral name in a scenario does not limit them.
