Files here ship inside OnePhylogeny for Mac.

ecoregions.json: the region map's outlines (ADR 0008), about 8 MB. It isn't committed. The release workflow builds it
before the app. For a local build, run this from the repository root:

  node scripts/ecoregions.mjs apps/desktop/src-tauri/resources/ecoregions.json

Without it the app still builds and runs, and the Panel tab says the map can't be drawn.
RESOLVE Ecoregions 2017, CC BY 4.0. Dinerstein E. et al. (2017) BioScience 67(6): 534-545. doi:10.1093/biosci/bix014
