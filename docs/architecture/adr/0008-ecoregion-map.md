# 0008: The region map shades whole RESOLVE ecoregions

**Status.** Accepted by the owner, 2026-11-10 (relayed verbatim: "Ecoregions (Recommended)", which read: "Shade public RESOLVE Ecoregions 2017 outlines (CC BY 4.0, about 850 worldwide), with each group tagged by ecoregion ID. Generalized and citable; about 10-20 MB, loaded only when a map shows.").

**Context.** Panels hold region names and never geometry (P9, P30), so a region map needs shapes from somewhere, without bringing back the sites the panel was built to hide.

**Decision.**

- Each panel group may carry `ecoregions`: the RESOLVE Ecoregions 2017 IDs (`ECO_ID`) its region covers. The panel's curators choose them, and they're sealed into the panel with everything else.
- `RegionMap` in the React package shades those ecoregions in the group's colour, with neighbouring ecoregions in gray for context.
- `scripts/ecoregions.mjs` builds the outlines from the official release, simplified to about 8 MB. Hosts serve the file only where a map shows.
- The credit line (Dinerstein et al. 2017; RESOLVE Ecoregions 2017, CC BY 4.0) is always drawn with the map.

**Consequences.**

- A map is never finer than the ecoregions tagged, and those are whole ecoregions, often larger than any sampled area. Tagging is a curation decision that needs review, like a group's region name.
- The outlines aren't shipped in the npm packages, to keep them small.
- The Mac app carries them inside the app bundle (2026-11-10): its release workflow builds them with `scripts/ecoregions.mjs`, and the app reads them from its resources only when a panel with tags is shown. That leaves people nothing to fetch, build or point at, and nothing is downloaded on their machine. Each `.dmg` is about 8 MB bigger for it. A local build without the file still runs and says the map can't be drawn.
- The redfoot panel 0.7.1 has no tags yet. A proposal is in the data repo for review.
