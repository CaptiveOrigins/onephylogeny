# Tutorial fixtures

Used by [the tutorial](../../docs/tutorial.md) and its test (`packages/cli/test/tutorial.test.ts`). Not a reference panel, and not for scientific use.

- `profile.json`: a cytb profile on the reference `NC_080265.1`, with four groups labelled A to D for the exercise.
- `curation.json`: 13 records of `../golden/records.gb` given to those groups, with opaque site labels. The grouping follows the engine's golden test. It's an exercise, not a statement about where any animal lives.
- `samples.fasta`: three made-up samples cut from the public record `FM165591.1`: its first 900 bases, 140 bases from base 301, and 80 bases from base 601.
- `snps.vcf`: made-up genotypes for 8 animals at 13 sites, one failing the file's filter. `b-4` carries group A's genotypes on purpose; `c-1` has no group.
- `snp-groups.csv` and `snp-groups.json`: the same groups for those animals, as CSV and as JSON. `d-1` has a group but no genotypes.
- `regroup.csv`: a one-line curation sheet that moves `FN185748.1` from group A to group C, for the tutorial's second panel version. An exercise, not a correction.
- `offline-ncbi.mjs`: loaded with `NODE_OPTIONS="--import …"`, it answers the CLI's NCBI requests from `../golden/records.gb` and refuses any other network request.

No coordinates, and no animal data beyond the public GenBank records.
