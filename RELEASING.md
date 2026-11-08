# Releasing

Same process as every Captive Origins package. Bump every `packages/*/package.json` to one version, commit as `Release x.y.z`, tag `vx.y.z`, push, then approve the staged packages on npm with 2FA.

The first version, `0.1.0-alpha.0`, was published by hand on 2026-11-07. Each package trusts only `release.yml` in this repo, and only to stage, so a `v*` tag can't make anything public without that approval. Packages stage in dependency order: core, acquire, engine, cli, react, onetaxonomy, onepedigree, payload.

The Mac app is separate: tag `desktop-vx.y.z` after updating `apps/desktop/package.json`, `src-tauri/tauri.conf.json`, `Cargo.toml`, `Cargo.lock` and `CHANGELOG.md`.
