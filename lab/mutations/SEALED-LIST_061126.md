## Ask 3 — sealed mutation list (12)

Described by behaviour; map each to code and record the mapping before running. Run **every** mutation twice: with the allow-lists as configured, and with allow-lists widened to `*` so the inner layer is tested alone. Report both columns.

| # | Area | Mutation (one line) | Expected catch |
|---|---|---|---|
| M1 | fetch | host check matches by prefix/substring instead of exact hostname | none today → new (Ask 2 #1) |
| M2 | fetch | redirects followed automatically to any host | none today → new (Ask 2 #1) |
| M3 | eval, string built-ins | `replace`/`trim`/`str` return clean labels (drop input labels) | suite 2 only if a string-op route exists → likely new |
| M4 | eval, `parse-json` | result carries the control label only, data labels dropped | suite 2 model-output route |
| M5 | mailbox read | sender's labels not restored; body returns clean | suite 2 mailbox route |
| M6 | mailbox send | `grounded` NOT dropped in transit | none (expectations are safety-only) → new credential-forgery test |
| M7 | file-read | file with no sidecar reads clean instead of `web` | suite 2 file route only if a no-sidecar case exists → likely new |
| M8 | script state | remembered values return clean on the next run | suite 2 state route |
| M9 | engine load | `acceptWarnings` ignored — warned script loads anyway | suite 1 load-time scenario |
| M10 | eval, strictControl | condition's labels not joined into branch outputs | suite 2 strictControl test |
| M11 | bus, chain | child dispatch uses callee's grants, not caller ∩ callee | suite 3 / Ask 2 #6 |
| M12 | bus, rate | rate limit keyed by trace or daemon instead of identity | suite 3 mailbox 60/h, with two traces |

Two more if you want 14, both "none: needs a new test": **M13** audit "run" line written *after* `impl.run` instead of before (needs a kill-during-run test checking the line exists); **M14** dedupe stores only successful outcomes, so a refused id can be replayed (the S7 test).

Prediction to seal with the list: M1, M2, M6, M13, M14 are not caught by anything you have today. If the widened-allow-list run catches M3/M4 that suite 2 misses, that confirms the layering point and belongs in the paper.

Suite 3 as planned — go. No registrar, no kernel-to-kernel, until after the demo: agreed.
