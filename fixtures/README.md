# Fixtures

Small and illustrative; not for scientific use and not a reference panel. Public GenBank records only, with no coordinates.

- `known-answer-distances.json`: anchored sequences for a published distance table (see its `description`).
- `two-records.gb`: two GenBank flat files that exercise partial locations, qualifiers and references.
- `golden/records.gb`: 15 real public GenBank records, replayed in place of NCBI for an end-to-end test. Includes a record of the wrong gene on purpose.
- `abi/`: two ABI chromatograms and their expected bases and qualities, from Biopython's test suite under its license (see `abi/NOTICE`). Not tortoise reads.
