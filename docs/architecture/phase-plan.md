# Phase plan

Work proceeds in vertical slices. A milestone is done only when its acceptance checks pass.

| # | Deliverable | Acceptance | Status |
| --- | --- | --- | --- |
| 1 | Repo, ADRs, invariants, core records and parsers | Known-answer distances and invariants pass in CI | In progress |
| 2 | Native tool spike | One signed binary runs from a Tauri test app | Next |
| 3 | Acquire and engine | A profile fetches every matching record, writes the sheet and full log, and retries create no duplicates | Planned |
| 4 | Anchored alignment and gates | Frame, misalignment and wrong-gene records are caught | Planned |
| 5 | Panels and sample testing | One panel exports to JSON; a held-out sample gets per-group statuses, including `not_evaluable` | Planned |
| 6 | Validation harness | Hold-out, missing-population and calibration reports per group | Planned |
| 7 | React views and Mac app | Create, run, reopen and export offline | Planned |
| 8 | Bridges and Payload plugin | Runs alone; with sister tools; host page shows a released result with its evidence | Planned |
| 9 | Hypothesis chat | Read-only; states its test first; each verdict cites a run | Planned |
