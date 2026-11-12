# Chess

A browser chess site with fairy-chess variants, playable against Fairy-Stockfish or a friend. Everything runs client-side (TypeScript, Vite).

## Run

```sh
yarn
yarn dev
```

## Test

```sh
yarn ts          # type-check
yarn test        # unit tests (Vitest)
yarn playwright install chromium   # once
yarn test:e2e    # builds with --mode test and runs Playwright against vite preview
yarn test:e2e:dev  # checks the AI engine loads under `yarn dev` (unbundled workers)
```

CI runs `yarn ts`, `yarn test` and `yarn build` only. e2e is not run in CI because the Playwright browsers are heavy.

## Build

`yarn build` writes the site to `dist/`. The spike and engine-harness pages used by e2e are built only with `--mode test`, never in production.

## Deploy (GitHub Pages)

1. Create the GitHub repo and add it as a remote.
2. Settings > Pages > Source: **GitHub Actions**.
3. Optional: Settings > Secrets and variables > Actions > Variables: add `SOURCE_URL` to point the footer's "Source" link somewhere other than this GitHub repository. The workflow passes `SOURCE_URL`, or by default `<server>/<owner>/<repo>` of the repository being built, to the build as `VITE_SOURCE_URL`. The deploy build fails if that is not an http(s) URL, because the AGPLv3 Spartan art needs a working source link. Local builds without `VITE_SOURCE_URL` (and the e2e build, which clears it) link to the placeholder `https://github.com/OWNER/claude-chess`.
4. Push `main`. `.github/workflows/pages.yml` type-checks, tests, builds and deploys `dist/`.

GitHub Pages cannot send the COOP/COEP headers the engine needs (it uses SharedArrayBuffer), so a service worker adds them. The first visit therefore reloads once to become cross-origin isolated.

## Licensing

The site is GPL-3.0-or-later (see [LICENSE](LICENSE)) because it ships Fairy-Stockfish, ffish.js and chessgroundx. Piece art: Merida is GPLv2+, Spartan is AGPLv3, so the footer links to the source. See [ATTRIBUTION.md](ATTRIBUTION.md) for details.
