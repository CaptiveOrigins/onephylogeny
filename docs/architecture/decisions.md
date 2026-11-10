# Owner decisions

Decisions the owner made about OnePhylogeny, newest first, each with its date. Technical choices with reasons are in the [ADRs](adr/). Some decisions reached this repo through another working session; those are marked "relayed".

| Date | Decision | Where it lives |
| --- | --- | --- |
| 2026-11-10 | Region map: "Shade public RESOLVE Ecoregions 2017 outlines (CC BY 4.0, about 850 worldwide), with each group tagged by ecoregion ID. Generalized and citable; about 10-20 MB, loaded only when a map shows." Relayed. | [ADR 0008](adr/0008-ecoregion-map.md) |
| 2026-11-10 | Defer the tree view that reuses OneTaxonomy's viewers. Relayed. | [Roadmap](roadmap.md) stage 5 |
| 2026-11-10 | The group audit stays strict: only records covering a window whole. "The rule was set before seeing the data. Report the 5p gap as a real limit; longer sequences will fill it later." Relayed. | [ADR 0007](adr/0007-strict-group-audit.md), [Limitations](limitations.md) |
| 2026-11-10 | Go on with paper lookup through Europe PMC and Crossref, within their terms and rate limits. Relayed. | `lookupPaper`, `paced` |
| 2026-11-07 | Card wording, in the owner's words: "Closer to the maternal line population sampled in <regions> than those in <others>. Other regions are unsampled or untested. Not proof of where this animal was collected." Relayed. | `REGION_CARD_LABELS` |
| 2026-11-07 | A region card says the animal's maternal line is closer to one sampled population than to the others it was compared with: "an indication their genetics more closely match this population compared to X, Y, Z", never proof of origin. Relayed. | `regionCard`, P30 |
| 2026-11-07 | Keepers may get results before the outside expert review, always labeled exploratory, and private unless they opt in per animal. Relayed. | Payload `resultsAgainst`, `shownAsExploratory` |
| 2026-11-07 | P30 approved as written, with P12 unchanged, plus the card's safeguards: public display opt-in per animal, the caveat in the JSON export, and no regions in CSV exports. Regions may also show for exploratory panels, clearly labeled. Relayed. | [Invariants](scientific-invariants.md) P30 |
| 2026-11-07 | Lineage to climate: pursue it as soon as it makes sense. It isn't blocked until a confirmatory test. Nothing built yet. Relayed. | Platform plan |
| 2026-11-07 | Done well, not just done: where there's a choice, pick the accessible, forward-thinking option with good UX over the bare minimum. Relayed. | Applies to the Mac app and the region card |
| 2026-11-07 | The legal review doesn't apply to 0.2.0, which ships source-available and noncommercial. It comes before any commercial or wider launch. Relayed. | [Limitations](limitations.md) |
| 2026-11-07 | No notarization for now. Every README and release note gives both ways past the macOS warning. | [Roadmap](roadmap.md) stage 7 |
| 2026-11-07 | No in-app updates until a signing key is added. People download the new DMG. Relayed. | [Limitations](limitations.md) |
| 2026-11-07 | Research panels may be public before final review, clearly labeled exploratory. Relayed. | Platform plan |
| 2026-11-07 | Finding likely localities is a goal of OnePhylogeny, within P12 and P30. Relayed. | P30 |
| 2026-11-06 | OnePhylogeny is public. Data and runs stay in a private repo. Relayed. | [ADR 0002](adr/0002-typescript-engine.md) |
