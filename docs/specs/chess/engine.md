# Engine Integration (Fairy-Stockfish)

## Overview
Runs Fairy-Stockfish, compiled to WebAssembly, in a Web Worker as the AI for every variant and custom setup. ffish.js, the same project's move-generation library, provides the rules on the main thread.

## Parent Domain
`./chess.md`

## Dependencies
- Fairy-Stockfish wasm build, bundled with the site.
- ffish.js, bundled with the site.
- A cross-origin-isolation service worker (the `coi-serviceworker` pattern).

## Core Requirements

### Must Have
- **The engine contract** is UCI over `postMessage`:
  - `setoption name UCI_Variant value <name>`
  - loading a generated variants.ini before a custom variant is selected
  - `position fen <fen> moves ...`
  - `go` with `wtime`, `btime`, `winc` and `binc` when clocks are running, or `movetime` otherwise
  - `stop`
- **Strength:** Beginner through Expert set `UCI_LimitStrength true` and `UCI_Elo` to 800, 1100, 1400, 1700 and 2000 (these are starting values, tuned by playtesting). **Max** sets `UCI_LimitStrength false`.
- **Stale results:** every search carries a request id. A `bestmove` arriving after undo, edit or new game is thrown away. *Reason:* `stop` still produces a `bestmove`, and applying it would corrupt the game.
- **Same definition everywhere:** a generated custom variant must be loaded into ffish.js and the engine from the same text. If either one rejects it, the game can't start, and the error is shown to the player.

### Must Not Do
- Run the engine on the main thread.
- Load the engine or ffish.js from a CDN at runtime.

## Technical Constraints
- **Trap: GitHub Pages can't send the COOP and COEP headers** that `SharedArrayBuffer` needs, and the threaded wasm build needs `SharedArrayBuffer`. A service worker re-serves the site's pages with those headers. On the very first visit the page reloads once, after the service worker installs. That reload is expected.
- **Fallback:** if cross-origin isolation can't be reached, use a single-threaded build. It's weaker, but should still reach Expert (~2000).
- **Large boards:** Capablanca, Grand, Shako and editor boards wider than 8 files or taller than 8 ranks need the large-board build (up to 12×10).
  - If that build is noticeably weaker or slower, ship both builds and choose by board size.
  - If no large-board build works, **stop and ask the owner** before cutting any variant.
