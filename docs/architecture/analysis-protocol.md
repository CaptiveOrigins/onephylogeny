# Analysis protocol

This page says what a OnePhylogeny result can claim, and which rules are fixed before anyone looks at the outcome. It exists so the software can't drift toward the answer its builders expect. Git history gives each rule a date, so a rule can be shown to predate the result it governs.

**Status: draft, written by the developers.** No outside scientist has reviewed it. That review is a roadmap item, and this page shouldn't be cited as an accepted standard until it happens.

## 1. Every result so far is exploratory

This covers every panel through `0.3.0`, including its 181 of 181 held-out records and 0 of 193 false claims, the fragment experiment, and every `[local]` figure in the techniques report.

Those hold-out tests are useful checks. They aren't independent confirmation, because:

- The working groups were drawn by people who had read the papers and seen these sequences.
- Thresholds, gates and the aligner were changed after seeing how they behaved on these records.
- Group labels and test truth come from the same few studies.

**No further split of these records can undo that.** Hold-out still measures how a method behaves. It doesn't make a claim confirmed. Reports must describe such results as exploratory.

## 2. What counts as confirmatory

A result is confirmatory only if all of these hold:

1. The method, thresholds, groups and pass criteria were frozen in a sealed panel before the test.
2. The test records were unknown to whoever built the panel: published after the freeze, or sequenced with origin withheld and held by someone else until results are in.
3. The test and its pass criteria were written down before the data was seen.
4. Every test is reported, including failures and refusals.
5. Records from a test become part of later panels only under a new version, and can't confirm that version.

No confirmatory test has been run yet.

## 3. Rules that don't bend to outcomes

- **Check values aren't tuned to keep records.** The check values in `DEFAULT_GATES` are uncalibrated starting values. If a check excludes records someone wanted, that alone is no reason to change it. A change needs a reason independent of which records it keeps, goes in the deviation log, and creates a new panel version.
- **Single records get reviewed, not rules.** A person may review one excluded record and restore it through a stated, logged reason that names evidence from outside the check, such as a second sequence of the same specimen.
- **Groups are hypotheses.** A working group is a claim the data may fail to support. A group that can't be tested is reported as untestable, and it's not merged, split or redrawn to improve a score.
- **Labels from sequence are never truth.** A record assigned to a group by its own sequence can't define that group, count as location evidence or score a test.
- **A reported origin is a report.** `origin-reported` means a source says so. `wild-documented` needs independent documentation of collection in the wild.
- **Sites are the sample size, not records.** Where site counts are too low for a percentage, report counts.
- **Differentiated isn't assignable.** Both verdicts are reported separately, and neither is merged into a score.
- **No probability is shown** until held-out evidence shows it matches observed accuracy.
- **Refusing is a valid result.** `not_evaluable` and `not_resolved` aren't failures to be engineered away.
- **Failed tests stay visible.** A failed or surprising run isn't rerun under new settings and reported as the first attempt.

## 4. Controls

Validation must include controls that a working method should do badly on, or a good score means little:

- **Shuffled labels,** moved between whole sites.
- **No structure,** simulated panmictic data, where the honest answer is that nothing can be assigned.
- **Held-out groups,** where no remaining group should claim the record.
- **Known-bad records:** wrong gene, foreign tails, frameshifts, stops and chimeras. Each must return its exact code.

Only held-out groups and known-bad records are in the test suite today. The other two are planned for the validation harness.

## 5. Multiple tests

Each panel version keeps a list of every claim tested against it, including those that came to nothing. Tests are corrected for that count, and permutations move whole sites.

## 6. What this page can't fix

- Software can't validate a method alone. Lab controls, chain of custody and independent replication sit outside it.
- Mitochondrial DNA is one maternal history. Agreeing sites aren't independent tests, and hybrid or introgressed animals can carry a lineage from elsewhere.
- Sampling is uneven. Absence from a panel says little about absence from a place.
- What "known origin" means in the source tables remains unconfirmed.

## 7. NUMT screen

A NUMT is an old copy of mitochondrial DNA in the nuclear genome, and it can pass for the real gene. This screen runs outside the app, once per species, using `scripts/numt-screen.mjs`. These rules were committed before the script first ran on real data. Any later change goes in the deviation log.

