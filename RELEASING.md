# Releasing

Same process as every Captive Origins package. Bump every `packages/*/package.json` to one version, commit as `Release x.y.z`, tag `vx.y.z`, push, then approve the staged packages on npm with 2FA.

Not set up yet: `release.yml`, first publish by hand, trusted publishing, and registration in `packages-sync.mjs` and `npm-trust.sh` in the Captive Origins repo.
