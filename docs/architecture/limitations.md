# Limitations

Kept current. Nothing listed here is claimed as done.

- Sources: NCBI nucleotide only. SNP data can't be fetched by species yet.
- Evaluation rules are configured values, not calibrated probabilities. Validation reports hold-out and missing-group results, not calibration, and small single-site groups can't be held out.
- `alignToReference` drops insertions from reference coordinates, though it reports them. Terminal tails of 5 bases or fewer are placed without an identity check, so a junk tail that short can add a few false differences.
- Gate thresholds were set from this project's data and need calibrating on others. Real-indel handling has little real test data, and the genome NUMT screen has run once and can't see copies that arose after the two species split.
- Gaps are treated as missing data. Real deletions are not modelled separately.
- Known-answer distances use a fixture anchored outside this repo with MAFFT, and compare with a published 420 bp table on 433 columns, so agreement is close and not exact (tolerance 0.15 percentage points).
- Nothing here is forensically validated. The project license and bundled tool licensing need legal review before a desktop release.
- The Mac app uses an installed IQ-TREE from Homebrew rather than bundling one, and isn't notarized or auto-updating yet, so macOS asks people to confirm the first launch.
- The Mac app's Tree tab reads Newick for display only; the OneTaxonomy export is the checked form.
- The Payload plugin stores results and controls release. It doesn't compute, and it has no admin review screen beyond Payload's own forms.
- OneTaxonomy export writes a phylogeny record, which OneTaxonomy can't yet open as a file in a Mac app because its Studio isn't built.
- Reference panels depend on human curation. The app makes review by study easy, but it doesn't read papers.
- Rule values come from the research notes and are uncalibrated. With them, groups under 5 records per column can't be compared at all, and a window with few sampling sites can't rule anything out.
