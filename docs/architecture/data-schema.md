# Data schema (version 1)

The TypeScript types in [`packages/core/src/model.ts`](../../packages/core/src/model.ts) are the definitive schema. Records are plain JSON. Types are added with the code that uses them.

| Record | Purpose | Key fields |
| --- | --- | --- |
| `SequenceRecord` | One source record, flattened | `version` (accession version), `taxon`, `isolate`, `voucher`, `geoLocName`, `latLon` (sensitive), `publications`, `sequenceSha256`, `provenanceClass` |
| `Selection` | A saved choice of evidence | `taxa` (source-qualified ids), `marker` (`gene`, `mitogenome`, `snp`), `outgroups`, `exclude` (each with a reason), `filters` |
| `Profile` | How to run a selection | `selection`, `reference`, `tree` (`model`, `bootstrap`, `shAlrt`, `seed`, `threads`) |
| `Snapshot` | An immutable download | `sources`, `records`, `rawFiles` (path and hash), `checksum` |
| `Run` | What actually happened | resolved `profile`, `snapshot`, `tools` (versions and hashes), `seed`, `status`, `events`, `outputs`, `diagnostics` |
| `Panel` | An immutable reference panel | `version`, `checksum`, `status`, `taxa`, `marker`, `reference`, `groups`, `notCovered`, `validatedScope`, `sources`, `builtBy` |
| `PanelGroup` | One group in a panel | `label`, `region` (a generalized name), `windows` with `diagnosticSites`, `evidence` with each record's `use` and `provenanceClass` |
| `Query` | A sequence to test | `sequence`, `source`, `sha256`, `taxonClaim` |
| `Result` | One query against one panel version | `panel` (id, version, checksum), `run`, `overlap`, `findings`, `caveats` |
| `Diagnostic` | A reported problem | `severity`, `code`, `message`, `path`, `ids` |

## Semantics

- **Panel status** runs `candidate`, `active`, `superseded` or `withdrawn`. Status isn't part of a panel's checksum, but everything else is.
- **Finding status** is one of `consistent`, `excluded_within_panel`, `not_evaluable`, `inconclusive` or `novel_or_unsampled_flag`. A group with no shared sites can only be `not_evaluable`, and every group in the panel must be reported.
- **Evidence use.** Only `wild-documented` and `museum-documented` records may be `lineage-and-location`.
- **Windows** are half-open: `start` is included and `end` is not.

The types and validators exist, but nothing builds panels or results yet.
