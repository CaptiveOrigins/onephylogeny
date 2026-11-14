# @extantape/onephylogeny-core

Species-agnostic sequence records, GenBank and FASTA parsing, reference coordinates, coverage-aware comparison, haplotypes, frame checks, profiles and record sheets. No dependencies; runs in browsers, Node, workers and Tauri.

See the [repository](https://github.com/ExtantApe/OnePhylogeny) for documentation.

## JSON Schemas

The file formats ship as JSON Schemas (draft-07) in `schemas/`: `profile`, `curation`, `panel` and `result`. Import them as `@extantape/onephylogeny-core/schemas/panel.schema.json`. They're generated from this package's types and refuse unknown fields.
