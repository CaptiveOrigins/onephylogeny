# OnePhylogeny

A source-available, species-agnostic framework for acquiring sequence evidence, building reference panels and testing samples against them, with provenance and honest uncertainty. For developers, labs, researchers and keepers.

> **Status: early alpha.** The core science, NCBI acquisition, engine, CLI, React views, bridges, Payload plugin and Mac app work and are tested. The packages are on npm as early alphas, the Mac app isn't notarized, and results aren't forensically validated. See [the roadmap](docs/architecture/roadmap.md) and [limitations](docs/architecture/limitations.md).

OnePhylogeny is part of the [OneOrigin suite](docs/oneorigin/README.md): three independent tools, with no subscriptions, that work alone or together.

| Tool | Question it answers |
| --- | --- |
| [OneTaxonomy](https://github.com/CaptiveOrigins/onetaxonomy) | What do sources claim, and how do we browse those classifications and trees? |
| [OnePedigree](https://github.com/CaptiveOrigins/onepedigree) | How is this individual related to known relatives? |
| **OnePhylogeny** | Given DNA, what does the evidence support, and where does this sample fit? |

## Principles

- **Species agnostic.** No taxon, gene, region or threshold is hardcoded. A test fails if package source names a taxon.
- **Everything is programmatic and saved.** Profiles describe a run; runs are immutable records of what actually happened.
- **Evidence is traceable.** Every record keeps its accession version, hash, publication and provenance class.
- **Honest results.** Results are candidate sets, including `not_evaluable`; no shared sites never means excluded.
- **Your sources, your choice.** OnePhylogeny ships adapters, not authoritative data or panels.

The full rules are in [scientific invariants](docs/architecture/scientific-invariants.md).

## Packages

| Package | What it does |
| --- | --- |
| [`onephylogeny-core`](packages/core) | Records, GenBank and FASTA parsing, pure TypeScript reference anchoring, gates, haplotypes, panels, sample evaluation, hold-out validation. No dependencies |
| [`onephylogeny-acquire`](packages/acquire) | NCBI searches and downloads with safe retries; outgroup suggestions outward through the taxonomy; SRA, BioSample and NCBI Datasets listings, and GBIF, iDigBio and BOLD counts, never coordinates |
| [`onephylogeny-engine`](packages/engine) | Runs from profiles: fetch, anchor, gate, build panels, test samples, build trees, with immutable records and logs |
| [`onephylogeny-cli`](packages/cli) | The `onephylogeny` command |
| [`onephylogeny-react`](packages/react) | Sample results and reasons, coverage, validation, logs, trees and a compact lineage card |
| [`onephylogeny-onetaxonomy`](packages/onetaxonomy) | Optional: exports trees as OneTaxonomy phylogenies |
| [`onephylogeny-onepedigree`](packages/onepedigree) | Optional: checks results against OnePedigree maternal lines |
| [`payload-plugin-onephylogeny`](packages/payload) | Payload: immutable panels and reviewed, released results |
| [`apps/desktop`](apps/desktop) | OnePhylogeny for Mac (Tauri 2) |

All published under `@captiveorigins/`.

## How it runs

```bash
onephylogeny outgroups --workspace DIR --profile ID   # suggest outgroups outward from the ingroup
onephylogeny fetch     --workspace DIR --profile ID   # download, anchor, gate; write the sheet and log
onephylogeny panel     --workspace DIR --profile ID   # build and validate a panel
onephylogeny test      --workspace DIR --profile ID --fasta sample.fasta
onephylogeny tree      --workspace DIR --profile ID   # needs IQ-TREE
onephylogeny trace     --workspace DIR --profile ID --type T --key K   # everything that produced an artifact
```

A profile is plain JSON and holds every choice: taxa, marker, reference, filters, outgroups, groups and rules.

## Install the Mac app

Download the latest `.dmg` from this repository's [Releases](https://github.com/CaptiveOrigins/onephylogeny/releases) page (tags `desktop-v*`) and drag OnePhylogeny to Applications. The app isn't notarized, so macOS blocks the first launch. Use either way past the warning:

- **System Settings:** try to open the app once, then go to System Settings > Privacy & Security, scroll down, click **Open Anyway**, and click **Open** when the warning comes back. Apple says to do this only for an app you trust.
- **Terminal:** `xattr -dr com.apple.quarantine "/Applications/OnePhylogeny.app"`

It can't update itself yet: download the newest `.dmg` to update.

## Develop

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm test
pnpm --filter onephylogeny-desktop app:dev   # the Mac app
pnpm --filter @captiveorigins/onephylogeny-playground build   # every view on invented data: open apps/playground/dist/index.html
pnpm --filter onephylogeny-desktop dev       # browser preview with made-up data
```

## Documentation

- [Tutorial](docs/tutorial.md): build a panel, test samples and read a report on example data, offline, then the [concept pages](docs/concepts/README.md)
- [Architecture](docs/architecture/architecture.md), [data schema](docs/architecture/data-schema.md), [technical decisions](docs/architecture/adr/README.md), [owner decisions](docs/architecture/decisions.md)
- [The OneOrigin suite](docs/oneorigin/README.md) and its [guidelines](docs/oneorigin/guidelines.md) (draft)
- [Analysis protocol](docs/architecture/analysis-protocol.md): what results can claim, and the rules fixed before testing
- [Roadmap](docs/architecture/roadmap.md), [phase plan](docs/architecture/phase-plan.md), [limitations](docs/architecture/limitations.md)

Changes are listed in the [changelog](CHANGELOG.md).

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) for the software: free for noncommercial use, with attribution; commercial use needs a separate license from Captive Origins. Data you import keeps its own license. This software is research tooling and is not forensically validated.
