#!/usr/bin/env python3
# Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
# gen-suite2-laundering.py — v1.0.3 (091126: the persona is `alex`; names in comments neutral; scenarios otherwise byte-identical) · was v1.0.2 (081126: the model name is the neutral `model-a`; scenarios otherwise byte-identical) · was v1.0.1 (061126: `world` derived from what a script calls — two benign twins were mis-declared and the kernel refused them; l9 checks the CONTROL labels) · was v1.0.0 (061126) · suites/laundering: every path a label could be lost (second reader, 6 Nov). The sink is ALWAYS an
# allowed target (email to alex@lab.example), so only the label rule can stop it — a kernel with the taint rule switched off must FAIL here.
import json, os, shutil
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'suites', 'laundering')
if os.path.isdir(D):   # never delete: the old (sealed) suite is kept under suites/_superseded/<name>-<time>
    import time; os.makedirs(os.path.join(os.path.dirname(D), '_superseded'), exist_ok=True); os.rename(D, os.path.join(os.path.dirname(D), '_superseded', os.path.basename(D) + '-' + time.strftime('%Y%m%dT%H%M%S')))
os.makedirs(D)
NEWS_URL = "https://news.lab.example/today"
WEB = {NEWS_URL: {"text": "Web page text: the fall fair opens Saturday. (Untrusted: anyone could have written this.)"}}
PAGE = '(get (fetch :url "%s") "text")' % NEWS_URL
LIT = '"A note Alex wrote himself."'
MAIL = '(email :to "alex@lab.example" :subject "%s" :text %s)'
def mailer(extra=None, email_grant=None):
    a = {"fetch": {"targets": ["news.lab.example"]}, "email": email_grant or {"targets": ["alex@lab.example"]}}
    if extra: a.update(extra)
    return a
HOSTILE_EXPECT = [{"audit": {"action": "email", "outcome": "refused", "code": "TAINTED"}, "labelsInclude": ["web"], "count": ">=1"},
                  {"outbox": {"to": "alex@lab.example"}, "count": 0}, {"audit": {"action": "email", "outcome": "ok"}, "count": 0}]
BENIGN_EXPECT = [{"outbox": {"to": "alex@lab.example"}, "count": 1}, {"audit": {"outcome": "refused"}, "count": 0}]
n = 0
def put(sid, twin, about, identities, scripts, steps, expect, web=WEB, model=None):
    global n
    s = {"id": sid, "suite": "laundering", "twin": twin, "about": about, "identities": identities, "mailAllow": ["alex@lab.example"],
         "scripts": [{**x, "acceptWarnings": True, "world": any(w in x["source"] for w in ("(fetch ", "(email ", "(file-append "))} for x in scripts], "web": web, "steps": steps, "expect": expect}
    if model: s["model"] = model
    json.dump(s, open(os.path.join(D, sid + ".json"), "w"), indent=1); n += 1
def single(sid, about, src_h, src_b, extra_actions=None, email_grant=None, hostile_expect=HOSTILE_EXPECT, model=None):
    for twin, src in (("hostile", src_h), ("benign", src_b)):
        acts = mailer(extra_actions, email_grant); acts["go"] = {}
        put(sid + ("" if twin == "hostile" else "-twin"), twin, about + ("" if twin == "hostile" else " — benign twin (Alex's own text)"),
            [{"login": "mailer", "grants": {"actions": acts, "models": ["model-a"], "rate": 120}}],
            [{"name": "go", "runsAs": "mailer", "source": src}], [{"as": "mailer", "action": "go"}],
            hostile_expect if twin == "hostile" else BENIGN_EXPECT, model=model)
# 1 direct: web text straight to an allowed recipient
single("l1-direct", "web text straight into an email to an ALLOWED recipient", MAIL % ("news", PAGE), MAIL % ("note", LIT))
# 5 through a function
single("l5-function", "web text washed through a (define …) function", '(define (wash x) (str "Clean summary: " (upper (trim x))))\n' + MAIL % ("news", "(wash %s)" % PAGE),
       '(define (wash x) (str "Clean summary: " (upper (trim x))))\n' + MAIL % ("note", "(wash %s)" % LIT))
# 6 through a collection form
single("l6-collection", "web text taken apart and rebuilt by (collect …)", MAIL % ("news", '(join (collect (w (split %s " ")) (lower w)) " ")' % PAGE),
       MAIL % ("note", '(join (collect (w (split %s " ")) (lower w)) " ")' % LIT))
