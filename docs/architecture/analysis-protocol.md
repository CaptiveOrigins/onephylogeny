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
- **No structure,** simulated data from one population, where the honest answer is that nothing can be assigned.
- **Held-out groups,** where no remaining group should claim the record.
- **Known-bad records:** wrong gene, foreign tails, frameshifts, stops and chimeras. Each must return its exact code.

All four now run. Shuffled labels and no structure run per claim, in the validation harness.

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

**In panels.** A library saved at `profiles/<id>/numt-screen/numt-library.fasta` is sealed into each panel built afterward, so every sample is checked against the same copies under this same rule. A flag is a warning on the result, and results with no flag say that doesn't clear them. Panels built earlier have no library, and their checksums don't change.

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

**Distance-based novelty (rule version 1, committed 2026-11-11 before it ran on any data, uncalibrated).** The `novelty.flagged` above only says no evaluated group fits. This second test asks whether a query is farther from everything in the panel than the panel's own groups are from themselves. It's `noveltyByDistance` in core.

- **Records.** Only records that can show where a group occurs, the same ones the evaluator uses.
- **The panel's own distances, per window.** For each record, the distance (differences per shared column) to its nearest record in the same group from a *different site*, sharing at least `minSharedColumns` columns. Records without a site count as one site per group, as in the evaluator. Leaving out the whole site mirrors the default claim, a new site in a sampled region, and keeps duplicates from one site from pulling the threshold to zero.
- **Threshold, per window.** The 95th percentile, by nearest rank, of those distances pooled across groups. It needs at least 20 distances, since below that the 95th percentile is just the largest one. Groups with more records weigh more in the pool.
- **The query, per window.** It needs at least `minSharedColumns` columns in the window. Its distance is to the nearest panel record, of any group, that shares at least `minSharedColumns` columns with it. Beyond the threshold (strictly greater) is `possibly-novel`; at or under it is `within-range`. Too few query columns, no record sharing enough columns, or too few panel distances is `not-evaluable`, with the reason, never a guess.
- **Overall.** `possibly-novel` only if every evaluable window says so, `within-range` only if every one says that, `windows-disagree` if they differ, and `not-evaluable` if none could be tested.
- **Known weakness, left for calibration to show:** a panel whose groups are nearly clonal gets a threshold near zero, so one sequencing error can make a query `possibly-novel`.

**It changes no status.** Every answer carries `calibrated: false`, it doesn't set `novelty.flagged`, and anything that shows it must say it's uncalibrated. Wiring it into results waits on calibration.

**Calibration would mean** measuring both error rates on queries whose answer is known and that shaped neither the rule nor the panel. Known-novel queries: records of lineages the panel lacks, either whole groups of the same species left out of a panel built without them, or close relatives outside the panel (sister species, or populations from regions no group covers), from published studies. Known-sampled queries: records from sites in a group's region that the panel never saw. Both need enough independent sites, counted as in section 9 (at least 4 per lineage, and about 17 all-correct sites before a lower 95% bound reaches 0.8), from at least 2 studies, so a rate can be stated with an interval on sites. On the first species that data doesn't exist yet: the lineages that could serve as known-novel (the Guianas, Brazil east, Chaco) have 1 to 4 records and at most a few sites each. The 95th percentile and the 20-distance minimum aren't to be changed because a calibration run disappoints; a change is a new rule version and goes in the deviation log.

**Group-left-out check.** `noveltyGroupLeftOut` removes each whole group and counts how its records come out. They should mostly come out `possibly-novel`. It reports counts by outcome with no pass mark, and it isn't a calibration: a panel's own groups aren't a sample of the lineages it lacks, and they shaped the rule's inputs.

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

**Nested length.** Choosing the shortest length and scoring it on the same sites flatters it. So a claim that has passed everything else goes through one more gate: for each site, a length is chosen using only the other sites, from panels that also leave that site out, and the site is scored at that length with 5 seeded random positions per record. It passes if every site left a qualifying length, no fragment resolves wrongly and at least 95% resolve. A claim's minimum length becomes the longest length any site chose. The site's own fragments and panel exclude it throughout, and shuffled-label and no-structure controls don't repeat this step. This was committed before the step first ran on real data.

