# OneOrigin suite guidelines

**Status: accepted by the owner on 2026-11-11 (N105: "A: send it, accept guidelines (Recommended)").** Drafted 2026-11-04. These apply to OnePedigree, OneTaxonomy and OnePhylogeny, the [OneOrigin suite](README.md). The brand text that used to be hand-copied into each repo's `brand/README.md` now lives in [brand.md](brand.md), and the machine-readable values in [tokens.json](tokens.json). Each tool carries a locked copy of this folder (section 10).

They exist so the three tools feel like one suite and keep working together as they change, while each stays its own and none depends on another.

**How to read this.** "Must" is a rule a pull request can fail on. "Should" is the default, and leaving it takes a stated reason. Section 9 shows where each tool stands today.

## 1. What is shared, and what isn't

- **Shared:** the backbone in this document, which covers look, app behavior, file conventions, engineering and release.
- **Not shared:** each tool's purpose, layout and science.
- **Independence:** each tool must install, run and release alone. No tool's core may depend on another tool. Shared look is copied under each tool's own prefix, so no tool needs another to render.

## 2. Principles all three keep

1. **Science and display are separate.** Data lives in immutable, checksummed records. Views only project it.
2. **Unknown stays unknown.** Missing values are reported and never guessed. Absence isn't evidence.
3. **Problems are explained, never silently repaired.** Every problem has a code, plain words and, where possible, a next action.
4. **Claims are scoped.** A result names the exact hypothesis, panel or data version it depends on.
5. **Sources belong to their owners.** Tools ship adapters, not authoritative data. Fixtures are small, illustrative and marked as such.
6. **Sensitive information stays out by default.** This includes exact localities, private animals and private people. Sharing it is an explicit choice.
7. **People's files are respected.** Source files are never changed, and everything a tool saves is readable without it.

## 3. Brand

### Palette and marks

