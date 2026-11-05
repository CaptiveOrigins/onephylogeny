# Releasing

Same process as every Captive Origins package. Bump every `packages/*/package.json` to one version, commit as `Release x.y.z`, tag `vx.y.z`, push, then approve the staged packages on npm with 2FA.

`release.yml` is in place and registration in the Captive Origins repo is done. Not done yet: the first publish by hand and trusted publishing, so no tag should be pushed until then. Packages stage in dependency order: core, acquire, engine, cli, react, onetaxonomy, onepedigree, payload.
