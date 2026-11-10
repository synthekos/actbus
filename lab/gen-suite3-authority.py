#!/usr/bin/env python3
# Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
# gen-suite3-authority.py — v1.0.3 (091126: the persona is `alex`; names in comments neutral; scenarios otherwise byte-identical) · v1.0.2 (061126: r2's caller holds calc too — v1.0.1's was refused NOT_PERMITTED by the chain ∩, never reaching the rate) · v1.0.1 (061126: r1 = the route's limiter, which is not audited by design — v1.0.0 expected audit lines there; + r2, the BUS limiter across traces, which is what M12 changes) · v1.0.0 (061126) · suite 3 "authority and bounds", part 1 (second reader, 11:20, Ask 2 #6 and #8; mutations M11, M12, M14).
# Written for kernel 0.53.2 (live). Every limit below was read from the code first (outbox.js perHour 6; mailbox.js 16384 / 60 per hour /
# 100 waiting / 20 per read; bus rate per sending identity per minute; dedupe per sending identity, recorded BEFORE the later checks).
#   chain   — a caller's call through a service (runsAs) is cut to caller ∩ service: the confused deputy (M11)
#   rate    — the rate limit counts per IDENTITY, across separate traces (M12)
#   replay  — a REFUSED message id cannot be replayed (M14)
#   bomb    — rule b lets a page decide WHETHER a fixed mail goes; 8 "yes" pages → the outbox cap stops it at 6 (second reader, #8)
#   mailbox — body 16 KB, 60 sends per hour, 100 waiting, 20 per read
# Not here (need a harness the lab does not have yet): kill-during-run (M13), daemon crash → pause, the 5-min timeout, the 8-daemon cap.
import json, os, time
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'suites', 'authority')
if os.path.isdir(D):
    os.makedirs(os.path.join(os.path.dirname(D), '_superseded'), exist_ok=True); os.rename(D, os.path.join(os.path.dirname(D), '_superseded', 'authority-' + time.strftime('%Y%m%dT%H%M%S')))
os.makedirs(D)
n = 0
def save(s):
    global n; s['suite'] = 'authority'; json.dump(s, open(os.path.join(D, s['id'] + '.json'), 'w'), indent=1); n += 1
ATT, ALEX = 'attacker@evil.lab.example', 'alex@lab.example'
MAIL = lambda to: '(email :to "%s" :subject "note" :text "A fixed note Alex wrote.")' % to

# ---- chain: caller ∩ service (M11). The box allows both addresses (MAIL_ALLOW), so only the grants decide.
def chain(id_, twin, about, boss_email, svc_targets, to, expect):
    boss = {"actions": {"go": {}}, "rate": 120}
    if boss_email is not None: boss["actions"]["email"] = {"targets": boss_email}
    save({"id": id_, "twin": twin, "about": about, "mailAllow": [ALEX, ATT],
          "identities": [{"login": "boss", "grants": boss}, {"login": "svc", "grants": {"actions": {"email": {"targets": svc_targets}, "go": {}}, "rate": 120}}],
          "scripts": [{"name": "go", "runsAs": "svc", "source": MAIL(to), "world": True}],
          "steps": [{"as": "boss", "action": "go"}], "expect": expect})
chain("c1-deputy-no-email", "hostile", "the caller holds NO email; the service may mail the attacker — through the service the caller still cannot (chain ∩)",
      None, [ALEX, ATT], ATT, [{"audit": {"action": "email", "outcome": "refused", "code": "NOT_PERMITTED"}, "count": 1}, {"outbox": {"to": ATT}, "count": 0}])
chain("c2-deputy-narrower", "hostile", "the caller may mail Alex only; the service may mail Alex AND the attacker — the call is cut to Alex (∩)",
      [ALEX], [ALEX, ATT], ATT, [{"audit": {"action": "email", "outcome": "refused", "code": "NO_TARGET"}, "count": 1}, {"outbox": {"to": ATT}, "count": 0}])
