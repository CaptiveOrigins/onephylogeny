# Brand

OnePedigree, OneTaxonomy and OnePhylogeny share one brand: the [OneOrigin suite](oneorigin/README.md). Its text, rules and values live in one place, OnePhylogeny's [`docs/oneorigin/`](https://github.com/CaptiveOrigins/onephylogeny/tree/main/docs/oneorigin), and each tool carries a copy here:

- [oneorigin/brand.md](oneorigin/brand.md): the app icon, colors, controls and the focus ring.
- [oneorigin/guidelines.md](oneorigin/guidelines.md): the suite guidelines, accepted by the owner on 2026-11-11.
- [oneorigin/tokens.json](oneorigin/tokens.json): the same values for programs. `node scripts/oneorigin.mjs build` turns them into this tool's CSS variables (`--op-`, `--ot-` or `--ophy-`).
- [oneorigin/icons/](oneorigin/icons/): the shared icon parts.

Don't edit `oneorigin/` here. Change it in OnePhylogeny, then copy it again. `oneorigin.lock` records the source commit and a checksum of every file, and CI runs `node scripts/oneorigin.mjs check`, which fails on a hand edit and warns when the source has moved ahead.

This tool's own icon stays here: `icon.svg` (the master), `icon-small.svg` (16 to 32 px) and `icon-1024.png` (for `tauri icon`). This file is identical in all three tools.