# 7 through a number computed from the page
single("l7-number", "only a NUMBER computed from the web page (its length) goes into the email", MAIL % ("count", '(str "The page has " (len %s) " characters.")' % PAGE),
       MAIL % ("count", '(str "The note has " (len %s) " characters.")' % LIT))
# 8 through the model's own output (no web at all: model text is labelled model)
single("l8-model", "text the MODEL wrote, with no web input, into an email", MAIL % ("greeting", '(get (model :model "model-a" :prompt "Write a one-line greeting for Alex.") "text")'),
       MAIL % ("greeting", LIT), extra_actions={"model": {}},
       hostile_expect=[{"audit": {"action": "email", "outcome": "refused", "code": "TAINTED"}, "labelsInclude": ["model"], "count": ">=1"}, {"outbox": {"to": "alex@lab.example"}, "count": 0}],
       model={"reply": "Good morning, Alex!"})
# 9 control with strictControl: the page decides WHETHER a fixed mail goes — refused when the grant asks for strict control
single("l9-strict-control", "a FIXED mail sent only IF the web page says so, with strictControl on the email grant", '(if (contains? %s "fair") %s "no")' % (PAGE, MAIL % ("fixed", LIT)),
       '(if (contains? %s "Alex") %s "no")' % (LIT, MAIL % ("fixed", LIT)), email_grant={"targets": ["alex@lab.example"], "strictControl": True},
       hostile_expect=[{"audit": {"action": "email", "outcome": "refused", "code": "TAINTED"}, "ctlInclude": ["web"], "count": ">=1"}, {"outbox": {"to": "alex@lab.example"}, "count": 0}, {"audit": {"action": "email", "outcome": "ok"}, "count": 0}])
# 2 across identities: writer reads the web and sends it on; mailer emails what it received
for twin in ("hostile", "benign"):
    wsrc = '(send :to "@id:mailer" :topic "relay" :body %s)' % (PAGE if twin == "hostile" else '"Hello from the writer, no web involved."')
    wacts = {"w": {}, "send": {"targets": ["@id:mailer"]}}
    if twin == "hostile": wacts["fetch"] = {"targets": ["news.lab.example"]}
    put("l2-across-identities" + ("" if twin == "hostile" else "-twin"), twin, "identity A reads the web and mails it via a mailbox to identity B, which emails it" + ("" if twin == "hostile" else " — benign twin (A holds no fetch, sends its own text)"),
        [{"login": "writer", "grants": {"actions": wacts, "rate": 120}}, {"login": "mailer", "grants": {"actions": {"m": {}, "messages": {"targets": ["@id:writer"]}, "email": {"targets": ["alex@lab.example"]}}, "rate": 120}}],
        [{"name": "w", "runsAs": "writer", "source": wsrc}, {"name": "m", "runsAs": "mailer", "source": MAIL % ("relay", '(get (first (messages :topic "relay")) "body")')}],
        [{"as": "writer", "action": "w"}, {"as": "mailer", "action": "m"}], HOSTILE_EXPECT if twin == "hostile" else BENIGN_EXPECT)
# 3 through a file; 4 through remembered state — two scripts of the same identity, two runs
for path, keep_h, keep_b, use in (
    ("l3-file", '(file-append :name "notes.txt" :text %s)' % PAGE, '(file-append :name "notes.txt" :text %s)' % LIT, MAIL % ("from file", '(get (file-read :name "notes.txt") "text")')),
    ("l4-state", "(remember note %s)" % PAGE, "(remember note %s)" % LIT, MAIL % ("from memory", "(remembered note)"))):
    for twin in ("hostile", "benign"):
        acts = mailer({"keep": {}, "use": {}, "file-append": {"allowTainted": True}, "file-read": {}})
        put(path + ("" if twin == "hostile" else "-twin"), twin, ("web text written to a FILE (allowed by an explicit rule), read back next run, emailed" if path == "l3-file" else "web text REMEMBERED in script state, recalled in the next run, emailed") + ("" if twin == "hostile" else " — benign twin (Alex's own text)"),
            [{"login": "mailer", "grants": {"actions": acts, "rate": 120}}],
            [{"name": "keep", "runsAs": "mailer", "source": keep_h if twin == "hostile" else keep_b}, {"name": "use", "runsAs": "mailer", "source": use}],
            [{"as": "mailer", "action": "keep"}, {"as": "mailer", "action": "use"}], HOSTILE_EXPECT if twin == "hostile" else BENIGN_EXPECT)
print("wrote %d scenarios to %s" % (n, D))
