#!/bin/bash
# Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
# kernel-test-check.sh — v1.0.1 (071126: --test-reporter=tap on both runs — Node 26 on macOS prints the spec format even into a pipe, so v1.0.0 read no counts) · v1.0.0 (071126) · proves the one skipped test is the ONLY one skipped and the only one that needs SYNTHEKOS:
# run 1 = every test in act/test/ (expected: exactly one failure, the named server.js wiring test);
# run 2 = with that name skipped, as `npm test` does (expected: no failure, exactly one test fewer than run 1).
# The test name is read from package.json, so there is one copy of it.        usage: bash tools/kernel-test-check.sh
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT/act" || exit 2
NAME=$(node -e 'const s=require("../package.json").scripts.test; const m=/--test-skip-pattern="\^([^"]*)"/.exec(s); if(!m) process.exit(1); console.log(m[1].replace(/\\(.)/g,"$1"))') || { echo "STOP: no --test-skip-pattern in package.json"; exit 2; }
PAT=$(node -e 'const s=require("../package.json").scripts.test; console.log(/--test-skip-pattern="([^"]*)"/.exec(s)[1])')
num() { printf '%s\n' "$1" | sed -n "s/^# $2 //p" | tail -1; }
full=$(node --test --test-reporter=tap test/*.test.js 2>&1); skip=$(node --test --test-reporter=tap --test-skip-pattern="$PAT" test/*.test.js 2>&1)   # 1.0.1: TAP asked for by name (Node 26 prints spec even into a pipe)
ft=$(num "$full" tests); ff=$(num "$full" fail); st=$(num "$skip" tests); sf=$(num "$skip" fail); sp=$(num "$skip" pass)
fails=$(printf '%s\n' "$full" | grep -E '^not ok [0-9]+ - ' | sed -E 's/^not ok [0-9]+ - //')
echo "full run: $ft tests, $ff failed · skipping run: $st tests, $sp passed, $sf failed · skipped name: $NAME"
ok=1
[ "$ff" = 1 ] || { echo "FAIL: the full run should fail exactly 1 test, it failed $ff"; ok=0; }
case "$fails" in "$NAME"*) ;; *) echo "FAIL: the full run's failure is not the named test:"; printf '  %s\n' "$fails"; ok=0;; esac
[ "$sf" = 0 ] || { echo "FAIL: the skipping run has $sf failures"; ok=0; }
[ -n "$ft" ] && [ -n "$st" ] && [ $((ft - st)) = 1 ] || { echo "FAIL: the skipping run should have exactly 1 test fewer ($ft vs $st)"; ok=0; }
[ $ok = 1 ] && { echo "KERNEL TESTS PASS — $sp/$st, and the one skipped test is the only SYNTHEKOS-coupled one"; exit 0; } || exit 1
