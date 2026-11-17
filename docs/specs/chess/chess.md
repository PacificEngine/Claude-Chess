# Chess

## Overview
A static, browser-only chess site hosted on GitHub Pages. It covers standard chess, a curated set of fairy variants, Antichess, and custom setups, all playable against a Fairy-Stockfish AI or hot-seat. Built from the approved design in `docs/designs/2026-11-10-chess-design.md`. The owner will keep adding features, so the layer boundaries below are a requirement, not a preference.

## Personas
- **Owner:** the main player, from chess-competent to wanting a ~2000 opponent. New to fairy chess, so needs to learn the pieces inside the app. Will extend the codebase.
- **Second player:** someone sitting next to the owner for a hot-seat game.
- **New player:** learns the basics through the tutorial.

## Core Requirements

### Must Have
- **Variants:** Standard, Capablanca, Grand, Seirawan, Amazon, Shako, Spartan, Antichess (the lichess rule set: a stalemated side wins), Shogi and Xiangqi (owner decision, 2026-11-17; design `docs/designs/2026-11-17-chess-shogi-xiangqi-design.md`). Any saved custom setup appears alongside them.
  - **Shogi:** 9×9, the standard game Fairy-Stockfish plays. Captured pieces wait in hand beside the board and are dropped by dragging them onto an empty square; only the squares the rules allow for that piece take it. Both hands are shown from the start, even while empty, so the board doesn't move when the first piece is captured. A move into, out of or inside the far three ranks asks in the choice window whether to promote, unless promotion is forced, when it just happens.
  - **Xiangqi:** 9×10, the standard game, on the checkered board with the river and the two palaces shaded.
  - Both are drawn in the site's style, not with traditional tiles or a lined board (owner decision, 2026-11-17), and the sides are White and Black: White moves first, as in every other game here, though the games' own names for the first mover are Black (Shogi) and Red (Xiangqi).
- **Opponents:** for every variant and custom setup, the opponent is either the AI at a chosen level or hot-seat.
- **AI levels:** five named levels, targeting about 800, 1100, 1400, 1700 and 2000, plus **Max**, which removes the strength limit.
- **Undo:**
  - Hot-seat: takes back one ply.
  - Against the AI: takes back the AI's reply and the player's move. If the AI is still searching, its search is stopped and its result thrown away.
  - Undo reaches back to the start of the game or to the most recent edit, whichever is later.
  - Clock times are restored from the snapshot saved at the target ply.
