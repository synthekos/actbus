<!-- Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0 -->
# Capability architecture: identities, messages, actions

*A design record from 28 Oct 2026, edited for readers of this repository. The project's build notes, internal paths and meeting references have been taken out. Sections 7 and 12 say what was built later. If this text and the code disagree, the code and its tests are right. The code in this repository is the kernel that the README and `lab/KERNEL-VERSION.txt` name.*

## 1. Three primitives
1. **Identity (who):** a person, a key-holding client (an "EUser"), a device (a microcontroller, a phone app), a script, or another node. Each identity has a key and a **capability list**:
   - which actions it may call;
   - which identities it may message;
   - which outside targets it may reach (hosts and addresses; its files stay in its own folder);
   - which models it may use.

   Every identity has a human owner.
2. **Message (how):** one envelope for everything, inbound and outbound, local or between nodes:
   `{ id, from, to, action, input, replyTo, time, trace, hops, labels, authority }`.
   Each message is checked against capabilities, audited and answered.
   - `trace` is the id of the root event.
   - `hops` is the remaining hop budget.
   - `labels` is the provenance of the input: person, device, computed, grounded, model or web.
   - `authority` lists the identities in the chain (section 9).
3. **Action (what):** logic that is registered, versioned and **sha256-pinned**. There are three kinds behind one door:
   - **native**: code installed by the administrator only;
   - **tentacle**: an adapter to the outside world.
     - `fetch`: HTTP to allow-listed hosts.
     - `email`: SMTP to allow-listed addresses.
     - `file`: only the identity's own folder.
   - **script**: PROTEUS-K logic that composes actions (see `proteus-k.md`). **Scripts are actions, and the interpreter is the sandbox.** A script touches nothing except the actions its identity may call, so programmability is open while power stays narrow.

## 2. Rules
- **The model never executes and never chooses an action on its own.** It turns language into a *proposed* script, and a person approves it before it is registered. A model may be called *by* an action (`model` is itself an action) with fixed instructions. Its output is labelled `model`, never `computed`.
- **Every message carries an identity.** A script runs *as* an identity. Every model call, tentacle call and state access carries that identity. This is the basis of isolation and of the audit.
- **No raw shell.** No action takes a command string. Hosts and addresses are allow-listed per identity; files are confined to the identity's own folder.
- **Deterministic first.** Exact jobs, such as arithmetic or reading a number from a page, are native code. The reason was measured during development: language models multiplied two four-digit numbers wrongly on every pass, and nothing showed it. A model may be a labelled fallback, never a silent one.
- **Bounded work.** Every computed action bounds its own work, because a synchronous action blocks the bus while it runs. For example, `calc` limits every intermediate result to 8 192 bits; the worst case measured was 14 ms.
- **Every run is audited:** who, the action and its hash, the input, the outcome, the node, the time and the trace. A "run" line is written *before* the action runs. No line means no run (fail closed).
- **Refuse what is inconsistent** instead of guessing. For example, "Tuesday 31 Oct 2026" is refused by `date-diff`, because 31 Oct 2026 is a Saturday.

## 3. Many models, many machines
- A **name service** maps names to nodes. `(model "<name>" …)` names a model, not a machine, and the name service routes the message to a node that serves it. Actions, tentacles and identities are named the same way. This is QNX's `name_attach` / `name_open` in effect.
- On one machine, everything routes locally with the same code. Local wins when this node serves the name, and nothing but the hash-checked registry entry may be attached locally under an action's name.
- Later, several nodes serving one model give load sharing and redundancy.

## 4. Isolation
- The model is stateless per request: each request carries its whole context, and nothing is kept between requests. A model server's prompt cache is reused only for an exactly identical token prefix, and it gives the same result as reprocessing. It cannot move one user's text into another user's answer.
- **Context creep can only come from the application**: the wrong history, the wrong corpus or the wrong script state.
- **Isolation must be proved, not trusted.** The test: identity A is told a secret word. Then identity B, a person and a script each ask for it over many passes, including concurrent requests while A's request is running. The expected result is 0 leaks. Once routing between nodes exists, the same test runs across two nodes. **Not built:** no test in this repository runs it yet (README, Known gaps).

