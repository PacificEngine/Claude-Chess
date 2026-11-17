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
  - **Trap: `src/engine/engine-worker.ts` must stay a classic worker with no import or export declarations.** It needs `importScripts`, which module workers lack. `yarn dev` serves it unbundled, and a classic worker can't parse `import`. Vite's TypeScript transform also adds `export {}` to any file with an import declaration, even `import type`. So the page resolves the engine's file URLs and sends them in an `init` message, and the worker names the shared message types (`engine-protocol.ts`) with inline `import('…')` type expressions. The production build hid this because it bundles the worker. `yarn test:e2e:dev` guards it.
  - **Single-threaded fallback:** no single-threaded Fairy-Stockfish build is published, and this package has none. If isolation ever fails, the fallback is to compile `fairy-stockfish.wasm` without `USE_PTHREADS`/`PROXY_TO_PTHREAD` ourselves. It isn't needed now, because isolation via the service worker works.
  - **Large boards:** Capablanca, Grand and Shako, plus a 12×10 custom variant (`maxFile = l`, `maxRank = 10`), all return a `bestmove`.
  - **Built-in variants:** `chess`, `capablanca`, `grand`, `seirawan`, `amazon`, `shako`, `antichess` and `spartan` are built into both libraries. Fairy-Stockfish's `src/variants.ini` has no `[spartan]` section, because Spartan is built in. Caveat: `ffish.variants()` returns `""` until the library has initialised, which the first `new ffish.Board(...)` does.
  - **Loading variants.ini, engine:** write the text with `FS.writeFile(path, text)`, then `setoption name VariantPath value <path>`. The `load <path>` command also works. `check <path>` validates a file and prints its problems, one per line (for example `Invalid option: customPiece26`). Send `isready` after it and treat `readyok` as the end of the output.
  - **Each variants file is deleted once read** (2026-11-17). The engine reads a file only when `check` or `setoption name VariantPath` names it, and keeps what it loaded, so the adapter sends `removeFile` after the next `readyok`. A custom variant still plays after switching away and back by name alone. Before this, every designer preview and every custom game left a `/variants-N.ini` in the engine's in-memory file system until the page closed.
    - ffish.js has no way to unload a variant, so each previewed Betza still adds one small definition to the rules library for the rest of the session. The designer's verdict cache keeps that to one per distinct Betza.
  - **Loading variants.ini, ffish.js:** `ffish.loadVariantConfig(text)`. It reports no errors: a section with invalid options is still added, with those options dropped. So the editor must validate definitions itself, or with the engine's `check`.
  - **Trap: a variant name can't be redefined.** Loading a section whose name already exists is refused in both libraries (`Variant '<name>' already exists.`), and the old definition stays. Each generated definition needs a fresh name, for example one with a content hash.
  - **Trap:** `new ffish.Board('<unknown variant>')` crashes the wasm module ("memory access out of bounds"). Check `ffish.variants()` first.
  - **Noise:** a custom piece letter that isn't in the template's `pieceToCharTable` makes `check` print `pieceToCharTable - Missing piece type: <letter>`. The variant still loads and plays. The generator should set `pieceToCharTable`, or ignore this warning.
  - **Custom piece slots:** `customPiece1` through `customPiece25`, in both libraries. `customPiece26` and above are rejected with `Invalid option`.
  - **Betza modifiers:** `m`, `c`, `p`, `g` and `n` work as Betza defines them (`p`/`g` on `R`/`B` lines, and `n` on `N`/`A`/`Z`/`D`). `j` is **not** supported: it's silently ignored, so `jR` moves like `R`. Riders such as `NN` work.
  - **Riders and hoppers on other leaps (Task 1 of Plan 3, 2026-11-13):** riders on `D`, `A`, `H`, `C`, `Z` and `G` (`DD`, `AA` and so on) load but never move. A nightrider cannon (`mNNcpNN`) moves but never captures. So the piece designer offers slides only on `W`, `F` and `N`, and cannons only on `W` and `F`, and refuses the rest itself rather than offering a piece that can't move.
  - **`check` never rejects a Betza string (probed 2026-11-16, Plan 3 final review).** None of 45 strings of letters and digits was reported by `check` through the designer. They included unknown atoms (`X`, `Y`, `U`, `O`, `E`), bare modifiers (`mm`, `c`), digits alone, ranges of 0 or huge (`W0`, `W4294967296`), 40 repeated atoms, and unknown lowercase letters (`xW`, `qW`). Each string either loads and never moves, or loads with the unknown parts silently ignored (`xW` moves like `W`). So a Betza that passes the designer's own safety check can't be refused by the engine's reason. The backstop is the preview: a piece that reaches no square can't be saved ("This piece cannot move anywhere."). A typed Betza with ignored parts saves and moves as the preview shows, which is why the preview, not the string, is what the player approves.
  - **Strength:** `UCI_Elo` has min 500, max 2850 and default 1350, so the Beginner–Expert values (800–2000) are all in range. It changes play in Grand: with `UCI_LimitStrength true` and `UCI_Elo 500`, six 150 ms searches from the start position chose 4 different moves, while full strength chose `c3c4` all six times. Variants without an NNUE net print `info string classical evaluation enabled`.
  - **Tutorial content (Plan 4, 2026-11-16), from writing and checking the lessons against the rules library:**
    - A position drawn by insufficient material still has legal moves: ffish keeps returning them, and only `result()` reports the draw (`reason: 'insufficient'`, in chess for example two bare kings; in spartan two bare kings give no result).
    - Any piece can be a hopper's screen (cannon or janggi cannon), even the player's own king. The one exception: the janggi cannon (`pR`) can't jump over or take another janggi cannon, as in janggi, but it can jump over or take a xiangqi cannon.
    - The engine's `check` was never needed for the curated lesson boards: the rules library judges them alone.
    - **Spartan:** `typesOfVariant` maps the king `k` to the commoner, the general `g` to the bers and the warlord `w` to the archbishop. The hoplite `h`, lieutenant `l` and captain `c` are inherited. The rules accept those pieces on White's side, so their lessons play them as White. The hoplite moves one square diagonally forward without taking, takes one square straight forward, and from its start rank may move two squares diagonally forward, jumping over the square between. A Black hoplite promotes on rank 1 to a captain, lieutenant, warlord or general, and to a king only while Black has a single king; a White hoplite reaching rank 8 doesn't promote. With both Black kings on the board, attacking one is not check (`inCheck()` is false) and a king may step onto an attacked square; with one king left, mate is reported as `checkmate`.
  - **Shogi and Xiangqi (Plan 5, 2026-11-17), from adding both games and their lessons:**
    - **Drops:** a drop is a UCI move `B@a2`, with no from-square, in both libraries; `legalMoves()` lists the legal ones and the rules refuse the rest (a second unpromoted pawn on a file, a pawn on its last rank). Captured pieces go to the capturer's hand, written in the FEN as `[Bp]` after the board. A key judged by its squares can't tell two drops to one square apart, which no lesson puzzle needs.
    - **Promotion:** a Shogi promotion is a `+` suffix (`b2h8+`); not promoting is the plain move. A forced promotion is the only legal move, so it needs no question. SAN writes it as `Bxh8=H` or `Pc9=G`, ffish's notation, not Shogi's. A promoted piece is `+P` in the FEN. After that, SAN writes a promoted pawn's moves as a gold's (`Ge6`) and a promoted bishop's with `H`, so a tokin and a gold look the same in the move list.
    - **The type probe:** `typesOfVariant` measures each letter on two squares mirrored through the centre (d6 and f5 on 9x10, one on each side of the river). It maps Shogi's letters to built-in types, and Xiangqi's chariot, horse and cannon to the rook, horse and cannon; the general, advisor, elephant and soldier come out `inherited`. The probe squares lie outside the palace, where the general and advisor have no move, and the elephant and soldier move differently on the two sides of the river, so no built-in type matches them. Measuring them inside the palace was avoided on purpose: the advisor would pass for a fers, but no built-in type keeps a piece in its palace.
    - **Trap: ffish accepts placements the games forbid.** `validateFen` takes a Xiangqi general or advisor outside its palace, an elephant across the river or off its points, a soldier behind its start rank, and generals facing each other on an open file (it forbids moving into that, but doesn't count it as check); and a Shogi pawn or lance on its last rank, a knight on its last two, and two unpromoted pawns of a side on one file. `placementProblems` in `src/variants/legality.ts` refuses them, for the editor and the content check alike. The tutorial's puzzle search places Xiangqi pieces only where it allows.
    - **Xiangqi mates without a check of their own:** the general, advisor and elephant never reach the black general, so each lesson's mates are discovered checks (stepping off a chariot's file, or off a cannon's so that one screen is left), screens (stepping onto a cannon's file), or quiet moves that open the general's file, which then keeps the black general off it.
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