- **Edit current game:** available at any time from the panel's Edit button and from Settings, a finished game included (checkmate, stalemate, a draw or a flag), except while a saved custom game is still being restored (it is not on the board yet).
  - *Reason (owner decision, 2026-11-12):* a finished game is a position like any other; editing it is how a player tries a line again or plays on after a flag. Clocks pause, any AI search in flight is stopped (its late move is dropped), and the editor opens on the current position.
  - The variant's rules are kept, and its extra state stays editable (Seirawan's pieces in hand and gating rights, castling rights).
  - The editor starts from the game's own castling and gating rights, never rebuilt from where the pieces stand: a right already lost (a king or rook that moved and came back) starts unticked. Each right has its own box (see the editor spec), so the player can take one away or tick a lost one back while its king and rook are on their start squares. The en-passant square is kept while the position is unchanged.
    - *Reason (owner decision, 2026-11-12):* resetting rights silently changes the game; explicit boxes leave the choice to the player.
  - An edit outside what the variant allows (a different board size, or a piece the variant doesn't have) turns the game into "Custom (based on X)". Its rules are inherited from X, overriding only the board size and the piece set.
  - "Resume" is blocked while the position is illegal for the rules in force.
  - A timed game's clock times are editable: one m:ss (or h:mm:ss) box per side, filled with the paused times. Each must be 0:01 to 9:59:59; an empty or unreadable time, or a side at 0:00 ("White has no time left — set its clock above 0:00."), blocks Resume with the reason. A side that lost on time is never given time automatically: the player sets it.
    - *Reason (owner decision, 2026-11-12):* a side left at 0:00 would lose again the moment the game resumed, and only the player knows what time it should have.
  - Resuming starts a new game: a new move history and no result, with the same opponent and clock settings, and the clock times entered (exactly as paused when left unchanged). The clock runs again only if it was running when the editor opened, or when it is then the AI's turn (the AI moves, on its own time); a game paused until the next move, such as a restored one or a finished one, stays paused. Cancel returns to the game unchanged.
- **Clocks:**
  - Presets: None, 1+0, 3+2, 5+0, 10+5, 15+10, and Custom (base minutes plus increment seconds).
  - Running out of time loses, except that it's a draw when the opponent's material can't deliver mate.
  - Clocks pause while the editor or a dialog is open.
  - The AI receives the real clock times when a timer is running, and a fixed movetime per level otherwise.
- **Tutorial:** chess basics, a lesson for every fairy piece, and a page for each variant; see `./tutorial.md`.
- **Persistence:** the game in progress (including its clocks), saved setups, the designed-piece library, tutorial progress, and settings all survive a reload or a closed tab.
- **Layout A:**
  - The board on the left.
  - A right panel with the Black clock, the move list, the White clock, the Undo, Edit and Settings buttons, and a line showing the variant and opponent.
  - A top bar with Play, Tutorial (which opens the lesson list), Editor and Settings.
- **Piece art:** Merida for the standard pieces and the Capablanca, Grand, Seirawan and Shako pieces; Spartan's own set for its black pieces; Alfaerie for every other built-in piece type, matched to the piece by its name; the shogi pieces as their Alfaerie piece on a shogi tile, each tile pointing toward the opponent (up for the side at the bottom of the board, down for the side at the top, whichever side the player plays), with the piece on it upright; Black's Alfaerie pieces recolored from pychess-variants' blue to Merida's near-black body with light inner lines, so every Black piece matches (owner decisions, 2026-11-13). Only a letter with no known type (designed pieces, until Plan 3 decides) is drawn as a lettered token.
  - **Shogi and Xiangqi** (owner decision, 2026-11-17): Shogi's pawn, lance, knight, silver and gold on their tiles, the promoted bishop as the dragon horse tile, the promoted pawn, lance, knight and silver as the gold tile (they move like it) with a small red dot, so they never pass for a gold, the promoted rook as the bers art, and the king, rook and bishop in the chosen piece set. Xiangqi's chariot as the rook, the general as the king (both in the chosen piece set), the advisor as the fers, and the elephant, horse, cannon and soldier with their own art. A promoted piece never looks the same as its unpromoted form.
  - **Piece set** (owner decision, 2026-11-17): Settings offers Merida (the default) and fourteen Lichess sets for the six standard pieces only, in every variant, the pockets, the editor palette, the designer preview and the tutorial. Every other piece keeps the art above, and a designed piece keeps the art it chose, so each piece still looks like its name. A saved value the site doesn't ship, including `default` from before the setting worked, is Merida. Changing it redraws every board at once.
    - *Trap:* the set in use is module state in `src/ui/piece-sets.ts`, so boards and the palette subscribe to its changes instead of being told by app.ts. The six standard pieces of every set are also designed-piece art choices (`art-catalog.ts`), because designed pieces may use any two-colour art the site ships.
  - *Trap:* Alfaerie has no formal licence, only David Howe's "you may download and use" permission; see ATTRIBUTION.md. The owner chose to rely on it.
  - *Trap:* chessgroundx draws pieces as CSS background images, and an SVG used as an image can't load other files, so each shogi tile embeds its piece (`yarn art:pieces` rebuilds them).
- **Sound** (owner decisions, 2026-11-17): short tones made in the browser (Web Audio), so no sound files or licences. Off until the player ticks Sound in Settings; settings saved before sound worked are migrated to off once (settings version 2), since their `sound: true` was only the disabled box's default.
  - A move, a capture and a check each have a tone; check wins over capture. The move that ends a game plays the end tone instead: against the AI the win or lose tune from the human's side, in hot-seat the win tune for any decisive result, and the draw tone for a draw. A human's running clock dropping under 10 s beeps once per game; the AI's never does.
  - Undo, a new game, a restore, the editor and the designer are silent. In the tutorial, lesson moves and the written reply make the same move sounds, "Solved!" plays the win tune, and a wrong move plays nothing.
  - *Trap:* cues come from comparing each new game state with the last one heard (`hearChange` in app.ts), so every way a move happens (the player, the AI, a flag) sounds alike. Test builds record each cue in `window.__chessTest.sounds`, since a test can't listen.

### Must Not Do
- No backend, accounts, networking, or analytics.
- The UI never blocks on the engine. The engine always runs in a Web Worker.
- The UI never decides move legality or game end itself. Legality comes only from the rules adapter, which uses ffish.js (Fairy-Stockfish's own move generator), so the board and the AI can't disagree.
- Lose the game in progress on reload.

### Nice to Have
- An on-screen debug panel showing raw engine output.
- Usable on a phone (not a target, but it shouldn't break).

## Technical Constraints
- TypeScript, Vite, Vitest, and yarn. `[from: team conventions]` yarn only, TDD.
- Deployed to GitHub Pages by GitHub Actions. Pages can't set response headers, which drives the engine-loading design (see `./engine.md`).
- Layer dependencies point down only: **UI → game session → rules adapter / engine adapter**. Session, rules and engine code must not touch the DOM, so they can be unit-tested and so new features don't tangle with rendering.
- The board size limit is 12 files × 10 ranks (Fairy-Stockfish's large-board build) and the minimum is 5×5.

## Architecture
- **Game session:** owns one game, meaning its variant definition, starting FEN, plies, a per-ply snapshot (FEN plus both clock times), the opponent, and the clock state. Undo, edit, resume and the clock logic all live here.
  - *Reason for per-ply snapshots:* undo has to restore the clocks, and replaying increments backward is error-prone.
- **Rules adapter:** wraps ffish.js. It is the single source of legal moves, SAN, FEN, game result, and insufficient material.
- **Engine adapter:** UCI over `postMessage` to a worker. See `./engine.md`.
- **Variant definitions:** curated variants use Fairy-Stockfish's built-in names. Custom and edited games use a generated variants.ini section that inherits from a base variant. Generation is covered in `./editor.md`.

## Data Model
Each area is stored in its own `localStorage` key, and every key carries a schema `version`. On load:
- data with an older version is migrated
- data with an unknown future version, or data that's malformed, is set aside under a `.corrupt` key with a message to the player, and the app starts fresh

The areas are:
- **Current game:** variant reference or generated definition, start FEN, move list, snapshots, opponent, clock config, and remaining times.
- **Saved setups:** name, base variant, generated definition, FEN, and game settings.
- **Piece library:** for each designed piece, its id, name, token letter, and Betza string.
- **Tutorial progress:** finished lessons and opened variant pages, and the solved puzzles of each lesson.
- **Settings.**

Trap: saved setups and saved games refer to designed pieces by id. If a piece changes, the player is asked whether to update those references or save the change as a new piece, so a saved game never quietly changes its rules.

## Testing Strategy
- **Unit tests (Vitest), test-first:**
  - the game session: undo against the AI and hot-seat, the edit and resume boundary, clock flag rules, and snapshot restore
  - variant generation and letter assignment
  - Betza construction from designer components
  - persistence migrations
- **Integration tests** against real ffish.js (no mocks; it's first-party rules logic). Includes Antichess forced captures and win-by-stalemate, Seirawan gating, Spartan's two kings, and Grand promotion.
- **Engine tests:** run the worker in a headless browser (Playwright). They check that the engine answers `bestmove` for each variant and for a generated custom variant.
- **Strength:** playtested by the owner. An automated check against a known-rated engine is not required.

## Resilience
No external dependencies at runtime. The engine, piece art and fonts all ship with the site. There are two failure points:
- **The engine fails to load** (no WebAssembly or workers, or the header workaround fails). A visible message explains why, AI opponents are disabled, and hot-seat and the tutorial keep working. Reloading retries.
- **Storage is full or blocked.** A visible warning says progress won't be saved, and play continues in memory.

## Observability
Personal app, so there are no metrics or alerts. Errors and engine failures go to the browser console. An optional debug panel can show engine output.

## Security
There are no accounts, no server, and no personal data. The untrusted inputs are:
- text typed into setup and piece names
- Betza strings from the designer's advanced box
- everything loaded back from `localStorage`

User text is always rendered as text, never as HTML. Stored data is validated before use. Betza and generated variant text is checked before it's sent to the engine, so text that breaks the format (newlines, `[` or `=`) can't inject extra variants.ini settings.

## Performance & Scalability
- The page is interactive within about 3 seconds. The engine may finish loading after that, and it shows a loading state while it does.
- Legal-move highlighting appears within 50 ms of selecting a piece.
- The UI stays responsive while the AI searches.
- The AI moves within its level's movetime, or within its clock allowance when a timer runs.
- Scaling doesn't apply: everything runs on the player's own machine.

## Open Questions
- **Elo calibration for fairy variants.** `UCI_Elo` is calibrated for standard chess, so fairy levels are only "relative." Not blocking.

## Feature Breakdown
- Game session, undo, clocks, persistence: covered in this spec.
- Tutorial → `./tutorial.md`
- Engine integration → `./engine.md`
- Board editor, custom variants, piece designer → `./editor.md`
