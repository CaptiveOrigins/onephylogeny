# Privacy: no coordinates in anything shared

Exact collection coordinates can lead people to wild animals. OnePhylogeny keeps them out of everything it shares.

- **Panels never hold coordinates.** A group can name a generalized region. A panel with a field named like a coordinate (`lat`, `lon`, `latitude`, `coordinates` and so on) fails its checks (`coordinates-in-panel`).
- **The curation sheet never writes them,** and refuses to import a site or note that looks like coordinates (`coordinates-in-sheet`). Sampling sites are opaque labels such as `a-1`.
- **The record sheet leaves them out** unless the calling code asks for them by name.
- **Results and reports name regions, never positions,** and only under strict rules ([scientific invariants](../architecture/scientific-invariants.md), P10 and P30). A region name that looks like a position isn't shown.
- **The region map shades whole ecoregions, never sites** ([ADR 0008](../architecture/adr/0008-ecoregion-map.md)).

What stays on your machine: a GenBank record's own `lat_lon`, if its submitter gave one. It's kept in the raw download and in the run's working files in your workspace, because those are copies of the source. Nothing OnePhylogeny exports carries it.

A sample's result is yours. There's no account, and the command line only goes online for the commands that need to: `fetch` and `outgroups` (NCBI) and `lookup` (Crossref and Europe PMC). Everything else, including `test` and `report`, runs offline.

Don't put real coordinates, keepers' names or animals' private details in profiles, curation notes or fixtures. The fixtures in this repository are public records or made up.