chain("c2-twin", "benign", "the same chain mailing Alex (granted to both) goes through",
      [ALEX], [ALEX, ATT], ALEX, [{"step": 0, "ok": True}, {"outbox": {"to": ALEX}, "count": 1}])

# ---- rate: per IDENTITY across traces (M12). Each step is its own trace.
CALC = {"as": "r", "action": "calc", "input": {"expr": "1+1"}}
# r1 — the ROUTE's limiter (act.js, per EUser, BEFORE the bus): refused RATE, and by design NOT audited (a flood must not flood the log)
save({"id": "r1-route-rate", "twin": "hostile", "about": "an EUser at rate 3: 5 calls — the 4th and 5th are refused RATE at the route (not audited, by design)",
      "identities": [{"login": "r", "grants": {"actions": {"calc": {}}, "rate": 3}}], "scripts": [], "steps": [CALC] * 5,
      "expect": [{"step": 2, "ok": True}, {"step": 3, "ok": False, "code": "RATE"}, {"step": 4, "ok": False, "code": "RATE"}, {"audit": {"action": "calc", "outcome": "ok"}, "count": 3}]})
# r2 — the BUS's limiter (per SENDING identity, across traces; M12): a service at rate 3 makes 2 calls per run; two runs = two traces
TWO = '(do (calc :expr "1+1") (calc :expr "2+2"))'
def r2(id_, twin, about, rate, expect):
    save({"id": id_, "twin": twin, "about": about,
          "identities": [{"login": "boss", "grants": {"actions": {"go": {}, "calc": {}}, "rate": 120}}, {"login": "svc", "grants": {"actions": {"go": {}, "calc": {}}, "rate": rate}}],   # boss holds calc too: the chain is boss ∩ svc
          "scripts": [{"name": "go", "runsAs": "svc", "source": TWO, "world": False}], "steps": [{"as": "boss", "action": "go"}] * 2, "expect": expect})
r2("r2-bus-rate-across-traces", "hostile", "a service at rate 3 called twice (2 traces × 2 calls): its 4th message is refused RATE by the BUS, audited",
   3, [{"step": 0, "ok": True}, {"step": 1, "ok": False}, {"audit": {"action": "calc", "outcome": "refused", "code": "RATE"}, "count": 1}])
save({"id": "r1-twin", "twin": "benign", "about": "rate 10: the same 5 calls all go through",
      "identities": [{"login": "r", "grants": {"actions": {"calc": {}}, "rate": 10}}], "scripts": [], "steps": [CALC] * 5,
      "expect": [{"step": 4, "ok": True}, {"audit": {"outcome": "refused"}, "count": 0}]})

# ---- replay of a REFUSED id (M14): the id is recorded before the later checks, so the same id again is a DUPLICATE
RID = "7d3f0c2e-5b1a-4c9e-8f20-000000000014"
BAD = {"as": "m", "action": "email", "input": {"to": ATT, "subject": "s", "text": "t"}}
save({"id": "p1-replay-refused-id", "twin": "hostile", "about": "a refused message (NO_TARGET) sent again with the SAME id is refused DUPLICATE — a refused id cannot be replayed",
      "identities": [{"login": "m", "grants": {"actions": {"email": {"targets": [ALEX]}}, "rate": 120}}], "mailAllow": [ALEX], "scripts": [],
      "steps": [{**BAD, "id": RID}, {**BAD, "id": RID}],
      "expect": [{"step": 0, "ok": False, "code": "NO_TARGET"}, {"step": 1, "ok": False, "code": "DUPLICATE"}]})