## 5. Triggers and script state
- **Triggers:**
  - every N seconds;
  - at a time of day, in a time zone, on chosen weekdays;
  - on an event, such as an incoming message.

  Each trigger has a rule for missed runs: run late, or skip.
- **Script state:** each script has its own small key–value store (for example, the previous value of a rate). It is visible only to that script, audited, and stored with its labels.

## 6. Acceptance tests
The script lines in this section are sketches written before PROTEUS-K v0, and they do not parse. As built, a schedule is a trigger in `triggers.json` (`docs/host.md`), not an `every` form; arguments are `:keyword` arguments (`proteus-k.md` §4); and the actions are `read-number` and `file-append`.
1. **Thought mail:** every 3600 s, and once at a calendar time, the model writes one random thought and it is emailed to the owner.
   `(every 3600 :as thoughts (email "owner@example.org" (model "<model>" "Write one random thought.")))`
   This needs:
   - a trigger;
   - the model action;
   - the email tentacle;
   - an allow-listed address;
   - an explicit `allowTainted` rule on email for this identity, because the body is model text.
2. **Rate watch:** every hour, fetch a page and read a rate. If the rate fell since last time, append "hello" to a file.
   `(every 3600 :as rate-watch (let ((rate (read-rate (fetch "https://…")))) (when (and (remembered rate-before) (< rate rate-before)) (append-file "x.txt" "hello")) (remember rate-before rate)))`
   This needs:
   - the fetch tentacle with an allow-listed host;
   - a deterministic parser;
   - script state;
   - the file tentacle, confined to the identity's folder;
   - labels on each value, so that a computed comparison may fire a fixed, person-written action.
