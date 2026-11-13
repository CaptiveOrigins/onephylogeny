# Brand

OneTaxonomy, OnePhylogeny, OneLineage and OnePedigree are separate tools from one maker: the [OneOrigin suite](README.md). Like a tool family, they share a backbone and keep their own character. The rules are in the [suite guidelines](guidelines.md); the values below are also in [tokens.json](tokens.json), the marks are in [marks/](marks/), and the shared icon parts are in [icons/](icons/).

This is the canonical brand text. It lives in OnePhylogeny's `docs/oneorigin/`, and each tool carries a locked copy in `brand/oneorigin/`. Change it in OnePhylogeny, never in a copy.

## Palette

The OneOrigin palette has its own colors, no longer taken from Captive Origins. Approved by the owner on 2026-11-12. The values are in `palette` in [tokens.json](tokens.json).

| | OneTaxonomy | OnePhylogeny | OneLineage | OnePedigree |
| --- | --- | --- | --- | --- |
| Base | `#fc9583` | `#44a446` | `#3fb1e4` | `#907be8` |
| Level 1 (one level away) | `#fdb5a8` | `#7cbf7e` | `#79c8ec` | `#b1a3ef` |
| Level 2 (two levels away) | `#feccc3` | `#a5d3a6` | `#a3daf2` | `#cac0f4` |
| Text, on white | `#a66256` (4.66:1) | `#388639` (4.53:1) | `#2c7ca0` (4.67:1) | `#7967c3` (4.62:1) |

Shared by every tool:

| | Light backgrounds | Dark backgrounds |
| --- | --- | --- |
| The one | `#1f6f6b` deep teal, 5.92:1 on white | `#3fb3a8`, 6.85:1 on `#1c1820` |
| Center of the one | `#fbf8f2` cream | `#fbf8f2` cream |
| Lines | `#363051` aubergine, 12.36:1 on white | `#ece6f2`, 14.30:1 on `#1c1820` |

- **The tool colors form a tetradic rectangle**: two complementary pairs, coral and green, blue and violet. Teal sits apart as the shared accent.
- **The one is teal with a cream center** in every mark: the selected rank, the sample, the person, the animal, and the suite's origin.
- **Levels are shades.** Level 1 is the base 30% of the way to white, level 2 is 52% of the way. Siblings share a shade, and each level away from the one is a step lighter. In OneTaxonomy the ranks below are darker, so a parent and its child never match.
- **Text uses the text color, never the base.** The bases are for fills: on white they reach only 2.15:1 (OneTaxonomy) to 3.40:1 (OnePedigree). Each text color is its base darkened in 2% steps until it reaches 4.5:1 on white.
- **Lines are aubergine**, a deep shade of the palette's violet, so the structure belongs to the palette. On dark backgrounds they turn pale.

### Checks

These are tests on the tokens and the marks, in `scripts/oneorigin.test.mjs`, so a change that breaks one fails the build:

- **Colorblind distinctness.** Any two of the four tool colors and the one (light) are at least 15 apart (CIELAB ΔE), seen with normal vision and under protanopia, deuteranopia and tritanopia. Today: 40.6, 27.2, 16.9 and 16.9. The closest pairs are blue and violet (deuteranopia) and green and blue (tritanopia). The colorblind views use the Machado, Oliveira and Fernandes (2009) matrices at full severity.
- **Contrast.** Every text color is 4.5:1 or better on white. The one is 4.5:1 or better on white and on its cream center, and its dark version on both dark backgrounds (`#1c1820`, and `#12151b` in the apps). Lines are 3:1 or better on their background.
- **The rule.** Level shades and text colors follow the rule above exactly.
- **The marks.** Each mark is plain SVG, labelled, uses only palette colors for its background, and draws the one in teal with a cream center.

A limit the checks don't cover: on dark backgrounds the one's lighter teal `#3fb3a8` and OneLineage's blue are only 7.0 apart under tritanopia. The cream center tells the one apart by shape, so never draw the one without it.

## Marks

Five marks, each as light, dark and small SVGs in [marks/](marks/): `oneorigin`, `onetaxonomy`, `onephylogeny`, `onelineage` and `onepedigree`, as `<mark>-light.svg`, `<mark>-dark.svg` and `<mark>-small.svg`. They are drawn on a 200 × 200 view box, without a background.

- **Light** is for light backgrounds, and **dark** for dark ones: pale lines and the lighter teal.
- **Small** is for 48 px and under. It has thicker lines and larger nodes, and OnePhylogeny drops its faint outer generation so it stays clean at icon size. It uses the light colors.
- **One node size, always solid.** No faded or see-through nodes. The only exception is OnePhylogeny's faint outer generation, which shows that the tree goes on.
- **Orientation follows each field.** The suite and OneTaxonomy read top-down from one origin. OnePhylogeny is a circular tree, OneLineage a spiral around a person, and OnePedigree reads like a pedigree certificate, with the animal on the left.
- **The zoom chain.** OneTaxonomy is the widest view, then OnePhylogeny, OneLineage and OnePedigree each zoom closer in.
- **The suite mark** grows from the one at the top to all four tool colors.

