# Riposte, vendored

- Repository: https://github.com/adalinxx/riposte
- Commit: b0a934e8d2accec26f4ce48e912cdcff0fcdd86f (2026-11-05, "widget: Delete takes one click; Selfhold's approval confirms it")
- Copied unchanged, at their paths in that repository: `riposte.js`, `src/index.mjs`,
  `src/records.mjs`, `src/state.mjs`, `src/wallet.mjs`, `src/account.mjs`,
  `widget/text.mjs`, `widget/inflight.mjs`, `widget/author.mjs`, and the files under
  `vendor/` that `riposte.js` imports: `lattice-sdk.js`, `selfhold.mjs` (+ `selfhold.LICENSE`,
  selfhold-wallet 4d4c0a8) and `moniker/` (moniker-sdk v0.5.0 at b06b714, + its `LICENSE`).
- The repository has no LICENSE file at that commit.
- Skylot loads `riposte.js` in `app/comments.html`, one thread per building:
  `data-page = skylot/<chain path>/lot/<x>,<y>`. Riposte's chain, nodes and fee
  sponsor are its own defaults.
