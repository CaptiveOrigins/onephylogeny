# OnePhylogeny architecture

OnePhylogeny acquires sequence evidence, curates it, builds reference panels and tests samples against them. It knows nothing about any particular species, or about Captive Origins, Payload or Tauri in its domain packages.

## Layers

```text
 apps       desktop (Mac)        playground
 adapters   react    payload    cli
 bridges    onetaxonomy    onepedigree        (optional)
 runtime    engine (profiles, runs, steps, tool adapters, logs)
 domain     acquire (sources, snapshots, provenance, outgroups)
            core (records, parsing, coordinates, comparison, haplotypes, panels, results)
```

Dependencies only point downward. `core` has no runtime dependencies and compiles without DOM or Node types. Packages that don't exist yet have no empty scaffolding.

## Main flows

**Build a selection.** Choose taxa by source-qualified id, a marker, filters and outgroups, and save them in a profile. Fetch every matching record from the configured sources, snapshot raw files with hashes, write the record sheet (CSV), then curate by study with a reason for each decision.

**Build a panel.** Validate gene identity and frame, anchor records to a reference, define groups and evaluable windows, compute diagnostics and validate. Publish an immutable, checksummed panel with a JSON manifest, sequences and a statement of what isn't covered.

**Test a sample.** Take a local FASTA or chromatogram, run it against a chosen panel, and return per-group statuses with evidence. Short queries return `not_evaluable` for groups they share no sites with.

Every run writes an immutable record: resolved profile, accessions and hashes, tool versions, seed, structured event log, outputs and diagnostics. Failures stop a run; nothing is skipped silently.

## Running native tools

Anchoring is pure TypeScript (`alignToReference`), so fetching, gates, panels and sample tests need no native programs and can run in the Mac app, the CLI or a hosted site. On 202 real records it differed from `mafft --addfragments --keeplength` in 23 of about 150,000 columns. Only tree building needs a native program (IQ-TREE), behind a `ToolRunner` port.

## The three tools together

- **Independent.** None of the three requires another. A bridge is an optional package, and only bridges depend on a sister tool.
- **OneTaxonomy.** Taxa can be selected from a OneTaxonomy snapshot. Finished trees export as OneTaxonomy `Phylogeny` records, which then gain its monophyly checks and tree views.
- **OnePedigree.** Haplotype results can be checked against maternal lines: animals in one recorded maternal line should share a haplotype, and a conflict is reported as something to review, never corrected.
- **Mac apps.** Each opens the others' plain files, and hands off to an installed sister app where available.

## Payload and hosted use

`payload-plugin-onephylogeny` follows the OnePedigree plugin: it maps onto a host's collections rather than owning them. The host states where its samples live. The plugin adds panels (shared records, stored whole), immutable assignments (one sample, one panel version) and permission-aware endpoints. React views show a sample against a panel and why each status was reached. Raw sequences and exact coordinates are never public.

## Source ownership

OnePhylogeny provides adapters and never selects or bundles authoritative data. Fixtures are small, illustrative and not for scientific use. Curated panels live with whoever owns them.
