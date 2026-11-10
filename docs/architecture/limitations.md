# Limitations

Kept current. Nothing listed here is claimed as done.

- Sources: NCBI nucleotide only. SNP data can't be fetched by species yet.
- Evaluation rules are configured values, not calibrated probabilities. Validation reports hold-out and missing-group results, and counts how often each reported status and each single match was right, but never a probability. These counts haven't run on real data yet, and small single-site groups can't be held out.
- `alignToReference` drops insertions from reference coordinates, though it reports them. Terminal tails of 5 bases or fewer are placed without an identity check, so a junk tail that short can add a few false differences.
- Gate thresholds were set from this project's data and need calibrating on others. Real-indel handling has little real test data, and the genome NUMT screen has run once and can't see copies that arose after the two species split.
- Gaps are treated as missing data. Real deletions are not modelled separately.
- Known-answer distances use a fixture anchored outside this repo with MAFFT, and compare with a published 420 bp table on 433 columns, so agreement is close and not exact (tolerance 0.15 percentage points).
- Nothing here is forensically validated. Releases so far are source-available for noncommercial use only, and haven't had a legal review. The license and bundled tool licensing get one before any commercial or wider launch.
- The Mac app uses an installed IQ-TREE from Homebrew rather than bundling one, and isn't notarized yet, so macOS asks people to confirm the first launch. It can't update itself yet either: download the new DMG from GitHub releases.
- The Mac app's Tree tab reads Newick for display only; the OneTaxonomy export is the checked form.
- The Payload plugin stores results and controls release. It doesn't compute, and it has no admin review screen beyond Payload's own forms.
- OneTaxonomy export writes a phylogeny record, which OneTaxonomy can't yet open as a file in a Mac app because its Studio isn't built.
- Reference panels depend on human curation. The app makes review by study easy, but it doesn't read papers.
- Rule values come from the research notes and are uncalibrated. With them, groups under 5 records per column can't be compared at all, and a window with few sampling sites can't rule anything out.
- Validation gates are our own proposals. Controls take minutes per testable claim, and the cross-study check can pass in one direction only.
- Groups were drawn by people who had seen these sequences, so shuffled-label controls show labels carry structure, not that the groups are independently confirmed.
- The group audit uses only records that cover a window whole (ADR 0007). In the redfoot panel 0.7.1's 5p window, no record does (the best covers 433 of 435 columns), so that window, and Brazil east within it, is unaudited until longer sequences arrive.
- Paper lookup proposes links from Crossref and Europe PMC by title. It doesn't read papers or supplements; it links to Europe PMC's supplement list for open-access papers only. Matches are by title words, so a person must approve each link. Requests go one at a time, a second apart, with a User-Agent naming the tool and no contact email, and a refusal isn't retried.
- Sample QC thresholds (1% and 5% missing data; 1 and 3 mixed sites; clusters of 3 differences within 30 columns) are proposals taken from common practice, not calibrated on this project's data. A panel can seal its own.
