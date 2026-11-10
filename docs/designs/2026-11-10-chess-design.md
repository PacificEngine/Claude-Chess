# Chess & Fairy Chess — Design

Date: 2026-11-10
Status: Draft, awaiting approval

## Intent

A browser chess game, hosted on GitHub Pages, played mostly by the owner. It will grow over time ("I'll be adding a bunch of features"), so the structure must make adding things easy. Headline features: a strong AI (around 2000) with easier levels, a tutorial for new players, a curated set of fairy-chess variants, and a board editor for custom setups of any piece on any supported board size.

The owner has never played fairy chess. The fairy content therefore has to *teach* as well as be playable: every fairy piece must be learnable inside the app.

## Goals

1. Standard chess against an AI with selectable levels, the top one playing at about 2000 Elo.
2. Hot-seat play: two humans on the same screen.
3. Fairy variants (curated list below), each playable against the AI and hot-seat.
4. Antichess (suicide chess).
5. A board editor: choose a board size, place any piece for either side, set the side to move, then play it against the AI or hot-seat. Setups can be saved.
6. A piece designer: invent new pieces by describing how they move, then use them in the editor.
7. Edit the current game at any time from Settings, then resume.
8. Undo.
9. Optional chess clocks.
10. A tutorial with two tracks: chess basics, and "meet the fairy pieces."
11. All state persists in the browser across visits.

## Non-goals (for now)

- Online or networked multiplayer, accounts, and any backend.
- Separate games such as Shogi and Xiangqi (possible later).
- Our own engine. Per the owner: "embed Fairy-Stockfish for now."
- Board sizes larger than Fairy-Stockfish supports.
- Mobile-first design. The game should still work on a phone, but desktop is the target.

## Anti-goals (failure even if it "works")

- The UI freezes while the AI thinks.
- The UI and the AI disagree about what a legal move is, or about how a game ends.
- A refresh or closed tab loses the game in progress.
- A fairy piece the player can't understand: no art, and no way to see how it moves.
- Code tangled together so tightly that adding a feature means touching everything.

## Decided by the owner

- **Platform:** a static site on GitHub Pages, played in the browser.
- **AI:** embed Fairy-Stockfish, compiled to WebAssembly.
- **Variants:** the owner accepted this proposed set: Standard, Capablanca, Grand, Seirawan (S-Chess), Amazon, Shako, Spartan, and Antichess (the owner added suicide chess).
- **Custom setups:** any piece, different board sizes. Playable against the AI and hot-seat.
- **"Any piece":** all of Fairy-Stockfish's built-in pieces, *plus* pieces you design yourself (chosen in the builder check).
- **Editing keeps the variant's rules** (chosen in the builder check).
- **Edit:** available at any time, from Settings.
- **Undo button:** yes.
- **Timer options:** yes.
- **Persistence:** saved in the browser.
- **Layout:** option A. The board is on the left, with a right-hand panel holding the Black clock, the move list, the White clock, the action buttons (Undo, Edit, Settings), and a line showing the variant and opponent. A top bar has Play, Tutorial, Editor and Settings.
- **The proposals accepted in playback:** the undo rules, the edit rules, about five AI levels plus Max, the timer presets, the tutorial structure, and the piece-art approach (all described below).

## How it works

### Tooling (my call, said aloud in the conversation and not objected to)

- TypeScript, built with Vite, managed with yarn (a team convention). Tests run on Vitest, test-first.
- The site is deployed to GitHub Pages by a GitHub Actions workflow.

### Architecture

Four layers. Dependencies point downward only.

