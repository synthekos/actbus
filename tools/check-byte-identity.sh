#!/bin/bash
# Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
# check-byte-identity.sh — v1.1.0 (081126: an ACTBUS ref other than the tag — its act.js + act/** only, no root rule) · was v1.0.0 (071126)
# Two forms, both read-only (only `git ls-tree`, `rev-parse`, `rev-list`):
#  · TAG alone: ACTBUS's TAG holds exactly SYNTHEKOS's act.js + act/** at its TAG — the same set of paths, modes and git blob hashes
#    (the committed objects, not a checkout), nothing missing and nothing extra in the WHOLE tree — and is a root commit.
#  · TAG and REF: ACTBUS's REF (e.g. v0.1.1) holds, under act.js + act/**, exactly SYNTHEKOS's act.js + act/** at TAG. The rest of
#    REF's tree (README, lab, docs, tools) is not compared, and REF may have history.
#   usage: bash tools/check-byte-identity.sh <synthekos-repo> <actbus-repo> [tag, default v0.53.5-headers] [actbus-ref, default = tag]
set -u
LIVE=${1:?usage: check-byte-identity.sh <synthekos-repo> <actbus-repo> [tag] [actbus-ref]}; REPO=${2:?usage}; TAG=${3:-v0.53.5-headers}; REF=${4:-$TAG}
[ $# -le 4 ] || { echo "STOP: too many arguments"; exit 2; }
A=$(mktemp); B=$(mktemp); trap 'rm -f "$A" "$B"' EXIT
git -C "$LIVE" rev-parse -q --verify "$TAG^{commit}" >/dev/null || { echo "STOP: $LIVE has no tag $TAG"; exit 2; }
git -C "$REPO" rev-parse -q --verify "$REF^{commit}" >/dev/null || { echo "STOP: $REPO has no $REF"; exit 2; }
git -C "$LIVE" ls-tree -r --full-tree "$TAG" -- act.js act > "$A" || { echo "STOP: ls-tree failed in $LIVE"; exit 2; }
if [ "$REF" = "$TAG" ]; then git -C "$REPO" ls-tree -r --full-tree "$REF" > "$B"; else git -C "$REPO" ls-tree -r --full-tree "$REF" -- act.js act > "$B"; fi || { echo "STOP: ls-tree failed in $REPO"; exit 2; }
n=$(wc -l < "$A" | tr -d ' '); m=$(wc -l < "$B" | tr -d ' ')
[ "$n" -gt 0 ] || { echo "FAIL: SYNTHEKOS's $TAG has no act.js / act/ entries"; exit 1; }
nb=$(grep -vc '^[0-9]* blob ' "$A" || true); [ "$nb" = 0 ] || { echo "FAIL: $nb entries in SYNTHEKOS's list are not plain files (submodule/link?)"; exit 1; }
roots=$(git -C "$REPO" rev-list --count "$REF")
echo "SYNTHEKOS $TAG = $(git -C "$LIVE" rev-parse --short "$TAG^{commit}") · act.js + act/: $n entries"
if [ "$REF" = "$TAG" ]; then what="whole tree"; else what="act.js + act/"; fi
echo "ACTBUS    $REF = $(git -C "$REPO" rev-parse --short "$REF^{commit}") · $what: $m entries · commits in its history: $roots"
ok=1
if cmp -s "$A" "$B"; then echo "same paths, modes and blob hashes: $n/$n"; else echo "FAIL: the trees differ (< SYNTHEKOS, > ACTBUS):"; diff "$A" "$B" | head -40; ok=0; fi
[ "$REF" != "$TAG" ] || [ "$roots" = 1 ] || { echo "FAIL: ACTBUS's $TAG should be a root commit (1 commit), it has $roots"; ok=0; }
if [ "$REF" = "$TAG" ]; then claim="ACTBUS $TAG is SYNTHEKOS $TAG's act.js + act/, nothing else"; else claim="ACTBUS $REF's act.js + act/ are SYNTHEKOS $TAG's, nothing missing, nothing extra"; fi
[ $ok = 1 ] && { echo "BYTE-IDENTITY PASS — $claim"; exit 0; } || exit 1
