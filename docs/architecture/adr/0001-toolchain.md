# 0001 — Same toolchain and release process as the sister tools

**Decision.** pnpm workspaces, strict TypeScript, tsup, Vitest and ESM-only packages named `@extantape/onephylogeny-*`. Lockstep versions, with tag releases staged on npm and approved with 2FA, as in OneTaxonomy ADR 0007. Tauri 2 for the Mac app.

**Consequences.** One mental model across the tools. Unlike the sister apps, the Mac app has to bundle and sign native programs, so it needs notarization.
