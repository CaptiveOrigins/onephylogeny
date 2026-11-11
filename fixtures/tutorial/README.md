# Tutorial fixtures

Used by [the tutorial](../../docs/tutorial.md) and its test (`packages/cli/test/tutorial.test.ts`). Not a reference panel, and not for scientific use.

- `profile.json`: a cytb profile on the reference `NC_080265.1`, with four groups labelled A to D for the exercise.
- `curation.json`: 13 records of `../golden/records.gb` given to those groups, with opaque site labels. The grouping follows the engine's golden test. It's an exercise, not a statement about where any animal lives.
- `samples.fasta`: three made-up samples cut from the public record `FM165591.1`: its first 900 bases, 140 bases from base 301, and 80 bases from base 601.
- `offline-ncbi.mjs`: loaded with `NODE_OPTIONS="--import …"`, it answers the CLI's NCBI requests from `../golden/records.gb` and refuses any other network request.

No coordinates, and no animal data beyond the public GenBank records.
