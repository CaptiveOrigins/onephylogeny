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
| P7 | **Frame is checked under the stated genetic code.** Alignment steps that break frame fail the build. | `core.test.ts` (frames); build gate pending |
| P8 | **Gene names match exactly,** never by substring. | `core.test.ts` (GenBank) |
| P9 | **Provenance starts unknown.** GenBank location is not treated as origin; publications are kept with each record. | `core.test.ts` (GenBank) |
| P10 | **Exact coordinates are opt-in.** Sheets leave them out by default; distributed panels use generalized regions. | `core.test.ts` (record sheet), `panel.test.ts` (panels) |
| P11 | **Every exclusion has a reason.** | `core.test.ts` (profiles) |
| P12 | **Assigned records are never evidence of location.** | `panel.test.ts` (panels) |
| P13 | **Claims are scoped** to one group and panel version. | `panel.test.ts` (results); windows pending |
| P14 | **Failures stop a run;** retries can't duplicate records and skips can't pass silently. | Pending (acquire) |
| P15 | **Stated confidence must be calibrated** before it is shown as a probability. | Pending (validation) |
| P16 | **Saved results are never rewritten.** A new panel creates new results. | Pending (results) |
