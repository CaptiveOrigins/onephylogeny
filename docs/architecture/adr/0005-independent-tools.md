# 0005 — Tools run independently; bridges are optional

**Decision.** `core`, `acquire` and `engine` never depend on OneTaxonomy or OnePedigree. Integration lives in optional bridge packages that depend on both sides, and sister tools never depend on OnePhylogeny. They reciprocate through generic extension points and plain files.

**Consequences.** Each tool can be installed and released alone. Bridges have to track sister versions.
