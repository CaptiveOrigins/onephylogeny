# What a panel is, and isn't

A reference panel is a set of public sequences of one marker, such as cytb, sorted into groups by people, and placed on one reference so they can be compared base by base. You test a sample against it, and it says which groups the sample's sequence is consistent with, which it can rule out, and which it can't tell apart.

A panel is:

- **Sealed.** Its records, thresholds, record checks and sequences are hashed into a checksum when it's built. Changing anything means a new version. Loading a panel checks the seal and refuses a mismatch.
- **A folder of plain files.** `panel.json`, `panel.fasta`, the validation report, worked examples and a manifest of every file's hash. `onephylogeny verify --dir` checks a copy with no other context ([ADR 0006](../architecture/adr/0006-panel-dataset.md)).
- **Validated claim by claim.** Each pair of groups in each window is tested before the panel may speak to it. A panel with no passing claims is still saved, as a `candidate`, and every result from it says it's outside validated scope. The tutorial's panel is one.

A panel isn't:

- **Proof of where an animal was collected.** It compares a sequence with the records in each group. A match means the animal's maternal line resembles that group's. A lineage can reach beyond the places sampled so far, and animals are moved and bred. Every report says this.
- **Proof of legal origin, or of an individual's history.**
- **A complete map of a species.** Groups are only as good as the records behind them. Absence from a panel says little about absence from a place ([analysis protocol, section 6](../architecture/analysis-protocol.md#6-what-this-page-cant-fix)).
- **Shipped with OnePhylogeny.** The software ships the tools to build panels, not panels. You choose the sources ([ADR 0003](../architecture/adr/0003-new-repo-no-data.md)).

Where a result may name regions at all, the rules are in [scientific invariants](../architecture/scientific-invariants.md) (P30). The panel's file format is in the [data schema](../architecture/data-schema.md).
