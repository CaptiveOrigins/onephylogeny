# Data schema

The TypeScript types in [`packages/core/src/model.ts`](../../packages/core/src/model.ts) are the definitive schema. Records are plain JSON. Types are added with the code that uses them. Panels and results are version 2. Everything else is version 1. Earlier panels load as outdated and need rebuilding under a new version.

| Record | Purpose | Key fields |
| --- | --- | --- |
| `SequenceRecord` | One source record, flattened | `version` (accession version), `taxon`, `isolate`, `voucher`, `geoLocName`, `latLon` (sensitive), `publications`, `sequenceSha256`, `provenanceClass` |
| `Selection` | A saved choice of evidence | `taxa` (source-qualified ids), `marker` (`gene`, `mitogenome`, `snp`), `outgroups`, `exclude` (each with a reason), `filters` |
| `Profile` | How to run a selection | `selection`, `reference`, `tree` (`model`, `bootstrap`, `shAlrt`, `seed`, `threads`) |
| `Snapshot` | An immutable download | `sources`, `records`, `rawFiles` (path and hash), `checksum` |
| `Run` | What actually happened | resolved `profile`, `snapshot`, `tools` (versions and hashes), `seed`, `status`, `events`, `outputs`, `diagnostics` |
| `Panel` | An immutable reference panel | `version`, `checksum`, `status`, `taxa`, `marker`, `reference`, `windows`, `groups`, `pairs`, `notCovered`, `validatedScope`, `claims`, `sources`, `builtBy`, `rules`, `gates`, `sequencesChecksum`, `builtWith` |
| `PanelWindow` | A named stretch of the reference, the same for every group | `id`, `label`, `start`, `end` |
| `PanelGroup` | One group in a panel | `label`, `region` (a generalized name), `coverage` per window, `evidence` with each record's `use`, `provenanceClass`, opaque `block` and `study` |
| `GroupCoverage` | What a group has in a window | `records`, `blocks`, `columnsAtDepth`, `spreadRate`, `recordsNeeded` |
| `PanelPair` | Two groups in a window | `state`, `records`, `blocks`, `sites` with depth, blocks and `unseenUpper95` per side |
| `Query` | A sequence to test | `sequence`, `source`, `sha256`, `taxonClaim` |
| `Result` | One query against one panel version | `panel` (id, version, checksum), `run`, `querySha256`, `producedBy`, `overlap`, `findings`, `pairs`, `candidatesNotEvaluated`, `novelty`, `outOfValidatedScope`, `caveats` |
| `Diagnostic` | A reported problem | `severity`, `code`, `message`, `path`, `ids` |

## Semantics

- **Panel status** runs `candidate`, `active`, `superseded` or `withdrawn`. Status isn't part of a panel's checksum, but everything else is.
- **Finding status** is one of `consistent`, `excluded_within_panel`, `not_evaluable` or `inconclusive`, with a `reasonCode` saying why. A group with no shared columns can only be `not_evaluable`, every group in the panel must be reported, and `excluded_within_panel` needs a resolved pair against that group.
- **Pair state** in a result is `resolved`, `not_resolved` or `not_evaluable`. `not_resolved` is a real answer: the columns this query covers don't separate the two groups.
- **Novelty** belongs to the query. It's flagged when no evaluated group fits, and it never overwrites what was found about a group.
- **Rules.** A column counts for a group only at `minDepthPerColumn` records. A conflict can rule a group out only where it has `minBlocksForExclusion` sampling sites. Records with no site all count as one.
- **Scope.** `validatedScope` and `claims` come only from a validation report. A claim is one pair of groups in one window, with a minimum length. `basis` stays `exploratory` until a test meeting the analysis protocol's section 2 runs.
- **Derived values.** A panel's coverage and pairs follow from its sequences and rules. Loading derives them again and refuses a mismatch.
- **Evidence use.** Only `wild-documented`, `museum-documented` and `origin-reported` records may be `lineage-and-location`, and `origin-reported` must name its `originSource`. Other records stay listed but don't shape coverage, pair sites, spread, findings or validation.
- **Windows** are half-open: `start` is included and `end` is not.