1. **UI**: the board renderer, the right panel, dialogs, the editor, the piece designer, and the tutorial screens.
2. **Game session**: holds one game (its variant, starting position, move list, clocks, opponent, and per-ply snapshots). This layer owns undo, edit and resume, and the clock logic. It is pure TypeScript with no DOM, so it can be unit-tested.
3. **Rules adapter**: legal moves, applying moves, SAN and FEN, game-end detection, and insufficient material. It is backed by **ffish.js** (the Fairy-Stockfish move-generation library), so the rules come from the same code the engine uses. *This is the guard against the UI and the AI disagreeing.*
4. **Engine adapter**: runs Fairy-Stockfish in a **Web Worker** and talks to it over UCI. It handles setting the variant, loading custom variant definitions, setting the position, `go` with clock or movetime parameters, and `stop`.

A **persistence** module serializes the session, saved setups, tutorial progress and settings to `localStorage` under one versioned key per area. The version allows migrations as features are added.

### Fairy-Stockfish on GitHub Pages: a hard constraint

The multithreaded wasm build (`fairy-stockfish-nnue.wasm`) needs `SharedArrayBuffer`, which needs the COOP and COEP response headers. GitHub Pages can't set those. The plan is to use a service worker that adds the headers (the `coi-serviceworker` pattern). The builder must verify this early, as a spike before any UI work. If it fails, the fallback is a single-threaded build, which is weaker but still enough for 2000.