- **Spike findings (Task 1, 2026-11-10, verified by `e2e/spike.spec.ts` on `vite preview`, which sends no COOP/COEP headers):**
  - **Package:** `fairy-stockfish-nnue.wasm@1.1.12` (GPL-3.0). It reports `Fairy-Stockfish [commit: b2e693ef, upstream: , emscripten: 2.0.26] LB`; `LB` means the large-board build, and it is the only build in the package. The rules library is `ffish-es6@0.7.10`, which reports `Fairy-Stockfish 230826 LB`.
  - **Threading:** the engine is an Emscripten pthreads build (`USE_PTHREADS`, `PROXY_TO_PTHREAD`), so it needs `SharedArrayBuffer` and therefore a cross-origin-isolated page. `coi-serviceworker@0.1.7` provides that on a header-less server: the first visit reloads once, then `crossOriginIsolated` is `true`. `Threads` defaults to 1 (max 512), and `Threads 2` searches correctly. `Hash` defaults to 16 MB.
  - **Hosting the engine:** our own dedicated worker calls `importScripts(stockfish.js)`, then `Stockfish({ locateFile, mainScriptUrlOrBlob })`. The instance has `postMessage(cmd)`, `addMessageListener(line => ...)` and `FS`. stdout and stderr both reach the listener. The package spawns its own nested pthread workers from `stockfish.worker.js`.
  - **Trap:** Vite must not inline `stockfish.worker.js` (3.3 kB, under the default `assetsInlineLimit`) as a `data:` URL. A `data:` worker has an opaque origin, isn't isolated, and logs "Current environment does not support SharedArrayBuffer". `vite.config.ts` excludes it from inlining.
  - **Single-threaded fallback:** no single-threaded Fairy-Stockfish build is published, and this package has none. If isolation ever fails, the fallback is to compile `fairy-stockfish.wasm` without `USE_PTHREADS`/`PROXY_TO_PTHREAD` ourselves. It isn't needed now, because isolation via the service worker works.
  - **Large boards:** Capablanca, Grand and Shako, plus a 12×10 custom variant (`maxFile = l`, `maxRank = 10`), all return a `bestmove`.
  - **Built-in variants:** `chess`, `capablanca`, `grand`, `seirawan`, `amazon`, `shako`, `antichess` and `spartan` are built into both libraries. Fairy-Stockfish's `src/variants.ini` has no `[spartan]` section, because Spartan is built in. Caveat: `ffish.variants()` returns `""` until the library has initialised, which the first `new ffish.Board(...)` does.
  - **Loading variants.ini, engine:** write the text with `FS.writeFile(path, text)`, then `setoption name VariantPath value <path>`. The `load <path>` command also works. `check <path>` validates a file and prints its problems, one per line (for example `Invalid option: customPiece26`). Send `isready` after it and treat `readyok` as the end of the output.
  - **Loading variants.ini, ffish.js:** `ffish.loadVariantConfig(text)`. It reports no errors: a section with invalid options is still added, with those options dropped. So the editor must validate definitions itself, or with the engine's `check`.
  - **Trap: a variant name can't be redefined.** Loading a section whose name already exists is refused in both libraries (`Variant '<name>' already exists.`), and the old definition stays. Each generated definition needs a fresh name, for example one with a content hash.
  - **Trap:** `new ffish.Board('<unknown variant>')` crashes the wasm module ("memory access out of bounds"). Check `ffish.variants()` first.
  - **Noise:** a custom piece letter that isn't in the template's `pieceToCharTable` makes `check` print `pieceToCharTable - Missing piece type: <letter>`. The variant still loads and plays. The generator should set `pieceToCharTable`, or ignore this warning.
  - **Custom piece slots:** `customPiece1` through `customPiece25`, in both libraries. `customPiece26` and above are rejected with `Invalid option`.
  - **Betza modifiers:** `m`, `c`, `p`, `g` and `n` work as Betza defines them (`p`/`g` on `R`/`B` lines, and `n` on `N`/`A`/`Z`/`D`). `j` is **not** supported: it's silently ignored, so `jR` moves like `R`. Riders such as `NN` work.
  - **Strength:** `UCI_Elo` has min 500, max 2850 and default 1350, so the Beginner–Expert values (800–2000) are all in range. It changes play in Grand: with `UCI_LimitStrength true` and `UCI_Elo 500`, six 150 ms searches from the start position chose 4 different moves, while full strength chose `c3c4` all six times. Variants without an NNUE net print `info string classical evaluation enabled`.
  - **ffish.js method names:** `board.result()` (for example `"0-1"`), `board.isGameOver()`, `board.isInsufficientMaterial()`, `board.hasInsufficientMaterial(white: boolean)`, `board.sanMove(uci)` (`"Nf3"`), `board.legalMovesSan()`, `board.variationSan(uciMoves)`, `board.legalMoves()`, `board.numberLegalMoves()`, `board.push(uci)`, `board.pushMoves(uciMoves)`, `board.pop()`, `board.fen()`, `board.turn()`, `board.isCheck()`, and `board.delete()` (it must be called, because boards are wasm objects).

## Resilience
If the worker or wasm fails to initialize, or fails to answer `uci` / `readyok` within 15 seconds, the engine is marked unavailable. Its error goes to the console, and the app turns off AI opponents (see `./chess.md`). There's no automatic retry: reloading the page retries.

## Observability
Engine output lines can be mirrored to the optional debug panel. Initialization failures go to the console with their cause.

## Security
Only text the generator has validated (see `./editor.md`) reaches `setoption` or variants.ini.

## Performance & Scalability
Engine loading must not delay the board from becoming interactive. The worker loads in the background, and the AI-opponent controls show a loading state until `readyok` arrives.

## Open Questions
- None. The spike answered them (see Spike findings above).
