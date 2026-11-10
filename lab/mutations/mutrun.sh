#!/bin/bash
# Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
# mutrun.sh — v2.0.0 (071126: ACTBUS repo) · runs the lab against the repo's kernel (LIVE) and against each mutant Mi made by
# mutate.py from a COPY of act.js + act/ (the repo is never changed). Mode A = the sealed suites as written; mode B = allow-lists
# widened to the attacker (LAB_WIDEN=1), so the inner layers are tested alone. A mutant is CAUGHT when any run is not as expected.
# usage: bash lab/mutations/mutrun.sh <out.tsv> LIVE M1 M2 …      (appends; one line per kernel × mode × suite)
set -u
cd "$(dirname "$0")/.." || exit 1          # lab/
ROOT=$(cd .. && pwd); OUT=$1; shift
TMP=${TMPDIR:-/tmp}/actbus-mut.$$; mkdir -p "$TMP/k"; cp -R "$ROOT/act" "$ROOT/act.js" "$TMP/k/"
[ -f "$OUT" ] || printf '# %s · kernel = %s · seed 1 · stand-in model\nM\tmode\tsuite\tas-expected\ttotal\n' "$(grep -o "lab [0-9.]*'" lab.js | head -1 | tr -d "'")" "$(cat KERNEL-VERSION.txt | grep -o '"version": "[^"]*"' | cut -d'"' -f4)" > "$OUT"
for M in "$@"; do
  if [ "$M" = LIVE ]; then KD=$ROOT; else python3 mutations/mutate.py "$TMP/k" "$TMP/$M" "$M" >/dev/null || { echo "$M REFUSED"; continue; }; KD=$TMP/$M; fi
  for mode in A B; do for su in injection laundering allowlist edges authority selftest; do
    if [ $mode = B ]; then case $su in allowlist|selftest|authority) continue;; esac; W=1; else W=0; fi
    line=$(LAB_KERNEL=$KD LAB_WIDEN=$W node lab.js run suites/$su 1 2>&1 | grep '^RESULT')
    exp=$(echo "$line" | sed -E 's/.*: ([0-9]+)\/([0-9]+) runs.*/\1	\2/')
    [ -n "$line" ] || exp="?	?"
    printf '%s\t%s\t%s\t%s\n' "$M" "$mode" "$su" "$exp" >> "$OUT"
  done; done
  echo "$M done"
done
rm -rf "$TMP"