**Search.** Against the nuclear sequences of a related assembly, with any sequence the assembly report names as the organelle removed:

- `blastn -task blastn` with the species' whole mitogenome, its marker and every record.
- `tblastn` with the translated marker, using genetic code 2. The paper below used TFASTX with an MD40 matrix. `tblastn` with `PAM70` is a substitute chosen for what BLAST+ offers, and it's untested against theirs.
- A hit counts at E below 0.001 and at least 30 nucleotides or 10 amino acids. Loci meeting the stricter E below 1e-10 (1e-6 for protein) are counted too. These values follow [Triant & Pearson 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9723244/), and none is calibrated for tortoises. Mitogenome hits count only where they overlap the marker.

**Organelle-like scaffolds.** The paper gives no rule for these, so this one is ours: a scaffold of at most 20 kb with at least half its length in mitogenome hits is reported apart as possible organelle sequence. It stays out of the library.

**Flag rule.** Overlapping hits merge into loci, and each locus is placed on reference columns. A record is tested against a locus when they share at least 100 columns. It's `flagged-for-review` if it's strictly closer to the copy than to the species' reference on those same columns. Otherwise it's `no-signal`, or `not-assessed` if no locus shares enough columns. Records under 313 bases are also marked short, the length below which [Schultz & Hebert 2022](https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&query=TITLE:%22Do%20pseudogenes%20pose%20a%20problem%20for%20metabarcoding%20marine%20animal%20communities%22) found most risk in COI.

**What each result means.**

- A flag sends a record to review. It doesn't exclude the record, and it doesn't prove a NUMT.
- `no-signal` doesn't clear a record. A copy that entered the genome after the two species split can't be in this assembly, and only one individual's genome is searched. Reports must never say a record passed this screen as if it were cleared.
- The distance from the found copies to the reference is reported, because copies far from every record leave this rule little power: a record has to come very close before the rule can fire.
- Results on panels through `0.4.0` are exploratory, since the records aren't new.

`scripts/numt-fixture.py` builds a synthetic genome with planted copies, to check the script before use.

## 8. Evaluator version 2

The evaluator stops asking "which group is this?" as one question. It asks whether a group can be compared at all, whether the columns a query covers separate each pair of groups, and whether a group has enough independent sites to be ruled out. These rules were committed before this evaluator ran on real data. Any later change goes in the deviation log.

**Rule values.** `minSharedColumns` 100, `minDepthPerColumn` 5, `minBlocksForExclusion` 3, `minDecisiveSites` 2, `tolerance` 1. They come from the techniques research, written before this code existed, and none is calibrated. **They aren't to be lowered because a group becomes untestable.**

**First species.** Windows follow where the amplicons start and stop, not any result: 5' is columns 1 to 435, and 3' is 436 to 1144. Records without a site all count as one block per group, so missing data can't look like independent sites.

**Expected before running** (panel `0.5.0`, against `0.4.0`):

- The Guianas (4 records) and Brazil south/Chaco (2) become `not_evaluable` everywhere, because no column reaches depth 5. Their counts leave the hold-out totals.
- Brazil east can be compared in 5' only. With one site it can't be excluded, so a query it doesn't fit stays `inconclusive`.
- 3' queries get `not_evaluable` for Brazil east, and `candidatesNotEvaluated` names it.
- Short fragments with no decisive site give `not_resolved` for West/East.
- The share of tests where only the true group is consistent may fall. If it does, that's the cost of asking a harder question, and it gets reported as it is.

**Reporting.** Hold-out results go in the deviation log whether or not they match these expectations, labeled exploratory. Nothing above becomes a confirmatory test, since these records shaped the method.

## 9. Validation harness

A claim here is narrow: "this panel separates groups A and B in window W, for queries of at least N columns." The harness tests claims and fills `validatedScope` from what passes. Nobody types a scope by hand. These gates were committed before the harness ran on real data. Any later change goes in the deviation log.

**Hold-out schemes, reported side by side and never averaged.** Each record's site, study and whole group are held out in turn, plus each exact haplotype. Leave-one-record-out appears only as a leak detector. Leave-one-site-out is the default claim: a new site in a sampled region.

**Reporting by sites.** Every row gives sites beside records. Below 4 sites it shows counts only. From 4 sites it adds an exact Clopper-Pearson interval on sites, where a site counts as correct only if all its records are.