Other facts the builder needs to verify in that spike:
- that the build supports the large board size (12×10). *Fallback (my call):* if the large-board build is slower or weaker, ship two engine builds (8×8 and large-board) and pick one by board size. If no large-board build works at all, stop and ask the owner before cutting Capablanca, Grand, Shako, or large editor boards.
- that custom variant definitions can be loaded while the page runs (a variants.ini written into the worker's virtual filesystem, then `load`), for both ffish.js and the engine

### AI levels

There are about five named levels, Beginner through Expert, mapped to `UCI_LimitStrength` and `UCI_Elo` (or `Skill Level` where Elo isn't supported for a variant). Roughly 800, 1100, 1400, 1700 and 2000. **Max** turns off the strength limit.

Elo limiting is calibrated for standard chess. For fairy variants, the same settings give a "relative" strength, and that's acceptable.

When a clock is running, the AI gets its real clock (`wtime`, `btime`, `winc`, `binc`), so it plays faster when it's short on time. With no clock, each level has a fixed movetime.

### Undo

- **Hot-seat:** undo takes back one ply.
- **Against the AI:** undo takes back the AI's reply and your move, so it's your turn again. If the AI is still thinking, send `stop`, throw away its result, then undo your move.
- You can undo back to the start of the game, or back to the last edit.
- Clock times are restored from the snapshot saved at that ply.

### Edit at any time

- Settings → "Edit current game" pauses the clocks and opens the editor on the current position.
- In the editor you can add, remove and move pieces, change the side to move, and change the board size.
- **The game keeps its variant's rules** (owner's decision): win condition, forced captures, royal pieces, promotion rules, and drops. Any extra state the variant has can be edited too, such as Seirawan's pieces in hand and gating rights, or castling rights.
- If the edit leaves what the variant allows (a different board size, or a piece the variant doesn't have), the game becomes a **custom game based on that variant**. The generated definition starts from the original variant and overrides only the board size and piece set. The panel's variant line then shows "Custom (based on Grand)" or similar.
- If the edited position is illegal (a side has no king where the variant needs one, or the side not to move is in check), the editor warns you and blocks "Resume."
- Resuming starts a **new move history** from the edited position. Undo can't step back past the edit.
- The clocks resume from their paused values.

### Board editor and custom setups

- **Base rules:** a setup built from scratch starts by choosing a base rule set from the curated variants (for example Standard checkmate or Antichess). The generated variant inherits from that base.
- **Board size:** any width and height up to 12×10 (the Fairy-Stockfish limit). *Minimum size is my call: 5×5.*
- **Pieces:** every piece type Fairy-Stockfish supports (wazir, ferz, alfil, camel, zebra, nightrider, grasshopper, cannon and so on, as well as the standard and curated fairy pieces), plus your own designed pieces, for either color.
- **Letters:** each piece in a generated definition needs its own letter. The generator assigns letters to each setup and keeps the base variant's letters. If a setup needs more distinct pieces than there are free letters, or more designed pieces than Fairy-Stockfish allows (`customPiece1`..`customPiece25`, to be verified in the spike), the editor blocks it with a clear message.
- **Game settings:** starting from a setup, you also choose the side to move, castling on or off, and the promotion rank and promotable pieces. *Defaults are my call: castling off, and pawns promote on the last rank to any non-king piece in the setup.*
- **How it reaches the engine:** a setup becomes a generated custom-variant definition plus a FEN, loaded into both ffish.js and the engine.
- **Saving:** setups are saved by name in the browser and appear in the Play dialog's variant list.

### Piece designer

- **Purpose:** invent a piece by describing how it moves. It's saved in a personal piece library in the browser, and it shows up in the editor palette next to the built-in pieces.
- **How it reaches the engine:** a designed piece is stored as **Betza notation**, the piece-move language Fairy-Stockfish reads for `customPieceN`. Both ffish.js and the engine get it from the generated variant definition.
- **Building a piece:** the UI should not make the player type Betza. Instead, you build a piece from move components: step or slide, a direction set (orthogonal, diagonal, or a leap such as (1,2) or (1,3)), a range, and a modifier (move only, capture only, or capture by jumping a screen, cannon-style). You can also combine existing pieces ("rook + knight"). An "advanced" box shows the Betza text and lets you edit it.
- **Live preview:** while you design, the piece sits on an empty board with every square it can reach highlighted. The preview uses ffish.js, so it shows exactly what the engine will play.
- **Look:** you name the piece and pick its letter or token. Designed pieces always use a lettered token.
- **Royalty:** *my call:* designed pieces can't be royal, and only the king, or the variant's royal pieces, can be.
- **Limits:** the designer offers only the Betza features Fairy-Stockfish supports. The builder verifies which modifiers work in the spike and removes from the UI any that don't.
- **Changing a piece:** editing a library piece that saved setups or saved games use asks whether to update them or save the change as a new piece. *My call*, to avoid quietly changing a game in progress.

### Clocks

- **Presets:** None, 1+0, 3+2, 5+0, 10+5, 15+10, and Custom (base minutes plus increment seconds).
- **Flag rule:** running out of time loses, unless the opponent can't checkmate with the material they have, in which case it's a draw (using ffish's insufficient-material check).
- The clocks pause in the editor and while a dialog is open.

### Tutorial

**Track 1: Chess basics.** How each piece moves, capturing, check and checkmate, castling, en passant, promotion, and draws.

**Track 2: Meet the fairy pieces.** One lesson for each piece that appears in a curated variant. Each lesson shows the piece on an empty board with every reachable square highlighted, then gives a small challenge. A short page for each variant explains how it differs from standard chess.

- **Lesson format:** a short explanation, then a hands-on puzzle on a small board with legal-move highlighting.
- **Data, not code:** lessons are written as data (position, goal, hint), so adding a lesson doesn't mean writing code.
- **Progress:** saved in the browser.

Pieces that only appear in the editor get a "how it moves" preview (the same empty-board highlight) instead of a full lesson. *That split is my call.*

### Look

- **Piece set:** one consistent open-source piece set that includes fairy pieces. The builder must check its license allows use on a public GitHub Pages site and include attribution.
- **Fallback:** any piece without art gets a clear lettered token.
- **Settings:** board colors, the piece set where alternatives exist, sound, and legal-move highlighting on or off.

## Left to the builder

- Which piece set to use (license permitting), and the exact board colors and visual polish.
- Whether to use a UI framework. *My lean is a small one or none at all, but it's the builder's call, as long as the session, rules and engine layers stay free of the DOM.*
- The exact Elo numbers for each level, after playtesting.
- The lesson content and puzzle positions.
- The localStorage schema details.