The OneOrigin palette and the five marks (the suite, OneTaxonomy, OnePhylogeny, OneLineage and OnePedigree) are in [brand.md](brand.md#palette), with the files in `marks/` and the values in `palette` in `tokens.json`. Approved by the owner on 2026-11-12. Use a tool's text color for text in its color, never the base. Draw the one in teal with its cream center, every time.

The app icons and the interface colors below are the earlier ones. They stay until new ones are decided.

### App icon

| | OnePedigree | OneTaxonomy | OnePhylogeny |
| --- | --- | --- | --- |
| Tile gradient, top to bottom | `#f8dcc0` → `#eeb684` (orange) | `#f8d6d7` → `#eda9ac` (pink) | `#e6d6d2` → `#c9aca5` (mauve) |
| Glyph | Two parents joined above one offspring | A rooted tree read left to right | A sample on a branching tree |

Shared by every tool:

- **Tile:** 896 × 896 on a 1024 canvas, corner radius 200, a vertical pastel gradient of a Captive Origins color.
- **Blocks and connectors:** cream `#fbf8f2` blocks with radius about 36 to 40, and 34 px Captive Origins brown `#4c312c` connectors with round joins (owner decision N169, 2026-11-11). Draw a connector's corners as one path, so the join applies; separate strokes that meet at a corner leave a notch.
- **Badge:** the Captive Origins heart badge, exactly as in the logo, as the maker's mark, placed on "the one": the focal individual, selected taxon or tested sample.
- **Small sizes:** `brand/icon-small.svg` for 16 to 32 px, with the same tile and glyph, no badge, a larger tile and heavier lines. The full icon is used from 64 px up.
- **Masters:** every repo must have `brand/icon.svg`, `brand/icon-small.svg` and `brand/icon-1024.png` (transparent, for `tauri icon`).
- **A future tool** takes a pastel of another Captive Origins color and its own glyph from the same blocks.

### Color

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Accent | `#cf8137` | `#e7a066` | Selection, fills, primary action |
| Focus | `#a65f20` | `#e7a066` | Keyboard focus rings only |
| Brand pink | `#e48185` | `#eda9ac` | The brand mark and highlights only |
| Structure | `#4c312c` | `#eda9ac` | Lines and connectors |
| Mauve | `#91645d` | `#c79a92` | Secondary data marks |
| Text | `#1d2330` | `#e8ecf2` | Body text |
| Muted text | `#5b6577` | `#a3acbb` | Supporting text |

- Color must never be the only signal. Statuses have words and a symbol.
- Status colors are for status only, never decoration.
- Each tool exposes colors as CSS variables under its prefix: `--op-`, `--ot-`, `--ophy-`. `node scripts/oneorigin.mjs build` writes them from `tokens.json`.

### Type

The system font stack in every tool, with monospace only for sequences, logs and code.

### Icons

- 24 × 24 line icons in `icons.tsx`, drawn from Lucide (ISC, whose license ships with the package), with 1.75 stroke, round caps and joins, and `currentColor`.
- Icons appear beside text where a label helps. They stand alone only in compact floating toolbars, always with `aria-label` and a visible tooltip on hover and keyboard focus.
- A lone icon must say the action: a magnifier for zoom, not a bare plus.

### Controls and layout

- Buttons are 32 px, radius 8, with a 1 px border.
- Cards and panels have radius 10 and a soft shadow.
- The focus ring is 2 px: the darker orange `#a65f20` on light backgrounds and `#e7a066` in dark mode. The brand orange `#cf8137` stays for fills, accents and selection. Owner's decision 2026-11-11 (N154, "A: darker orange ring").
- Interactive canvases have a floating toolbar at the top right. Drag the background to pan, use Ctrl/⌘ + wheel or pinch to zoom, use `+` `-` `0` keys, and offer Fit, Download SVG and Print (chart only).

### Voice

- Plain words, full sentences, and no jargon where a plain word works. Explain terms for newcomers.
- Say what happened and what to do next. Don't blame the person.
- Say what a result can't tell you.
- Use "Maternal lineage" rather than "ancestry" when the marker is maternal. Never imply a location or relationship the evidence doesn't support.

## 4. App behavior

### Common shell

Every Mac app must have:

- **Settings** with Appearance (Auto, Light, Dark) and, once a tool has signed updates, "Check for updates automatically" plus a manual check.
- **Updates** from signed GitHub releases, asking before installing. People can turn automatic checks off. OneTaxonomy and OnePhylogeny don't have this yet (see the status table).
- **A status area** for messages, with details available on demand.
- **An empty state** that says what to do first, and what the tool is for.

### Mac specifics

- Must not use `window.prompt`, `window.confirm` or `window.alert`. Mac web views ignore or don't support them. Use native dialogs or inline forms.
- Calls to remote services go through the app's native HTTP layer, with an allow-list of hosts.
- Native programs may run only from an allow-list enforced on the native side, never from a path or command chosen in the interface.
- File access stays limited to the home folder and mounted volumes, in app capabilities.

### Long work

- Must show what's happening, and offer Cancel.
- Must keep the interface responsive: yield during long loops and move heavy pure calculations to a worker.
- Cancelling and crashing must not lose finished work.

### Errors

Show plain words, then "What to do". Keep technical detail available, not in the way.

### Files

- Everything is saved as plain, documented files a person can open. Prefer JSON and FASTA, CSV or similar, with no special file type unless a bundle is needed.
- Source files aren't changed. Extra information lives beside them, as OnePedigree's companion file does beside a GEDCOM.
- Writes must be atomic, so a crash leaves the old file or the new one.
- Opening a damaged or newer file must explain the problem. It must not crash or guess.

### Accessibility

- Everything works by keyboard, with visible focus.
- Charts have text alternatives, and tables are offered where a chart stands alone.
- Follows the system's light or dark setting by default. Both modes get real contrast, not an automatic flip.

### Exports

Figures and reports carry their disclosure and citation with them, including tool and data versions.

## 5. Data conventions

- **Records** are plain JSON, with `schemaVersion` on every top-level document. A schema change needs a migration or a clear refusal.
- **Identity** uses opaque IDs plus source-qualified external IDs. Names are never identity.
- **Immutability:** published records are sealed with a `sha256:` checksum of canonical JSON. Changed content needs a new version. Saved references aren't rewritten silently.
- **Provenance:** records keep source, retrieval date, version and license. Anything derived names what produced it, including software and data versions.
- **Validation** returns diagnostics with severity, code, message and path, and never mutates.
- **Coverage:** say what isn't included. A count or a tree isn't a claim about everything known.

## 6. Engineering

### Repository

```text
apps/        desktop, playground
packages/    core, feature packages, react, payload
brand/       icon.svg, icon-small.svg, icon-1024.png
docs/architecture/   architecture, data-schema, scientific-invariants,
                     phase-plan or roadmap, limitations, adr/
fixtures/    small, illustrative, with a README
```

- pnpm workspaces, Node 22 or later, ESM only, built with tsup and tested with Vitest.
- Strict TypeScript, with `noUncheckedIndexedAccess` on.
- **Package names:** `@captiveorigins/<tool>-<part>` and `@captiveorigins/payload-plugin-<tool>`.
- **Dependencies point downward:** `core` has no runtime dependencies and compiles without DOM or Node types. It must not depend on React, Payload, databases or Tauri. Exceptions need an ADR.
- No empty scaffolding. Planned work lives in the roadmap.

### Testing

- Each scientific rule is an invariant with a named test. A rule without a passing test is listed as pending.
- Use small real fixtures for known answers, and synthetic fixtures for edge cases.
- CI must build, typecheck and test every change.
- Desktop flows get real-browser or compiled-app checks where unit tests can't reach. Unsafe browser APIs and native permissions are examples.
- Packages with a Payload plugin test against a real Payload on in-memory MongoDB.

### Documentation

Each decision with alternatives gets an ADR. Limitations are kept current, and nothing is claimed done until its check passes.

### Licensing

- **The three One tools and their plugins:** PolyForm Noncommercial 1.0.0, with a `Required Notice` line in each `LICENSE`.
- **General Payload plugins:** MIT.
- **Third-party notices** ship with the code that uses it.
- **Bundled programs** keep their own licenses and run as separate programs.

## 7. Releases

### npm

- Lockstep versions across a tool's packages.
- Tag `vx.y.z` runs a workflow that tests and **stages** every package through trusted publishing, with no stored token. A maintainer approves with 2FA.
- A package's first version is published by hand, then `npm trust` is set up.
- `package.json` description and keywords are the source of truth, synced to GitHub with `npm run packages:sync` in Captive Origins. Release workflows refuse to stage when they differ.
- Each repo is registered in `packages-sync.mjs` and `npm-trust.sh`.

### Mac app

- Tag `desktop-vx.y.z` builds a universal app and publishes a GitHub release with a DMG, plus `latest.json` once the tool has a signing key.
- Each tool has **its own** updater key in `~/.tauri/<tool>.key`, stored as the repo secret `TAURI_SIGNING_PRIVATE_KEY`. Keys are never shared between tools or committed.
- App identifiers are `org.captiveorigins.<tool>`.
- Notarization is a shared goal, and when one tool adds it, the other apps follow.

## 8. Working together

- **Bridges:** integration lives in an optional package such as `onephylogeny-onetaxonomy`, which depends on both sides. Sister tools expose generic extension points and never depend on a bridge.
- **Plain files between apps:** one tool's export is another's import. A tool that can't open a file should say which tool can.
- **Payload plugins** map onto a host's collections rather than owning them, keep permission-aware endpoints, enforce rules on the server, and never hold exact sensitive locations. Compute that can't run on a host's servers runs elsewhere, and the plugin stores what was computed.
- **Captive Origins** consumes these packages from npm. Nothing here knows about Captive Origins, and nothing in a tool's core knows about a species or a site.

## 9. Parity today

From a review of the three repos on 2026-11-04, updated on 2026-11-07 after the Mac releases and OnePhylogeny's first npm publish. Bold marks what remains.

| Area | OnePedigree | OneTaxonomy | OnePhylogeny |
| --- | --- | --- | --- |
| Mac app | Yes | Yes | Yes |
| Published DMG | Yes, `desktop-v0.3.0` | Yes, `desktop-v0.1.0` | Yes, `desktop-v0.2.0` |
| Signed auto-updates | Yes | **Not yet.** Key made, secret not added; people download the new DMG | **Not yet.** Key made, secret not added; people download the new DMG |
| Settings: appearance, updates | Yes | Appearance only, until signed updates | Appearance only, until signed updates |
| Notarization | **No** | **No** | **No** |
| Playground | Yes | Yes | Yes |
| Shared `icons.tsx` | Yes | Yes | Yes |
| Floating canvas toolbar with pan and zoom | Yes | Yes | Yes |
| Accent in app shell | Orange | Orange | Orange |
| `brand/` complete | Yes | Yes | Yes |
| Architecture docs and ADRs | Architecture; **no ADRs** | Yes | Yes |
| Changelog | Yes | Yes | Yes |
| Scientific invariants with tests | Document; **not yet mapped to tests** | Yes | Yes |
| Atomic file writes | Yes, not yet exercised in the compiled app | Same | Yes |
| Errors with next actions | Yes | Yes | Yes |
| Cancel for long work | Not checked | n/a | Yes |
| npm release workflow | Yes | Yes | Yes, first version published by hand |
| Payload plugin | Yes | **Planned** | Yes |
| Installed in Captive Origins | Yes | **No** | **No** |
| License | PolyForm Noncommercial | PolyForm Noncommercial | PolyForm Noncommercial |
| `core` compiles without Node types | Yes | Yes | Yes |

"Not checked" means the code wasn't read closely enough to say. OnePedigree and OneTaxonomy's long tasks haven't been reviewed for Cancel.

## 10. Keeping this true

- **One source:** this folder in OnePhylogeny (`docs/oneorigin/`) is the source of truth. Each tool carries a copy in `brand/oneorigin/`, with `brand/oneorigin.lock` recording the source commit and a checksum of every file. CI fails when a copy is edited by hand, and warns when the source has moved ahead. Copies, not a dependency, so each tool still builds alone. Accepted by the owner on 2026-11-11 (N105).
- **Changing it:** a pull request here says which tools it affects, and those tools get a parity row until they catch up.
- **Pull request checklist:**
  - Does this change something the family shares? Then update this page.
  - Does it break a "must"? Then say why, or fix it.
  - Does it add a shared control, status or file convention that the other tools should adopt? Then add a row to section 9.
- **Review:** look at section 9 at each stage's end.

### Open questions for the owner

1. Where should this live long term? Answered 2026-11-11 (N105): here, in `docs/oneorigin/`, copied into each tool.
2. Should shared look move into a shared package? Answered 2026-11-11 (N105): no. Copies with a lock and a drift check, so no tool depends on another.
3. Should OnePedigree's green accent change to the family orange?