**Gates. A claim passes only if all hold:**

1. **Sites.** Each group has at least 4 sites holding records in the window.
2. **No wrong answers.** Holding out each site, no test resolves the pair toward the wrong group.
3. **Interval.** The lower 95% bound on correct sites, across both groups, is at least 0.8. In practice that needs at least 17 sites, all correct.
4. **Across studies.** The records come from at least 2 studies, at least one study's records can be tested against a panel built without it, and that panel never resolves them toward the wrong group.
5. **Shuffled labels.** Moving whole sites between the two groups, the real score beats the shuffled ones at p <= 0.05, using 99 shuffles and (b+1)/(B+1).
6. **No structure.** On simulated data from one population, keeping each record's coverage, site and group, at most 5% of tests resolve the pair at all, over 20 simulations. The simulation is a seeded coalescent, with its mutation rate set from the mean pairwise differences of the real pooled records.

**Length.** A claim's minimum length is the shortest of 100, 150, 200, 300, 400 or 500 columns where no fragment resolves wrongly and at least 95% resolve. Fragments use 5 seeded random positions per record, on held-out sites. If none qualifies, the claim doesn't pass.

Values 4, 0.8 and 5% are our proposals and aren't calibrated. **They aren't to be changed because a claim failed.**

**Every claim stays labeled exploratory** until a test meeting section 2 runs. Passing these gates means a claim survived its controls on data that shaped the method, not that it's confirmed.

**Expected before running** (panel `0.6.0`):

- West/East in 3' passes.
- West/East in 5' fails on sites, since West has 2 sites and East has 1.
- West or East against Brazil east in 5' fails on sites, since Brazil east has 1.
- Every pair with the Guianas or Chaco fails, since neither reaches the required depth.
- West/East across studies is the check most likely to surprise. The two studies differ in coverage, lab and how they name groups, so a failure there would mean the split may be partly a study effect.

## 10. Deviation log

Each entry records the date, what changed, why, and which results it touches.

| Date | Change | Why | Results affected |
| --- | --- | --- | --- |
| 2026-11-04 | Protocol adopted, and all earlier results reclassified as exploratory | Owner's instruction to favor what academics would accept over a preferred answer | Everything through panel `0.3.0` |
| 2026-11-04 | Integrity fixes (commit `a8fa42b`) applied to the first species' records, with no check value changed after seeing the outcome | Records assigned by sequence could shape a group; panels weren't verified on load; some bad records could pass | Panel `0.4.0`. Of 294 records, the same 293 passed. Hold-out counts match `0.3.0` exactly. The fixes guard against failures this data didn't show, so that match isn't new evidence |
| 2026-11-04 | NUMT screen first run on real data (commit `df54e00`), with rules unchanged after seeing the outcome | Priority 0 item; `blastn` 2.17.0 against *C. abingdonii* CheloAbing_2.0 | 293 records screened: 291 *C. carbonarius* and 2 *C. denticulatus* outgroups. 0 flagged, 293 `no-signal`. Two loci in the library, 11.7% and 24.6% from the reference. This clears no record. Panel `0.4.0` isn't changed, and the library isn't in a panel yet |
| 2026-11-05 | Evaluator version 2 first run (commit `0c6f4b0`), with rules unchanged after seeing the outcome. Panel `0.5.0` | Section 8 | **Whole records, holding out each site:** the true group is consistent and alone for 177 of 177 West and East records, but with every other group compared, 0 of 177, because the Guianas and Chaco can't be compared anywhere. All 4 Guianas records are `not_evaluable` for their own group and flagged as possibly novel. Brazil east and Chaco stay untested. Removing whole groups: 0 of 193 wrongly consistent. **3' fragments, held-out sites, 5 fixed positions per record:** at 100 columns, 708 of 885 resolved West/East correctly, 177 were `not_resolved` and consistent with both, and none resolved wrongly. At 150 to 709 columns all resolved correctly, which holds for these positions only. **5' queries:** West/East can't be resolved at all, because West has 2 sites there and East has 1. Brazil east can't be excluded. **Predictions:** one was wrong. Guianas records stay in the hold-out total as `not_evaluable` rather than leaving it. The others held. All exploratory |
