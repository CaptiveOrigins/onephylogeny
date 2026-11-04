# Limitations

Kept current. Nothing listed here is claimed as done.

- Sources: NCBI nucleotide only. SNP data can't be fetched by species yet.
- Evaluation thresholds are configured values, not calibrated probabilities. Validation reports hold-out and missing-group results, not calibration, and small single-site groups can't be held out.
- `alignToReference` drops insertions from reference coordinates, though it reports them, and its local alignment can clip a few terminal bases.
- Gaps are treated as missing data. Real deletions are not modelled separately.
- Known-answer distances use a fixture anchored outside this repo with MAFFT, and compare with a published 420 bp table on 433 columns, so agreement is close and not exact (tolerance 0.15 percentage points).
- Nothing here is forensically validated. The project license and bundled tool licensing need legal review before a desktop release.
