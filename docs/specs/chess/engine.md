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
- **Verify in the first spike (blocking for the build plan, not for the spec):**
  - which wasm package is used, and its threading requirements
  - that the large-board build is present and supports 12×10
  - how to load variants.ini while the page runs, in both the engine (virtual filesystem plus `load`) and ffish.js (`loadVariantConfig`)
  - the maximum number of `customPieceN` slots, and which Betza modifiers are supported
  - that `UCI_Elo` works for non-standard variants

## Resilience
If the worker or wasm fails to initialize, or fails to answer `uci` / `readyok` within 15 seconds, the engine is marked unavailable. Its error goes to the console, and the app turns off AI opponents (see `./chess.md`). There's no automatic retry: reloading the page retries.

## Observability
Engine output lines can be mirrored to the optional debug panel. Initialization failures go to the console with their cause.

## Security
Only text the generator has validated (see `./editor.md`) reaches `setoption` or variants.ini.

## Performance & Scalability
Engine loading must not delay the board from becoming interactive. The worker loads in the background, and the AI-opponent controls show a loading state until `readyok` arrives.

## Open Questions
- The facts listed under "Verify in the first spike" above. They block the plan's engine tasks, not this spec.
