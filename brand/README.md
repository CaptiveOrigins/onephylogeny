# Brand

OnePedigree, OneTaxonomy and OnePhylogeny are separate tools from one maker: the [OneOrigin suite](https://github.com/CaptiveOrigins/onephylogeny/blob/main/docs/oneorigin/README.md). Like a tool family, they share a backbone and keep their own character. This file is identical in all three repositories; change it in all three.

## App icon

| | OnePedigree | OneTaxonomy | OnePhylogeny |
| --- | --- | --- | --- |
| Tile gradient (top → bottom) | `#f8dcc0` → `#eeb684` (pastel Captive Origins orange) | `#f8d6d7` → `#eda9ac` (pastel Captive Origins pink) | `#e6d6d2` → `#c9aca5` (pastel Captive Origins mauve) |
| Glyph | Two parents joined above one offspring | A rooted tree read left to right | A sample on a branching tree |

Both use Captive Origins brown `#4c312c` as ink (connectors, UI structure). Owner's choice 2026-11-02 (option A of the palette study; the swap, option C, stays possible: exchange the two hues).

Shared by every tool:

- Tile: 896 × 896 on a 1024 canvas, corner radius 200, vertical pastel gradient of a Captive Origins color.
- Blocks: cream `#fbf8f2`, rounded (radius ≈ 36–40), connectors 34 px in Captive Origins brown with square joins.
- The Captive Origins heart badge, exactly as in the Captive Origins logo (brown ring, pink disc, white heart; paths copied from the logo), as the maker's mark, placed on "the one" (the focal individual, the selected taxon).
- Small sizes (16–32 px: menu bar, file lists, favicons): `brand/icon-small.svg`, the same tile and glyph without the badge, a larger tile and heavier lines. From 64 px up, the full icon.
- Masters: `brand/icon.svg` (source) and `brand/icon-1024.png` (transparent, for app icon generators such as `tauri icon`). A future tool takes a pastel of another Captive Origins color (mauve `#91645d`, a lighter or deeper orange/pink) and its own glyph from the same blocks.

## Interface

Both React packages share these (colors from the Captive Origins palette: orange `#cf8137`, pink `#e48185`, brown `#4c312c`), under their own prefixes (`op-`, `ot-`), so neither depends on the other:

- **Icons**: the same 24 × 24 line icons in `icons.tsx`, drawn from Lucide (ISC; the set Captive Origins uses), 1.75 stroke, round caps and joins, `currentColor`. Shown next to text where a label helps; alone only in compact floating toolbars, always with `aria-label` and a visible tooltip on hover and keyboard focus (`data-tip`). Icons standing alone must say the action (a magnifier for zoom, not a bare +). Buttons are at least 32 px (WCAG asks 24); icon strokes keep 3:1 contrast; overlays use shape as well as color.
- **Controls**: 32 px buttons, radius 8, 1 px border; floating toolbar at the top right of the canvas; cards and panels radius 10 with a soft shadow; focus ring 2 px Captive Origins orange `#cf8137` (`#e7a066` in dark mode).
- **Canvas**: drag the background to pan, Ctrl/⌘ + wheel or pinch to zoom, `+` `-` `0` keys, Fit, Download SVG, Print (chart only).
- **Selection**: Captive Origins orange for the selected item and focus; brown for structure; pink for the brand mark and highlights.
- Each tool keeps its own functionality and layout; only the backbone is shared.
