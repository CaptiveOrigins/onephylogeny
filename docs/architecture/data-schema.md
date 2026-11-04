# Data schema (version 1)

The TypeScript types in [`packages/core/src/model.ts`](../../packages/core/src/model.ts) are the definitive schema. Records are plain JSON. Types are added with the code that uses them.

| Record | Purpose | Key fields |
| --- | --- | --- |
| `SequenceRecord` | One source record, flattened | `version` (accession version), `taxon`, `isolate`, `voucher`, `geoLocName`, `latLon` (sensitive), `publications`, `sequenceSha256`, `provenanceClass` |
| `Selection` | A saved choice of evidence | `taxa` (source-qualified ids), `marker` (`gene`, `mitogenome`, `snp`), `outgroups`, `exclude` (each with a reason), `filters` |
| `Profile` | How to run a selection | `selection`, `reference`, `tree` (`model`, `bootstrap`, `shAlrt`, `seed`, `threads`) |
| `Diagnostic` | A reported problem | `severity`, `code`, `message`, `path`, `ids` |

## Planned

**Run**: resolved profile, accessions and hashes, tool versions, event log, outputs, diagnostics.

**Panel**: `{ id, version, checksum, marker, reference, groups[], windows[], notCovered[], validatedScope, sources[] }`, with sequences in FASTA beside the JSON manifest.

**Result**: `{ query, panel: { id, version, checksum }, overlap, groups: { [id]: { status, evidence } } }`, where `status` is one of `consistent`, `excluded_within_panel`, `not_evaluable`, `inconclusive` or `novel_or_unsampled_flag`.
