#!/bin/bash
# Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
# lab-check.sh — v1.0.0 (071126) · runs every suite listed in EXPECTED-RESULTS.txt, in its mode, against this repo's act/, and
# compares each RESULT line exactly. The count comes from the list. Exit 0 only if every line matches and every run loaded the
# kernel recorded in KERNEL-SHA256SUMS.      usage: bash lab/lab-check.sh
set -u
cd "$(dirname "$0")" || exit 2
EXP=EXPECTED-RESULTS.txt
[ -f "$EXP" ] || { echo "STOP: no $EXP"; exit 2; }
command -v node >/dev/null || { echo "STOP: node not found"; exit 2; }
n=0; bad=0
while IFS="$(printf '\t')" read -r mode suite want; do
  case "$mode" in ''|'#'*) continue;; esac
  case "$mode" in inproc) D=0;; daemons) D=1;; *) echo "STOP: unknown mode '$mode' in $EXP"; exit 2;; esac
  n=$((n+1))
  out=$(PK_DAEMON=$D node lab.js run "suites/$suite" 1 </dev/null 2>&1)
  envl=$(printf '%s\n' "$out" | grep '^ENV' || true); got=$(printf '%s\n' "$out" | grep '^RESULT' || true)
  case "$envl" in *"(= the recorded copy of live"*) ;; *) echo "FAIL $mode $suite: the kernel loaded is not the one in KERNEL-SHA256SUMS"; printf '%s\n' "$out" | tail -5; bad=$((bad+1)); continue;; esac
  if [ "$got" = "$want" ]; then echo "ok    $mode $suite"; else echo "FAIL  $mode $suite"; echo "  want: $want"; echo "  got:  $got"; bad=$((bad+1)); fi
done < "$EXP"
[ $n -gt 0 ] || { echo "STOP: $EXP lists no suites"; exit 2; }
if [ $bad -eq 0 ]; then echo "LAB PASS — $n/$n suite runs exactly as recorded"; exit 0; else echo "LAB FAIL — $bad of $n suite runs differ"; exit 1; fi
