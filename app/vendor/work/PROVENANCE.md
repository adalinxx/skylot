# Share hashing, vendored

- From https://github.com/adalinxx/selfhold-wallet at 74c5fe2 (2026-11-03):
  `src/web/work/sha256.ts`, `gpu.ts` and `worker.ts`, type-stripped to ES
  modules with esbuild (`worker.mjs` bundles `sha256.ts`). `LICENSE` is the
  repository's.
- `client/grinder.mjs` uses them to grind payout work for the player.
