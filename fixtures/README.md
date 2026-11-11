# Fixtures

Small and illustrative; not for scientific use and not a reference panel. Public GenBank records only, with no coordinates.

- `known-answer-distances.json`: anchored sequences for a published distance table (see its `description`).
- `two-records.gb`: two GenBank flat files that exercise partial locations, qualifiers and references.
- `golden/records.gb`: 15 real public GenBank records, replayed in place of NCBI for an end-to-end test. Includes a record of the wrong gene on purpose.
- `abi/`: two ABI chromatograms and their expected bases and qualities, from Biopython's test suite under its license (see `abi/NOTICE`). Not tortoise reads.
- `golden/mitogenome.gb`: 11 made-up "mitogenomes" of 1,500 bases (five genes, one on the minus strand, and a control region) in two groups, turned to different starts, for the engine's mitogenome test. Made by `scripts/mitogenome-fixture.mjs` from a fixed seed; nothing in it is real.
- `NC_080265.1.gb`: the public RefSeq mitogenome used as the redfoot reference, for gene-window tests. It holds no coordinates.
- `sources/fake-services.mjs`: made-up answers shaped like NCBI SRA, NCBI Taxonomy, NCBI Datasets, GBIF, iDigBio and BOLD, for tests of the `sources` command and the Mac app's Public data section. Every name, accession and count is invented, and nothing in it is a coordinate. `sources/offline-sources.mjs` loads it in place of the network for the CLI.