## App icon

The app icons, their tiles and the heart badge below are the earlier ones, drawn from Captive Origins colors. They stay as they are for now: new app icons, tiles and the maker's mark aren't decided yet.

| | OnePedigree | OneTaxonomy | OnePhylogeny |
| --- | --- | --- | --- |
| Tile gradient (top → bottom) | `#f8dcc0` → `#eeb684` (pastel Captive Origins orange) | `#f8d6d7` → `#eda9ac` (pastel Captive Origins pink) | `#e6d6d2` → `#c9aca5` (pastel Captive Origins mauve) |
| Glyph | Two parents joined above one offspring | A rooted tree read left to right | A sample on a branching tree |

Both use Captive Origins brown `#4c312c` as ink (connectors, UI structure). Owner's choice 2026-11-02 (option A of the palette study; the swap, option C, stays possible: exchange the two hues).

Shared by every tool:

- Tile: 896 × 896 on a 1024 canvas, corner radius 200, vertical pastel gradient of a Captive Origins color.
- Blocks: cream `#fbf8f2`, rounded (radius ≈ 36–40), connectors 34 px in Captive Origins brown with round joins (owner's choice 2026-11-11, N169: "A: round (Recommended)"; the three icons already drew them round, and the text said square).
- The Captive Origins heart badge, exactly as in the Captive Origins logo (brown ring, pink disc, white heart; paths copied from the logo), as the maker's mark, placed on "the one" (the focal individual, the selected taxon).
- Small sizes (16–32 px: menu bar, file lists, favicons): `brand/icon-small.svg`, the same tile and glyph without the badge, a larger tile and heavier lines. From 64 px up, the full icon.
- Masters: `brand/icon.svg` (source) and `brand/icon-1024.png` (transparent, for app icon generators such as `tauri icon`). A future tool takes a pastel of another Captive Origins color (mauve `#91645d`, a lighter or deeper orange/pink) and its own glyph from the same blocks.

### Icon parts

The shared parts, cut from the three icons without changing a value, are in [icons/](icons/): each tool's tile (`tile-onepedigree.svg`, `tile-onetaxonomy.svg`, `tile-onephylogeny.svg`), a cream block (`block.svg`), a connector (`connector.svg`) and the heart badge (`heart-badge.svg`, its paths exactly as in the logo). Each tool's glyph and the badge's place on it stay in that tool's own `brand/icon.svg`.

## Interface

The interface colors below are also the earlier ones, from Captive Origins colors, and the apps and React packages still use them. Whether they move to the palette above isn't decided yet.

Both React packages share these (colors from the Captive Origins palette: orange `#cf8137`, pink `#e48185`, brown `#4c312c`), under their own prefixes (`op-`, `ot-`), so neither depends on the other:

- **Icons**: the same 24 × 24 line icons in `icons.tsx`, drawn from Lucide (ISC; the set Captive Origins uses), 1.75 stroke, round caps and joins, `currentColor`. Shown next to text where a label helps; alone only in compact floating toolbars, always with `aria-label` and a visible tooltip on hover and keyboard focus (`data-tip`). Icons standing alone must say the action (a magnifier for zoom, not a bare +). Buttons are at least 32 px (WCAG asks 24); icon strokes keep 3:1 contrast; overlays use shape as well as color.
- **Controls**: 32 px buttons, radius 8, 1 px border; floating toolbar at the top right of the canvas; cards and panels radius 10 with a soft shadow; focus ring 2 px, darker orange `#a65f20` on light backgrounds and `#e7a066` in dark mode (see Focus ring below).
- **Canvas**: drag the background to pan, Ctrl/⌘ + wheel or pinch to zoom, `+` `-` `0` keys, Fit, Download SVG, Print (chart only).
- **Selection**: Captive Origins orange for the selected item; the darker orange for focus in light mode; brown for structure; pink for the brand mark and highlights.
- Each tool keeps its own functionality and layout; only the backbone is shared.

## Focus ring

Owner's decision 2026-11-11 (N154, option A, "darker orange ring"): "keep the brand orange everywhere else, but use the darker orange #a65f20 for focus rings on light backgrounds (4.6 to 1 or better). Dark mode keeps the lighter orange, which already passes."

- **Light backgrounds**: focus rings are `#a65f20`. That's 4.91:1 on white and 4.61:1 or better on the cream panels (`#fbf7f4`, `#f7f8fa`, `#fdf7f7`). The brand orange was 3.07:1 on white and 2.88:1 on the panels, under the 3:1 that WCAG 2.2 asks of focus indicators (1.4.11, 2.4.13).
- **Dark mode**: focus rings stay `#e7a066`, 7.1:1 or better on every dark background the tools use.
- **Everything else** keeps the brand orange `#cf8137`: fills, accents, selection, primary buttons. OneTaxonomy already uses `#a65f20` for text in the selection colour on light backgrounds.
- Each tool sets the ring through its own focus variable (`--ophy-focus`, `--op-focus`, `--ot-focus`, and `--focus` in the Mac apps), so a light theme and a dark theme each get the right one, and a test checks the light value and its contrast.
