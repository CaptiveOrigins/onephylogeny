# OnePhylogeny

An open-source, species-agnostic framework for acquiring sequence evidence, building reference panels and testing samples against them, with provenance and honest uncertainty. For developers, labs, researchers and keepers.

> **Status: early (Phase 1, milestone 1).** Only `@captiveorigins/onephylogeny-core` exists so far. Everything else below is planned; see [the phase plan](docs/architecture/phase-plan.md).

OnePhylogeny is one of three tools from one maker. Each runs on its own:

| Tool | Question it answers |
| --- | --- |
| [OneTaxonomy](https://github.com/mgilardi/onetaxonomy) | What do sources claim, and how do we browse those classifications and trees? |
| [OnePedigree](https://github.com/mgilardi/onepedigree) | How is this individual related to known relatives? |
| **OnePhylogeny** | Given DNA, what does the evidence support, and where does this sample fit? |

## Principles

- **Species agnostic.** No taxon, gene, region or threshold is hardcoded. A test fails if package source names a taxon.
- **Everything is programmatic and saved.** Profiles describe a run; runs are immutable records of what actually happened.
- **Evidence is traceable.** Every record keeps its accession version, hash, publication and provenance class.
- **Honest results.** Results are candidate sets, including `not_evaluable`; no shared sites never means excluded.
- **Your sources, your choice.** OnePhylogeny ships adapters, not authoritative data or panels.

The full rules are in [scientific invariants](docs/architecture/scientific-invariants.md).

## Packages

| Package | What it does | Status |
| --- | --- | --- |
| [`@captiveorigins/onephylogeny-core`](packages/core) | Records, GenBank and FASTA parsing, reference coordinates, coverage-aware comparison, haplotypes, frame checks, profiles, record sheets. No dependencies | Started |
| `@captiveorigins/onephylogeny-acquire` | Source adapters, snapshots, provenance enrichment, outgroup suggestions | Planned |
| `@captiveorigins/onephylogeny-engine` | Runs from profiles, step runner, tool adapters, logging | Planned |
| `@captiveorigins/onephylogeny-react` | Comparison, panel and map views | Planned |
| `@captiveorigins/onephylogeny-onetaxonomy`, `-onepedigree` | Optional bridges to the sister tools | Planned |
| `@captiveorigins/payload-plugin-onephylogeny` | Payload plugin | Planned |
| `apps/desktop` | Mac app (Tauri 2) | Planned |

## Develop

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm test
```

## Documentation

- [Architecture](docs/architecture/architecture.md), [data schema](docs/architecture/data-schema.md), [decisions](docs/architecture/adr/README.md)
- [Phase plan](docs/architecture/phase-plan.md), [limitations](docs/architecture/limitations.md)

## License

Apache-2.0 for the software, which requires keeping the copyright, license and [NOTICE](NOTICE) in redistributions. Data you import keeps its own license. This software is research tooling and is not forensically validated.