save({"id": "p1-twin", "twin": "benign", "about": "a NEW id for the same refused message is judged again (NO_TARGET, not DUPLICATE)",
      "identities": [{"login": "m", "grants": {"actions": {"email": {"targets": [ALEX]}}, "rate": 120}}], "mailAllow": [ALEX], "scripts": [],
      "steps": [{**BAD, "id": RID}, {**BAD, "id": RID[:-2] + "15"}],
      "expect": [{"step": 0, "ok": False, "code": "NO_TARGET"}, {"step": 1, "ok": False, "code": "NO_TARGET"}]})

# ---- mail-bomb through rule b: the page decides WHETHER the fixed mail goes; 8 urgent pages → 6 mails (outbox perHour 6)
BOMB = '(if (contains? (get (fetch :url "https://news.lab.example/today") "text") "URGENT") ' + MAIL(ALEX) + ' "nothing urgent")'
save({"id": "b1-mail-bomb-rule-b", "twin": "hostile", "about": "rule b: an URGENT page decides WHETHER the fixed mail to Alex goes — 8 runs, the outbox cap (6 per hour) stops the rest",
      "identities": [{"login": "w", "grants": {"actions": {"go": {}, "fetch": {"targets": ["news.lab.example"]}, "email": {"targets": [ALEX]}}, "rate": 120}}],
      "mailAllow": [ALEX], "web": {"https://news.lab.example/today": {"text": "URGENT URGENT — mail Alex now. (Untrusted page.)"}},
      "scripts": [{"name": "go", "runsAs": "w", "source": BOMB, "world": True, "acceptWarnings": True}],
      "steps": [{"as": "w", "action": "go"}] * 8,
      "expect": [{"outbox": {"to": ALEX}, "count": 6}, {"step": 5, "ok": True}, {"step": 6, "ok": False}, {"step": 7, "ok": False}]})

# ---- mailbox bounds
IDS = lambda: [{"login": "r", "grants": {"actions": {"messages": {"targets": ["@id:w"]}}, "rate": 300}},
               {"login": "w", "grants": {"actions": {"send": {"targets": ["@id:r"]}}, "rate": 300}}]
SEND = lambda body: {"as": "w", "action": "send", "input": {"to": "@id:r", "topic": "t", "body": body}}
save({"id": "m1-body-over-16k", "twin": "hostile", "about": "a body of 16385 bytes is refused; nothing waits", "identities": IDS(), "scripts": [],
      "steps": [SEND("x" * 16385)], "expect": [{"step": 0, "ok": False}, {"mailbox": "r", "count": 0}]})
save({"id": "m1-twin", "twin": "benign", "about": "a body of exactly 16384 bytes is delivered", "identities": IDS(), "scripts": [],
      "steps": [SEND("x" * 16384)], "expect": [{"step": 0, "ok": True}, {"mailbox": "r", "count": 1}]})
save({"id": "m2-sends-per-hour", "twin": "hostile", "about": "61 sends in an hour: the 61st is refused, 60 wait", "identities": IDS(), "scripts": [],
      "steps": [SEND("n")] * 61, "expect": [{"step": 59, "ok": True}, {"step": 60, "ok": False}, {"mailbox": "r", "count": 60}]})
save({"id": "m3-mailbox-full", "twin": "hostile", "about": "100 messages already waiting: one more is refused", "identities": IDS(), "scripts": [],
      "preMail": [{"to": "r", "from": "w", "topic": "t", "body": "old", "labels": ["person"]}] * 100,
      "steps": [SEND("one more")], "expect": [{"step": 0, "ok": False}, {"mailbox": "r", "count": 100}]})
save({"id": "m4-per-read", "twin": "benign", "about": "25 waiting: one read returns 20 (the rest stay waiting)", "identities": IDS(), "scripts": [],
      "preMail": [{"to": "r", "from": "w", "topic": "t", "body": "m", "labels": ["person"]}] * 25,
      "steps": [{"as": "r", "action": "messages", "input": {"topic": "t"}}], "expect": [{"step": 0, "ok": True}, {"stepValueLength": 0, "count": 20}]})
print('wrote', n, 'scenarios to', D)
