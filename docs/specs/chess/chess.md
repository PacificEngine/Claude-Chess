# Chess

## Overview
A static, browser-only chess site hosted on GitHub Pages. It covers standard chess, a curated set of fairy variants, Antichess, and custom setups, all playable against a Fairy-Stockfish AI or hot-seat. Built from the approved design in `docs/designs/2026-11-10-chess-design.md`. The owner will keep adding features, so the layer boundaries below are a requirement, not a preference.

## Personas
- **Owner:** the main player, from chess-competent to wanting a ~2000 opponent. New to fairy chess, so needs to learn the pieces inside the app. Will extend the codebase.
- **Second player:** someone sitting next to the owner for a hot-seat game.
- **New player:** learns the basics through the tutorial.

## Core Requirements

### Must Have
- **Variants:** Standard, Capablanca, Grand, Seirawan, Amazon, Shako, Spartan, and Antichess (the lichess rule set: a stalemated side wins). Any saved custom setup appears alongside them.
- **Opponents:** for every variant and custom setup, the opponent is either the AI at a chosen level or hot-seat.
- **AI levels:** five named levels, targeting about 800, 1100, 1400, 1700 and 2000, plus **Max**, which removes the strength limit.
- **Undo:**
  - Hot-seat: takes back one ply.
  - Against the AI: takes back the AI's reply and the player's move. If the AI is still searching, its search is stopped and its result thrown away.
  - Undo reaches back to the start of the game or to the most recent edit, whichever is later.
  - Clock times are restored from the snapshot saved at the target ply.
- **Edit current game:** available at any time from Settings. Clocks pause and the editor opens on the current position.
  - The variant's rules are kept, and its extra state stays editable (Seirawan's pieces in hand and gating rights, castling rights).
  - An edit outside what the variant allows (a different board size, or a piece the variant doesn't have) turns the game into "Custom (based on X)". Its rules are inherited from X, overriding only the board size and the piece set.
  - "Resume" is blocked while the position is illegal for the rules in force.
  - Resuming starts a new move history.
- **Clocks:**
  - Presets: None, 1+0, 3+2, 5+0, 10+5, 15+10, and Custom (base minutes plus increment seconds).
  - Running out of time loses, except that it's a draw when the opponent's material can't deliver mate.
  - Clocks pause while the editor or a dialog is open.
  - The AI receives the real clock times when a timer is running, and a fixed movetime per level otherwise.
- **Tutorial:** two tracks, chess basics and "meet the fairy pieces" (one lesson per piece in a curated variant), plus a page for each variant. Lessons are data (position, goal, hint), not code. Progress persists.
- **Persistence:** the game in progress (including its clocks), saved setups, the designed-piece library, tutorial progress, and settings all survive a reload or a closed tab.
- **Layout A:**
  - The board on the left.
  - A right panel with the Black clock, the move list, the White clock, the Undo, Edit and Settings buttons, and a line showing the variant and opponent.
  - A top bar with Play, Tutorial, Editor and Settings.
- **Piece art:** one consistent piece set. Any piece without art is drawn as a lettered token.

### Must Not Do
- No backend, accounts, networking, or analytics.
- The UI never blocks on the engine. The engine always runs in a Web Worker.
- The UI never decides move legality or game end itself. Legality comes only from the rules adapter, which uses ffish.js (Fairy-Stockfish's own move generator), so the board and the AI can't disagree.
- Lose the game in progress on reload.

### Nice to Have
- Alternative piece sets, board color themes, and sound.
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
- **Tutorial progress:** completed lesson ids.
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
- **Piece set.** Which open-source fairy piece set to use, depending on its license. Not blocking (lettered tokens are the fallback).

## Feature Breakdown
- Game session, undo, clocks, persistence: covered in this spec.
- Tutorial: covered in this spec.
- Engine integration → `./engine.md`
- Board editor, custom variants, piece designer → `./editor.md`
