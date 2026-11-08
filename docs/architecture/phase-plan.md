# Phase plan

Work proceeds in vertical slices. A milestone is done only when its acceptance checks pass.

| # | Deliverable | Acceptance | Status |
| --- | --- | --- | --- |
| 1 | Repo, ADRs, invariants, core records and parsers | Known-answer distances and invariants pass in CI | **Done** (2026-11-04) |
| 2 | Native tool test | Only tree building needs a native tool, because anchoring is pure TypeScript. The compiled app runs Homebrew's IQ-TREE through an allow-list | **Done, with a change** (2026-11-04): IQ-TREE isn't bundled or signed yet |
| 3 | Acquire and engine | A profile fetches every matching record, writes the sheet and full log, and retries create no duplicates | **Done** (2026-11-04): tested against live NCBI |
| 4 | Anchored alignment and gates | Frame, misalignment and wrong-gene records are caught | **Done** (2026-11-04): compared against MAFFT on real data |
| 5 | Panels and sample testing | One panel exports to JSON; a held-out sample gets per-group statuses, including `not_evaluable` | **Done** (2026-11-04) |
| 6 | Validation harness | Hold-out, missing-population and calibration reports per group | In progress: hold-out and missing-group reports exist, with counts of how often each status and single match was right. Not yet run on real data |
| 7 | React views and Mac app | Create, run, reopen and export offline | **In progress** (2026-11-04): the flow is browser-tested and the compiled app passed a one-off self-test of fetch, files and IQ-TREE. Signed updates and a person's full run are still to do. Notarization is off for now |
| 8 | Bridges and Payload plugin | Runs alone; with sister tools; host page shows a released result with its evidence | **In progress** (2026-11-04): bridges and plugin are tested; nothing is integrated in Captive Origins, and its kits and samples aren't built |
| 9 | Hypothesis chat | Read-only; states its test first; each verdict cites a run | Planned |
