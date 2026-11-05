# Changelog

## Unreleased

- **Breaking for panels:** panels now seal their record checks and a hash of their sequences. Earlier panels load as outdated and need a new version.
- Records assigned by their own sequence no longer shape a group's sites, spread, findings or validation. One such record could previously erase a fixed site and turn an exclusion into `consistent`.
- New provenance class `origin-reported`, which must name its source.
- Loading a panel verifies its seal, and a changed panel is refused.
- Unannotated records now get the coverage check unless they're many times the reference's length.
- New error `terminal-discordance` for foreign tails. Frame-shifting indels and in-frame stops now exclude records from panels, and still warn on samples.
- Analysis protocol: all results so far are exploratory, and rules are fixed before tests.
- React: `TreeCanvas`, with pan, zoom, Fit, Download SVG and Print, plus the suite's shared `icons`. `TreeFigure` stays server-renderable.
- Mac app: the tree uses the canvas. Download saves `tree.svg` to the profile's exports, and Print opens the system dialog.
- Playground: every view on invented data (`apps/playground`).
- Release workflow for npm, not used yet.

## Mac app 0.1.1

- Inline forms replace dialogs that don't work in the Mac web view. Leaving a record out requires a reason.
- Sealed panels, typed artifacts, resumable steps, Cancel and run records for every kind of work.