3. **The isolation test** in section 4.
4. **Mesh safety tests** (section 9):
   - a ping ↔ pong loop stops at the hop limit;
   - an injection does not travel (a page says "write pwned" → the model's summary → the file write is refused);
   - A cannot write through B when A lacks the capability;
   - a service that runs as another identity can never exceed its own grant;
   - fan-out is cut at the trace budget;
   - a duplicate id runs once;
   - taint cannot be laundered through a file.

## 7. Slices, and where each one landed
1. **Core.** This covers:
   - the envelope with trace, hops, labels and authority;
   - a hash-pinned registry compiled from the verified bytes;
   - capability intersection;
   - a local name service;
   - the bus: duplicates, trace budget, rate, taint, hop limit, timeout, a fail-closed audit, an injected clock, labels on errors;
   - the `POST /api/act` edge;
   - the actions calc, units, date-diff (exact rationals, bounded), model, fetch, file-append and file-read.

   **Built.** In this repository it is `act/core/`, `act/actions/` and `act.js`.
2. **The PROTEUS-K interpreter:** scripts as actions, labels on each value, script state. **Built:** `act/proteus/`.
3. **Triggers and the scheduler,** the email tentacle, and later mailboxes between identities. **Built:** `act/scheduler.js`, `act/mail/` and `act/mailbox.js`. See `functions-and-mailboxes.md`.
4. **Multi-node routing** (the name service across machines), then sandboxed native actions and supervisors. **Not built:** the name service is local only. Per-identity daemon processes with a supervisor *are* built (`act/daemon/`).

## 8. (Removed: questions for the owner that have since been settled. The answers are in the code and in `proteus-k.md`.)

## 9. A mesh of identities messaging each other on conditions
Technically this is the **actor model** (as in Erlang or Akka), with some actors backed by a language model. Each failure mode forces a rule:
1. **Loops and storms** → a hop limit and a trace id in every envelope; per-identity rate limits and trace budgets. Cycles in the static "who may message whom" graph are refused unless explicitly allowed (designed, not built: the code refuses cycles only between script-to-script calls, `act/core/registry.js`).
2. **Injection travels** (poisoned web text steering an action several hops later; the biggest danger) → model output is *data*, never instructions, at every hop. Every message carries provenance labels, and conditions that fire actions are evaluated by code on typed values. A world action fed by web- or model-labelled input needs an explicit rule or a person.
3. **Confused deputy** → authority attenuates along a chain. An action triggered through a chain may do only what *every* identity in the chain may do (intersection). This is object-capability discipline.
4. **Errors compound** (about 95 % correct per model hop was measured, so 5 hops is about 77 %) → few model hops, computed conditions and plain data passing. Labels propagate, so the result shows whether *any* step was a model.
5. **Distributed failure** → message ids with duplicate suppression, timeouts, and supervisors ("let it crash").
6. **Nobody can see the mesh** → a static graph view, cycle-checked before anything runs, and a live trace. "Explain this outcome" walks the trace back to its cause. (Designed, not built: what exists is the audit log, where every line carries its trace id.)
7. **Accountability** → every chain traces back to a human owner; no behaviour is orphaned.

Most real needs are pipelines, not general meshes, so start acyclic and allow cycles only when a real case demands them. The point of difference is a mesh in which every message carries its provenance and authority, so any outcome can be explained back to its evidence and to a person.

## 10. (Removed: the appliance-level design built on this kernel. It is not part of this repository.)

## 11. Bounded plasticity (designed, not built)
Permissions may change without a person, but **only inside an envelope that a person set in advance.** The person approves the envelope once, as a meta-permission, and the system moves within it on its own.
- **An envelope per capability:**
  - what may grow (for example, fetch targets within one domain, a rate between 10 and 120 per minute, a threshold between 2 °C and 6 °C);
  - what may never change (world actions to new recipients, new tentacle kinds, anything irreversible).
- **Evidence to move.** A change needs a computed reason from the audit (for example, "this rule fired 40 times, all confirmed useful"), never a model's say-so. The model may propose; code checks the evidence against the envelope and applies it.
- **Reversible and decaying.** Every automatic change is logged as its own audited event, can be rolled back with one command, and lapses unless it is used or confirmed.
- **Tightening is always free; widening is bounded.** The system may reduce its own permissions at any time, but may widen them only inside the envelope.
- **Tripwires.** A widening inside a chain that carried model or web labels, or a sudden rise in refusals, freezes plasticity for that identity and alerts its owner.
- **Never plastic:** the envelopes themselves, identity ownership, the taint rule, hash pinning and the audit. Learning must never be able to rewrite its own limits.

## 12. What the first adversarial review taught
A second reader, a separate AI session, was given only the code and the rules, not the authors' reasoning (`reviews.md`, 28 Oct). It broke the first version of the core seven ways while all 29 of its tests passed:
1. **High: run-as.** A service identity's own grant (action, targets, taint rule) was never checked when the service ran a world action on someone's behalf. A caller could reach hosts the service may not reach, or pass model text through it. **Fix:** grow the chain first, then check everything on the grown chain.
2. **High: calc.** A 97-character input froze the whole bus for 120 s, because only powers were bounded. **Fix:** every intermediate result is bounded and operand sizes are checked first; the worst case is now 14 ms.
3. **Medium: taint laundered through a file.** Text written as model text read back as computed. **Fix:** provenance is stored with each file and returned on read; a file with no provenance reads as web.
4. **Medium: a dangling symlink** escaped the folder on append, through a gap between check and use. **Fix:** `O_NOFOLLOW`, and the checks are made on the open handle.
5. **Low, three findings:**
   - duplicate ids were shared across identities;
   - inherited field names passed the input checks;
   - `needs` limited only `require()`, so it is now documented as a declaration, not confinement.

Lessons for every later slice:
- (a) the authors' own tests confirmed the authors' own model of the code, so an outside adversary is part of the test standard for anything in the trusted core;
- (b) a new test proves a fix only if it *fails* on the old code, so run it there;
- (c) provenance must persist wherever data persists (files, script state), or taint leaks through storage;
- (d) a synchronous action is a denial-of-service risk unless it bounds its own work.

Prior art: Google DeepMind's CaMeL (arXiv 2503.18813, 2025) puts capabilities and provenance on every value around an untrusted language model. This design reached the same idea independently.
