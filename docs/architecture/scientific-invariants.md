# Scientific invariants

Every package keeps these rules. A rule without a passing test is pending, and is listed as pending here.

| # | Invariant | Test |
| --- | --- | --- |
| P1 | **Species agnostic.** Package source names no taxon, gene or region; all of it comes from configuration. | `core.test.ts` (species agnostic) |
| P2 | **One coordinate system.** Sequences are compared only in shared reference coordinates; anything else is refused. | `core.test.ts` (comparison) |
| P3 | **Missing data is not a difference.** Gaps and N never count as differences. Ambiguity codes that could match are reported as unresolved. | `core.test.ts` (comparison) |
| P4 | **No shared sites means not evaluable,** never excluded, and distance is `null`, not zero. | `core.test.ts` (comparison), `panel.test.ts` (results) |
| P5 | **A shorter record is not a longer haplotype.** Exact matches only within one coverage; compatibility is reported separately and is not transitive. | `core.test.ts` (haplotypes) |
| P6 | **Published values are tests.** Known-answer distances must stay close to published tables. | `core.test.ts` (known-answer) |
| P7 | **Frame is checked under the stated genetic code.** Records that break frame can't enter a panel. Translation still reads reference columns, so a query-frame check is pending. | `core.test.ts` (frames), `build.test.ts` (gates) |
| P8 | **Gene names match exactly,** never by substring. | `core.test.ts` (GenBank) |
| P9 | **Provenance starts unknown.** GenBank location is not treated as origin; publications are kept with each record. | `core.test.ts` (GenBank) |
| P10 | **Exact coordinates are opt-in.** Sheets leave them out by default; distributed panels use generalized regions. | `core.test.ts` (record sheet), `panel.test.ts` (panels) |
| P11 | **Every exclusion has a reason.** | `core.test.ts` (profiles) |
| P12 | **Assigned records are never evidence of location,** and don't shape a group's coverage, sites, spread, findings or validation. | `panel.test.ts` (panels), `build.test.ts` (records assigned by their own sequence) |
| P13 | **Claims are scoped** to one group and panel version. | `panel.test.ts` (results), `build.test.ts` (evaluator version 2) |
| P14 | **Failures stop a run;** retries can't duplicate records and skips can't pass silently. | Pending (acquire) |
| P15 | **Stated confidence must be calibrated** before it is shown as a probability. | Pending (validation) |
| P16 | **Saved panels are never rewritten.** Changed content needs a new version, and results name the exact version. | `engine.test.ts` (runs and panels stay true) |
| P17 | **A panel's conclusions can't change after sealing.** Thresholds, record checks and sequences are sealed, and loading verifies them. | `engine.test.ts`, `panel.test.ts`, `build.test.ts` |
| P18 | **A failed run never replaces the last good one.** | `engine.test.ts` |
| P19 | **A crash can't produce wrong results.** Recovery from a failure at any write gives the same outcome. | `engine.test.ts` (surviving a crash) |
| P20 | **Every input gets an outcome.** Excluded records stay in the output with their reasons. | `engine.test.ts`, `golden.test.ts` |
| P21 | **A reported origin names its source.** | `panel.test.ts` (panels) |
| P22 | **An unannotated record gets the same checks,** unless it's many times the reference's length. | `build.test.ts` (gates) |
| P23 | **Adding a group can't erase what separates two others.** Sites belong to a pair of groups in a named window. | `build.test.ts` (evaluator version 2) |
| P24 | **One record never makes a group comparable, and one site never rules a group out.** Records with no site count as one. | `build.test.ts` (evaluator version 2) |
| P25 | **Consistent with two groups isn't telling them apart.** A query covering no separating site gets `not_resolved`. | `build.test.ts` (evaluator version 2) |
| P26 | **Novelty belongs to the query.** It never overwrites a finding, and groups that couldn't be compared are named as candidates. | `build.test.ts` (evaluator version 2) |
| P27 | **A panel's sites follow from its data.** Loading derives them again and refuses a mismatch. | `build.test.ts` (evaluator version 2) |

What these results can claim, and which rules are fixed before a test, is set out in the [analysis protocol](analysis-protocol.md).
