<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
- `SEALED-LIST_061126.md` was written by the second reader and sealed before any mutation ran.
- "Ask 2", which it cites, was the second reader's list of attacks not yet tried; that list is in the private provenance record.
- M15 was added by the build session and is in `mutate.py`.
- Two mutants as built differ from the sealed list's words. M10 is sealed as an evaluator change (a condition's labels not joined into branch outputs); as built it is in the bus, `const ctlTaint = [];`, so `strictControl` does nothing. M3 is sealed as `replace`/`trim`/`str`; as built it covers `trim`, `upper`, `lower`, `replace`, `str` and `join`. `mutate.py` holds each replacement that was run.
- `shasum -a 256 SEALED-LIST_061126.md` gives the sha that `mutate.py` cites.
- The list is kept word for word as sealed. Its line 3 planned mode B as allow-lists widened to `*`; as built, mode B widens them to the attacker's host and address only (`lab/lab.js`), which is what the README says.
- To run: from the repository root, `bash lab/mutations/mutrun.sh <out.tsv> LIVE M1 … M15` (`python3`; a few minutes). Give `<out.tsv>` as an absolute path to a file that does not exist yet: the script appends to it, and resolves a relative path against `lab/`. The mutants are built in a temp folder and the kernel files are never changed; each run's results go to `lab/results/` (git-ignored).
