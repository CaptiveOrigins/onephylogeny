# Roadmap: from working alpha to useful software

**Goal.** Someone with a sample and a species can answer "which lineages is this consistent with, how sure are we, and what can't we say?", reproduce that answer later, and see the evidence behind it.

Since 2026-11-10 the open items here are tracked as tasks in the maintainers' task log (K197 to K199, K214 to K233), which is where they're ranked. Each stage ends with a check someone can run. A stage isn't finished until its check passes on real data. The [phase plan](phase-plan.md) records what has happened; this page says what comes next and why.

## What mature pipelines taught us

| Tool | What it does | What we take from it |
| --- | --- | --- |
| [Nextclade](https://docs.nextstrain.org/projects/nextclade/en/stable/user/datasets.html) | Software knows no virus; all of that lives in immutable, versioned datasets that state which software versions they work with and include example sequences | Species-agnostic software, with panels as versioned datasets |
| [Nextclade output](https://docs.nextstrain.org/projects/nextclade/en/stable/user/output-files/04-results-tsv.html) | One row per input; failed sequences stay in the output with the reason; an empty field is never read as "nothing found" | Every input gets an outcome |
| [Nextclade QC](https://docs.nextstrain.org/projects/nextclade/en/stable/user/algorithm/06-quality-control.html) | Named rules with thresholds set per dataset, plus an overall status | QC rules configured per panel |
| [Pangolin](https://cov-lineages.org/resources/pangolin/output.html) | Reports conflict, ambiguity, QC status, alternatives, and the software and data versions of every call | A result says how it conflicts and what produced it |
| [Augur filter](https://docs.nextstrain.org/projects/augur/en/stable/usage/cli/filter.html) | Logs one row per removed strain with its reason and arguments; treats empty output as an error by default | Exclusion logs; an empty result is a failure |
| [Nextflow](https://docs.seqera.io/nextflow/cache-and-resume) | Hashes inputs, script and environment; one work directory per task; reuses a task only if its hash matches and its outputs exist | Content-addressed steps and honest resume |
| [Snakemake](https://snakemake.readthedocs.io/en/stable/snakefiles/rules.html) | Keeps logs on failure; `ensure()` checks outputs; per-rule retries | Check outputs after every step |
| [QIIME 2](https://docs.qiime2.org/2024.10/concepts/) | Artifacts carry a semantic type, format and full provenance; wrong input types are rejected; can generate methods text and citations | Typed artifacts with built-in provenance |
| [nf-core](https://nf-co.re/docs/guidelines/pipelines/overview) | One-command runs, CI on small test datasets, semantic versions, citations, Zenodo DOIs | The release standard to meet |

## Where the first version fell short

Found by auditing the code against those tools (2026-11-04).

| Finding | Status |
| --- | --- |
| A failed run replaced "latest", which hid the last good run | Fixed |
| Thresholds lived in the editable profile, so one "immutable" panel could change its conclusions | Fixed: sealed into the panel |
| Rebuilding could overwrite a panel version | Fixed: changed content needs a new version |
| Runs recorded no software versions; a crash left no record | Fixed |
| Writes weren't atomic; logs were rewritten on each event | Fixed |
| Saved files were trusted when loaded | Fixed in stage 1 |
| The spreadsheet left out why records were excluded | Fixed |
| The engine was one file of fixed procedures, with no step model, partial resume or cancellation | Fixed in stage 1 |
| Only fetching produced a full run record | Fixed in stage 1 |
| Heavy work ran on the Mac app's interface thread | Improved in stage 1: anchoring yields and validation runs in a worker |
| A panel is a folder of files, not a shareable dataset | Stage 2 |
| Assigning hundreds of records by hand doesn't scale | Stage 3 |
| Thresholds aren't calibrated, and hold-out validation only tests full-length records | Stage 4 |
| The aligner clipped terminal bases that carried real differences, and the known-answer test didn't call the aligner | Fixed: all 202 fragments checked now match MAFFT exactly, and the test runs the aligner |
| A gap penalty of `-6` invented false paired indels in 119 records | Fixed at `-8` |
| Records that were mostly other sequence passed the gates | Fixed: a query coverage gate |
| Validation counts didn't sum, dropped untested groups and hid records with no site | Fixed |

Fragment tests ran better than expected. Across 543 held-out tests at each of 100 to 500 bp, the true group stayed in the result at least 98.9% of the time and was never excluded, and results narrow as length grows. This is one uncalibrated experiment on one species, run before the aligner fixes below, and the calibration research warns that sites, not records, are the real sample size here.

## Stage 1: Make execution trustworthy

Everything later depends on this. It replaces fixed procedures with one model, not new features.

**Status: done (2026-11-04), with two limits.** Checked on real data: a `kill -9` at 100 of 294 downloads resumed without re-downloading; an unchanged rerun ran no steps; changing only a threshold ran only `panel` and `validate`; and a sample result traces back to the search. A test also crashes the engine at every file write and confirms it recovers to the same result. Limits: Cancel can't stop IQ-TREE mid-run, and anchoring yields on the interface thread rather than running in a worker.

1. **Artifacts.** Each output has a declared type, schema version, hash and provenance (inputs, parameters, tool versions). Loading checks all of it, so a tree can't be passed where a panel belongs.
2. **Steps.** Small named steps declare inputs, parameters and output checks. Split the engine into `fetch`, `extract`, `anchor`, `gate`, `sheet`, `panel`, `validate`, `sample` and `tree`.
3. **Content-addressed caching.** A step's key is the hash of its inputs, parameters and code version. A step is reused only if the key matches and its outputs verify.
4. **Every step gets a run record,** including panel builds, samples and trees.
5. **One error model.** Each failure has a code, plain words and a next action. Empty results fail unless allowed.
6. **Cancellation and progress.** Steps accept an abort signal and report structured progress. The Mac app runs them in a worker, so the interface stays responsive.
7. **Golden end-to-end test.** A small real fixture runs from fixture NCBI responses to a sample result in CI.

**Check:** kill a real run at any point and resume it without re-downloading or wrong output. Changing only a threshold reruns only the panel steps. Any result traces back to raw files, through artifacts alone.

## Revised order (2026-11-04)

The techniques research changes what comes next, and the [analysis protocol](analysis-protocol.md) now governs every stage. The order is integrity, provenance, evaluation, validation, then reporting. Stage 2's format waits for schema version 2, because freezing today's one-group-versus-rest format would lock in the question the evaluator should stop asking. Parts of Stage 4 therefore run alongside it.

1. **Integrity.** Close the record-check gaps, seal checks and sequences into panels, and verify on load. *Code done. The genome NUMT screen has run once for the first species and flagged nothing, which clears no record. Its library is sealed into panels built from now on.*
2. **Provenance.** Reported origins are labelled as reports, and records assigned by sequence no longer shape a panel. *Done.*
3. **Evaluation.** Named windows, sites per pair of groups, depth rules, and a `not_resolved` state. *Done, with uncalibrated rules.*
4. **Validation.** Hold-out ladder, fragments, controls and intervals on sites. Validated scope comes from a report, not by hand. *Done, including nested length selection, except the distance-based novelty test, which has no calibration data yet. Scope is exploratory until a confirmatory test runs.*
5. **Stage 2's dataset format,** on schema version 2.
6. **Reporting.** Reference-class counts instead of probabilities, then expert review.

## Stage 2: Make panels real datasets

1. **Dataset format.** A folder or zip: manifest, reference, aligned sequences, QC rules, group definitions, generalized regions, validation report, example sequences with expected results, README, changelog, citations and a compatible software range.
2. **Immutable tags and verify.** `onephylogeny verify` checks hashes and reruns the examples. *Built 2026-11-10 with example sequences and a file manifest ([ADR 0006](adr/0006-panel-dataset.md)); README, changelog, citations and a software range are still to come.*
3. **Report export.** A self-contained report for one sample: conclusion, reasons, coverage, gaps, versions and citations. *Built 2026-11-10 as Markdown and JSON (`onephylogeny report`); a PDF or the Mac app's view can render the same report.*
4. **Published JSON Schemas** for profiles, curation, panels and results. *Built 2026-11-10: generated from the types, checked for drift in tests, and shipped in the core and engine packages.*
5. **Sample routing.** Given a sequence, suggest which installed panels apply. *Built 2026-11-10 (`onephylogeny route`). Stage 2 is complete in 0.1.0-alpha.5. The dataset carries a README, its citations and the software that built it; compatibility is the examples' rerun (ADR 0006).*

**Check:** a panel built on one Mac verifies and gives identical results on another machine and through the Payload plugin.

## Stage 3: Make curation humane

This is where a real user currently gets stuck.

1. **Group audit.** Cluster haplotypes per window, on full-window records, as an audit of proposed groups. Clusters don't define groups, because on fragmented data they may just recover amplicons. *Built 2026-11-10 (`onephylogeny audit`): misfits, shared haplotypes and single-record groups per window. Strict by owner decision 2026-11-10 (ADR 0007); the redfoot 5p window is a stated limit.*
2. **Bulk tools.** Assign by study, clade or selection. Import and export the curation sheet as CSV. *Sheet import and export and assigning by study or selection built 2026-11-10 (`onephylogeny curation`); by clade waits for the group audit.*
3. **Paper lookup.** Find each study through Europe PMC and Crossref, and link supplements. Every extracted field records its source and needs approval. *Built 2026-11-10: `onephylogeny lookup`, and in the Mac app's Study tab ("Find the published paper", "Use this link").*
4. **Decision history.** Who changed what, when and why. *Built 2026-11-10: `curation-history.jsonl`, written by every save in the app and the CLI.*
5. **Guided setup.** Suggest a reference for the species and marker, with defaults a newcomer can trust and change. *Reference and genetic code built 2026-11-10 ("Suggest a reference"). Default filters and outgroups already have their own suggestions; a step-by-step first run is left for the first-run session with a person.*
6. **First-run session.** A person runs a new species end to end, and we fix what goes wrong.

**Check:** someone unfamiliar with this project builds a defensible panel for a species other than the first, unaided.

## Stage 4: Make the science defensible

Informed by the techniques research.

1. **QC rules per panel.** Named rules (missing data, mixed sites, frame, stops, clustered differences) with an overall status. *Built 2026-11-10 (`sampleQc`, `result.qc`); the default thresholds are uncalibrated proposals.*
2. **Better authenticity checks.** A NUMT screen against a genome, plus chimera and mislabel detection. *Chimera candidates built 2026-11-10 (`onephylogeny chimeras`); mislabels are the group audit's records closer to another group. On redfoot 0.7.1 neither can see 5p yet.*
3. **Stronger validation.** Fragment simulation, leave-one-study-out, per-window reports and intervals for small groups. *Leave-one-study-out and leave-one-site-out by window, each group's outcomes with exact intervals on tests, built 2026-11-10 (`leaveOneStudyOutByWindow`, `perWindowValidation`, in `fullValidation`; analysis protocol, section 9). Not yet run on real data or shown in the Mac app.*
4. **Conflict reporting.** Report when evidence supports several groups or windows disagree. *Built 2026-11-10 (`resultConflicts`, in reports).*
5. **Calibration.** Expect to refuse: at these site counts, report counts by evidence class, not probabilities. *Counts by status and single match are built, and were run on the redfoot panel 0.7.1's own records on 2026-11-08 (single matches right at 29 of 29 sites, 88.1% to 100%). The by-window and by-study outcomes were run on panel 0.6.1's records on 2026-11-11, and the prediction written beforehand held. Both are exploratory: the records also shaped the method.*
6. **Replication.** Reproduce the published assignments that have sources (Arias-Sosa 2025).
7. **Expert review.** A wildlife geneticist reviews the method and wording.

**Check:** the validation report shows, per group and fragment length, how often results are right and when the panel can't tell. An expert signs off on the wording.

## Stage 5: Show the evidence

1. Haplotype network and region map, from generalized regions only. *Haplotype network built 2026-11-10 (core, React and Mac app). Region map built 2026-11-10 in React (ADR 0008), and shown in the Mac app's Panel tab the same day, with the outlines shipped inside the app; the platform still needs to load the outlines and show it.*
2. Tree view that reuses OneTaxonomy's viewers, including paired support. *Deferred by the owner, 2026-11-10.*
3. Methods text and a citation list for each run, generated from provenance. *Built for panels 2026-11-10 (`onephylogeny methods`); Studies already had `studyMethods`.*
4. Comparison of two runs or two panel versions.

**Check:** a reader can follow one conclusion from the summary to its supporting records and papers without opening a file.

## Stage 6: Add markers

1. **Mitogenomes.** Gene-by-gene extraction and partitions, tested on real records. Alignment to a whole mitogenome already works (15,613 columns in 78 ms). *Design: [ADR 0009](adr/0009-mitogenome-panels.md). Gene windows (`geneWindows`), turning to the reference's start (`rotateToReference`) and per-gene frame and stop checks (`geneChecks`) built 2026-11-10. The engine builds mitogenome panels end to end since 2026-11-11: circular, complete records are turned before alignment (a refusal excludes the record, with the reason), windows are the reference's genes with the control region and anything left out listed in `notCovered`, and per-gene checks are reported on records and samples without changing a status. Tested on made-up records only. IQ-TREE partitions per gene and codon position built 2026-11-11. Also 2026-11-11: results from a gene-window panel carry a summary across genes (counts and lists, never a probability), shown in the report, and routing lists every panel that applies, so a whole mitogenome is offered both its mitogenome panel and a cytb panel, with cytb cut out of it. Turning samples (which carry no circular flag) still to come.*
2. **More sources.** SRA and BioSample listings, NCBI Datasets genomes, GBIF and iDigBio coverage, then BOLD. Dryad, Figshare and Zenodo stay flagged for review. *Built 2026-11-11 in acquire, as listings and counts only (`listSraRuns`, `biosampleFor`, `datasetsGenomes`, `occurrenceCoverage`, `boldCoverage`): no reads, genomes or occurrence records are downloaded, and BioSample coordinates are dropped as they're parsed. Each service's shape was checked once by hand with a real request; the tests use made-up responses. Not yet shown in the app or CLI.*
3. **Sample input.** Chromatograms, base-quality checks and a primer-to-window check. *Built 2026-11-10 in core and the CLI (`readAbif`, `assessRead`, `checkPrimers`). Joining forward and reverse reads built 2026-11-11 (`joinReads`). The Mac app's Test a sample tab and the Payload plugin (`registerTrace`) take `.ab1` files from 2026-11-11; failed and too-short reads are never tested. Not yet: a real forward and reverse pair from a tortoise, or the app tried with real files.*
4. **SNPs.** Import a prepared VCF first. Use the public RAD-Seq dataset as the test, and compare against cytb groups. Decide later whether reads-to-VCF belongs on a Mac at all. *VCF reading and the comparison with mitochondrial groups built 2026-11-11 (`parseVcf`, `compareWithGroups`). The public dataset is the 3RAD study BioProject PRJNA974719 (193 runs; Molecular Ecology 2023, doi 10.1111/mec.17052). It publishes reads but no VCF, so the real test waits on calling one.*

**Check:** a mitogenome panel and an imported SNP panel each pass the Stage 4 validation.

## Stage 7: Ship it

1. First npm publish, with trusted publishing and release workflow.
2. Mac app with signed in-app updates once the signing key is added, and IQ-TREE bundled if licensing review allows. No notarization for now, so the README and every release's notes must give both ways past macOS's warning, Open Anyway in Privacy & Security and `xattr -dr com.apple.quarantine` on that one app.
3. Documentation: a tutorial with an example dataset, and concept pages for newcomers. *Built 2026-11-11: [the tutorial](../tutorial.md) runs offline on `fixtures/tutorial` and the golden records, from fetch to a report, a Sanger trace and a primer check, and `packages/cli/test/tutorial.test.ts` runs its commands and checks their output against the page. [Concept pages](../concepts/README.md) cover panels, windows and sites, statuses, why there are no probabilities, mitochondrial and nuclear data, and privacy. Not yet: the stage check, a stranger following it on a fresh machine.*
4. Zenodo DOI for citation, and a legal review of licensing.

**Check:** a stranger installs it, follows the tutorial and gets the expected result.

## Stage 8: Captive Origins

1. Build `samples` and `sequences` with the kit workflow, and install the plugin.
2. `refresh-phylogeny.yml` and the sample sweep, following the existing `refresh-*` jobs.
3. Reviewer screens, the animal card and the detail page.
4. OnePedigree maternal-line checks on real animals.

**Check:** one real sample goes from lab upload to a reviewed result on an animal page, with no manual file handling.

## Stage 9: Hypothesis chat

Read-only and optional. It states its test before running it, cites a run for each verdict, and uses the closed verdict list (`refuted`, `not refuted`, `untestable with this data`, `tool or data problem`). It depends on stages 1, 4 and 5.

**Check:** given a false claim and an untestable one, it says so, with evidence.

## Alongside every stage

Lab-grade work runs in parallel: controls, chain of custody and procedures, with a partner lab. This software can support a validated method, but it can't be one by itself.

## Why this order

- **Stage 1 first,** because adding more on an engine without resume, provenance or cancellation multiplies later rewrites.
- **Stage 2 before curation and science,** because every later improvement needs something versioned to compare.
- **Stage 3 before more markers,** because extra data doesn't help if a person can't curate it.
- **Stage 4 before evidence views and shipping,** because polished screens over unvalidated conclusions would mislead.
- **Stage 8 last among the big stages,** because customers shouldn't see results until the method behind them holds up.