**Expected before running** (first species, West/East in 3', using the records of panel `0.6.1`): the gate passes, and the minimum length stays at 150 or rises to 200, since at 150 the fixed-position results showed none wrong. A rise wouldn't be a failure. It would mean 150 was somewhat flattered. Frozen panel `0.6.1` keeps its stated 150 either way, because its checksum is what the preregistered test names.

**Calibration, as counts.** At these site counts no probability can be honest, so the harness reports none. Each hold-out scheme also reports, for every status the panel gave (`consistent`, `inconclusive`, `excluded_within_panel`, `not_evaluable`), how many findings had it and how many of those concerned the held-out record's true group. It reports single matches separately: tests where exactly one group was consistent and the query wasn't novel, which is the only case that may name a region (P30). Those are counted by tests and by sites. A site is right only if every single match from it was right, records without a site count as tests but not sites, and the exact interval appears from 4 sites. Committed before this first ran on real data.

**Expected before running** (first species, leave-one-site-out, records of panel `0.6.1`): no `excluded_within_panel` finding concerns the true group, as in the fragment tests. No prediction is made for single-match accuracy.

**Outcomes by window and by study.** Two more reports sit beside the ladder, for every group in every window, with the query cut to that window. One holds out each site in turn (the default claim). The other holds out each study, by the study names records already carry, and tests that study's records against a panel built without it. Each test has exactly one outcome, checked in this order:

1. The true group is consistent. It's *named* if it's the only consistent group and the query isn't flagged as possibly novel, and *kept but not named* otherwise. Named results where every other group could also be compared are counted apart.
2. *Wrong*, if the true group is excluded, or another group is consistent while the true group isn't. This holds even when the true group couldn't be compared, since the result still points elsewhere.
3. *Not evaluable*, if the true group couldn't be compared and nothing is consistent.
4. *Unresolved* otherwise.

A held-out record is a query in a window only if it can show location and covers at least `minSharedColumns` there. If the panel built without it leaves its group short of `minSharedColumns` columns at `minDepthPerColumn` records in that window, the same rule a pair uses, its records are counted as not testable, with the reason. They're never dropped. Records with no study stay in every panel of the study report and are counted, never tested. A window with no column separating any pair is reported as such.

Each of "true group kept", "named" and "wrong" carries an exact Clopper-Pearson 95% interval on the number of tests, whatever the count. There's no bare rate. Clopper-Pearson was chosen over Wilson because it never covers less than it says at small counts, and section 9's gates already use it, so one report names one method. Tests from one site or study aren't independent, so these intervals are narrower than the truth, and each row gives its site count beside them. These reports gate nothing. Committed 2026-11-10, before they first ran on real data.

**Expected before running** (first species, records of panel `0.6.1`): in 3', no West or East test is wrong in either report, as in the across-studies gate. Every row for the Guianas and Chaco is not testable or has no tests, since neither reaches depth anywhere.

Values 4, 0.8 and 5% are our proposals and aren't calibrated. **They aren't to be changed because a claim failed.**

**Every claim stays labeled exploratory** until a test meeting section 2 runs. Passing these gates means a claim survived its controls on data that shaped the method, not that it's confirmed.

**Expected before running** (panel `0.6.0`):

- West/East in 3' passes.
- West/East in 5' fails on sites, since West has 2 sites and East has 1.
- West or East against Brazil east in 5' fails on sites, since Brazil east has 1.
- Every pair with the Guianas or Chaco fails, since neither reaches the required depth.
- West/East across studies is the check most likely to surprise. The two studies differ in coverage, lab and how they name groups, so a failure there would mean the split may be partly a study effect.

## 10. Preregistered tests

A test against a frozen panel is written and pushed before its data is searched for. The page names the panel by checksum, the rule that sets each record's expected group from place alone, the scoring, the pass criteria and the search queries. Localities are committed before any record in a batch is scored. The first such page is for the West/East claim on the first species, kept in the project's private workspace.

A search for records that already exist can't give a confirmatory result, however new they are to the panel, since section 2 needs records published after the freeze or sequenced blind. It's reported as out-of-sample and not confirmatory.

## 11. Deviation log

Each entry records the date, what changed, why, and which results it touches.

| Date | Change | Why | Results affected |
| --- | --- | --- | --- |
| 2026-11-04 | Protocol adopted, and all earlier results reclassified as exploratory | Owner's instruction to favor what academics would accept over a preferred answer | Everything through panel `0.3.0` |
| 2026-11-04 | Integrity fixes (commit `a8fa42b`) applied to the first species' records, with no check value changed after seeing the outcome | Records assigned by sequence could shape a group; panels weren't verified on load; some bad records could pass | Panel `0.4.0`. Of 294 records, the same 293 passed. Hold-out counts match `0.3.0` exactly. The fixes guard against failures this data didn't show, so that match isn't new evidence |
| 2026-11-04 | NUMT screen first run on real data (commit `df54e00`), with rules unchanged after seeing the outcome | Priority 0 item; `blastn` 2.17.0 against *C. abingdonii* CheloAbing_2.0 | 293 records screened: 291 *C. carbonarius* and 2 *C. denticulatus* outgroups. 0 flagged, 293 `no-signal`. Two loci in the library, 11.7% and 24.6% from the reference. This clears no record. Panel `0.4.0` isn't changed, and the library isn't in a panel yet |
| 2026-11-05 | Evaluator version 2 first run (commit `0c6f4b0`), with rules unchanged after seeing the outcome. Panel `0.5.0` | Section 8 | **Whole records, holding out each site:** the true group is consistent and alone for 177 of 177 West and East records, but with every other group compared, 0 of 177, because the Guianas and Chaco can't be compared anywhere. All 4 Guianas records are `not_evaluable` for their own group and flagged as possibly novel. Brazil east and Chaco stay untested. Removing whole groups: 0 of 193 wrongly consistent. **3' fragments, held-out sites, 5 fixed positions per record:** at 100 columns, 708 of 885 resolved West/East correctly, 177 were `not_resolved` and consistent with both, and none resolved wrongly. At 150 to 709 columns all resolved correctly, which holds for these positions only. **5' queries:** West/East can't be resolved at all, because West has 2 sites there and East has 1. Brazil east can't be excluded. **Predictions:** one was wrong. Guianas records stay in the hold-out total as `not_evaluable` rather than leaving it. The others held. All exploratory |
| 2026-11-05 | Validation harness first run (commit `8614a19`). Panel `0.6.0` | Section 9 | 1 of 20 claims passed: West/East in 3', 150+ columns. 29 of 29 sites right (lower bound 0.881), 0 of 99 shuffles equaled it (p = 0.010, the floor for 99 shuffles), and 0 of 3,540 simulated tests resolved. Every other claim failed. West/East in 5' failed on sites as predicted. Pairs with the Guianas reached later gates and failed there, since the Guianas are never comparable |
| 2026-11-05 | Found on reading that result: the across-studies gate passed with 160 records from one paper never resolved, and two of its "3 studies" were one paper | A refusal counted as "testable", and study labels came from GenBank titles, which vary between submissions by the same authors (Vargas-Ramirez, Maran and Fritz). Both reasons are independent of which records pass | Gate tightened: a study counts only if an answer was reached about it (commit `c2b8ae2`). 22 records relabeled to one study. Panel `0.6.1`: same single claim passes, on 2 studies. **The cross-study check holds in one direction only:** a panel from Arias-Sosa resolves 17 of 17 Vargas-Ramirez records correctly, while a panel from Vargas-Ramirez refuses all 160 of the others, having 2 and 1 sites. A post hoc diagnostic with the site rule off resolved all 160 correctly. That diagnostic changes no rule and isn't evidence the gate would count. Tightening further to require both directions would fail this claim, and isn't done here. Both panels stay on disk |
| 2026-11-05 | West/East test preregistered on panel `0.6.1`, then out-of-sample search run, with no rule or panel changed | Section 10. **No confirmatory test has run** | 8 mitogenomes the marker search missed. **0 independent records could be scored.** One record from Cesar resolved West on 23 of 23 sites, but it's from a panel study and exactly matches 15 panel records, so it's almost no evidence. Animals from Paraguay, Cape Verde and the pet trade were refused and flagged. **A specimen collected in 1831 in northern Peru or northern Brazil resolved East,** so East is a lineage and not a place. All descriptive |
| 2026-11-05 | Every result now carries a caveat that a match isn't a place. Fetches now report mitochondrial genomes the search missed | That finding, and the search gap. Both independent of which records pass | No verdict, rule or panel changes. Panels through `0.6.1` keep their checksums. Result files gain a caveat from this commit on |
| 2026-11-05 | Nested length gate first run (commit `2f20c57`), on a copy of panel `0.6.1`'s records, with no rule changed after seeing the outcome | Section 9 | As predicted, the same 1 of 20 claims passes, and its minimum length stays at 150 columns. All 29 sites chose 150 without their own data. Scored at that length, 885 of 885 fragments resolved correctly. At 100 columns, 733 of 885 resolved and 152 weren't resolved, with none wrong. Exploratory, and the positions are random samples, not every position. No panel was published, and `0.6.1` is unchanged |
| 2026-11-06 | Unannotated genomes now have the marker cut out by similarity, inside the fetch, then checked like any other record. Fixed from sequence similarity alone, with no reference to any group or result | Test B did this by hand with `blastn` | Same alignments as the `blastn` route for all 8 Test B genomes, and as the annotation for 4 annotated genomes located blind. No existing record's alignment or outcome changed. **Records it admits still need a group, and earlier tests aren't rerun** |
