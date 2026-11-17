# Chess Plan 4: Tutorial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tutorial that teaches chess from zero and every fairy piece the player can meet, with lessons in four steps (see it, try it, strategy, puzzles), variant pages, saved progress, and "Learn this piece" links from the editor and the game.

**Architecture:**
- **Lessons are JSON data** under `src/tutorial/content/`, loaded with `import.meta.glob`. A structural guard rejects malformed files.
- **A pure tutorial core** (`src/tutorial/`, no DOM) holds three things:
  - the schema
  - the goal judge, the try-it and puzzle runners, and the forced-win solver
  - `checkLesson`, which the content tests run over every lesson with the real rules
- **Highlights are computed, never stored.** "See it" and strategy highlights come from the rules at run time, using the designer's reach probe moved into `src/variants/reach.ts`. They can't disagree with the rules.
- **Puzzle replies are written in the data.** At run time:
  - the first move is right only if it equals the written first move; the tests prove that move is the only forced win
  - a last move is right if it meets the goal
- **The tutorial is its own screen,** like the editor. It has its own board, the game's clock pauses while it is open, and `chess.game` is never touched.

**Tech Stack:** As in Plans 1–3 (TypeScript, Vite, Vitest, Playwright, yarn 1.22, Node 22, `ffish-es6@0.7.10`, `fairy-stockfish-nnue.wasm@1.1.12`, `chessgroundx@10.7.5`).

**Spec:** `docs/specs/chess/tutorial.md`. The design and its reasons are in `docs/designs/2026-11-16-chess-tutorial-design.md`.

## Global Constraints

- **Process:**
  - yarn only.
  - Write each test before its code.
  - Commit after each red-green cycle, on branch `feat/tutorial`.
  - Commit messages explain *why*.
  - No Co-Authored-By or Claude signature lines.
- **Layer rule:**
  - `src/tutorial` (apart from `src/tutorial/ui/`), `src/session`, `src/rules`, `src/engine`, `src/persistence` and `src/variants` must not import DOM APIs or UI modules.
  - The UI never decides legality or whether a goal is met.
- **Data, not code:** adding or fixing a lesson is a JSON change under `src/tutorial/content/` only. No code change, no registry edit.
- **Text:** all lesson text is rendered with `textContent`, never as HTML.
- **Lesson shape:**
  - A piece lesson's steps are, in order: `see`, `try`, `read` (titled "Strategy"), `puzzles`.
  - A concept lesson's steps are `read` (titled "Learn"), then `puzzles`.
- **Puzzles:**
  - `moves` is 1 or 2, and `line` holds `2 * moves - 1` UCI moves (player, reply, player).
  - The first move is the only first move that forces the goal against every defence.
  - The reply is legal, and the first move does not already meet the goal.
  - In a piece lesson, the first move is made by the taught piece.
  - With at most two player moves, every reply to a forced first move loses equally fast. So "holds out longest" reduces to: the reply is legal.
- **Goals:** `mate`, `capture` (the piece that starts on `square`, followed if it moves), `reach` (the piece that starts on `from` stands on `to`), `castle`, `enPassant`, `promote`, `stalemate`.
- **Feedback texts:**
  - Wrong move: `'Not quite. Try again.'`
  - Solved: `'Solved!'`
  - A puzzle's own `hint` appears only when Hint is pressed.
- **Storage:**
  - `chess.tutorial` holds `{ version: 1, data: { finished: string[]; solved: Record<string, number[]> } }`.
  - A corrupt value is moved aside with the banner `'Your tutorial progress could not be read and was reset.'`
- **Engine needed:** a lesson board that is a custom setup goes through `registerSetup`. While the engine is unavailable, such a lesson shows `ENGINE_NEEDED_MESSAGE` instead of its board. Lessons on curated boards still work.
- **The game in progress:**
  - Opening the tutorial pauses a running clock, as the editor does.
  - "Play this variant" opens the existing Play dialog with that variant chosen; nothing starts until Start is pressed.
- **Content check speed:** `yarn test` runs the whole content check. It must take under 60 s on the dev machine, so puzzle boards keep few pieces.
- **Coverage:** every `BUILTIN_PIECES` type, and every piece letter of every curated variant's start position (board and hand), opens exactly one lesson card. Designed pieces have no lesson.

## Review Focus

1. **The engine is unavailable** (no WebAssembly threads). Fairy lessons on custom boards show `ENGINE_NEEDED_MESSAGE`, while basics lessons and variant pages still work. *Test in Task 3.*
2. **The tutorial opens while a timed game is running.** The clock pauses, and the game, its times and `chess.game` are unchanged when the tutorial closes, or after a reload while it is open. *Test in Task 4.*
3. **`chess.tutorial` is corrupt or from the future.** The banner shows, the value is moved aside, and the tutorial works with no progress. *Test in Task 4.*
4. **A puzzle whose answer is a promotion.** The player chooses the piece in the existing choice dialog. Cancelling the choice is not a wrong move. *Test in Task 3.*
5. **A wrong last move in a two-move puzzle.** The board returns to the position after the reply, not to the start, and the reply is not played again. *Test in Task 2 (runner) and Task 3 (screen).*

---

### Task 1: Reach probe, lesson schema, goal judge and solver

**Files:**
- Create:
  - `src/variants/reach.ts` and `src/variants/reach.test.ts`
  - `src/tutorial/lesson.ts` (schema and guard)
  - `src/tutorial/goals.ts` and `goals.test.ts`
  - `src/tutorial/solver.ts` and `solver.test.ts`
- Modify: `src/ui/designer/designer-preview.ts`, so it uses `reachFrom`. Its tests stay green unchanged.

**Interfaces:**
- Produces:
  - `reachFrom(rules: Rules, variant: string, fen: string, square: string): Reach`, with `Reach` moved here from `designer-preview.ts`. It is the same probe as the designer's: move squares, plus capture-only squares found by putting an enemy pawn on each empty square in turn, or an enemy knight on the first and last ranks. Board size comes from `parseFen(fen)`.
  - The schema in `lesson.ts`:

```ts
export type Track = 'basics' | 'fairy';
export type LessonBoard = { variant: VariantId; fen: string } | { setup: SetupSpec };
export type Goal =
  | { kind: 'mate' } | { kind: 'stalemate' } | { kind: 'castle' } | { kind: 'enPassant' } | { kind: 'promote' }
  | { kind: 'capture'; square: string } | { kind: 'reach'; from: string; to: string };
export interface Page { text: string; board?: LessonBoard; square?: string; arrows?: [string, string][] }
export interface Puzzle { prompt: string; board: LessonBoard; goal: Goal; moves: 1 | 2; line: string[]; hint: string }
export type Step =
  | { kind: 'see'; title: 'See it'; text: string; board: LessonBoard; square: string }
  | { kind: 'try'; title: 'Try it'; text: string; board: LessonBoard; square: string; targets: string[] }
  | { kind: 'read'; title: 'Strategy' | 'Learn'; pages: Page[] }
  | { kind: 'puzzles'; title: 'Puzzles'; puzzles: Puzzle[] };
/** One per name in the lesson list; a look-alike's card opens the shared lesson. */
export interface Card { track: Track; name: string }
/** What a lesson teaches, for the "Learn this piece" links: a built-in type, or a curated variant's own letter. */
export type Teaches = { type: string } | { variant: VariantId; letter: string };
export interface Lesson { id: string; track: Track; order: number; title: string; cards: Card[]; teaches: Teaches[]; steps: Step[] }
export interface VariantPage { id: string; variant: VariantId; order: number; differences: string[] }
export function isLesson(d: unknown): d is Lesson;
export function isVariantPage(d: unknown): d is VariantPage;
```

  - In `goals.ts`:
    - `goalMet(game: RulesGame, goal: Goal, tracked: string | null, uci: string): boolean`. It is called after the player's move `uci` has been pushed. `tracked` is the square the goal's piece stands on before that move.
    - Detection:
      - `mate`: `result()?.reason === 'checkmate'`
      - `stalemate`: `result()?.reason === 'stalemate'`
      - `castle`: the move's SAN starts with `O-O`
      - `enPassant`: a pawn's capture onto a square that was empty
      - `promote`: the SAN contains `=`
      - `capture`: the move's destination is `tracked`
      - `reach`: the move goes from `tracked` to `goal.to`
  - `trackAfter(goal: Goal, tracked: string | null, uci: string): string | null` follows the goal's piece through any move.
  - In `solver.ts`: `forcedWins(rules: Rules, variant: string, fen: string, goal: Goal, moves: 1 | 2): string[]` returns every first move that meets the goal at once (when `moves` is 1), or that meets it against every reply within `moves` player moves. It searches exhaustively.

- [ ] **Step 1: Write the failing tests.** They use `loadTestRules()` on curated chess positions.

```ts
// reach.test.ts
it('matches the designer probe for a rook on d4', ...);   // reachFrom(rules, 'chess', fen, 'd4') moves include 'd8','a4'
it('lists capture-only squares for a cannon', ...);       // a setup with { c: 'cannon' }: captures non-empty, beyond a screen

// goals.test.ts
it('sees mate, stalemate, castling, en passant and promotion', ...);
it('follows a captured target that moved first', ...);    // trackAfter moves 'e5' to 'e4' after 'e5e4'
it('counts a capture of the tracked piece only', ...);

// solver.test.ts
it('finds the one back-rank mate in 1', () => expect(forcedWins(rules, 'chess', '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', { kind: 'mate' }, 1)).toEqual(['a1a8']));
it('finds a mate in 2 against every defence', ...);       // a known mate in 2 with a unique key
it('rejects a key that a defence refutes', ...);           // a near-miss position returns []
it('returns several keys when several win', ...);          // two mates in 1 -> length 2
```

- [ ] **Step 2: Run** `yarn test src/variants/reach.test.ts src/tutorial`. Expected: FAIL (the modules don't exist).
- [ ] **Step 3: Implement `reachFrom`, and repoint `designer-preview.ts`'s `reachOf` to call `reachFrom(rules, variant, PREVIEW_FEN, PREVIEW_SQUARE)`, then the schema guards, `goalMet`, `trackAfter` and `forcedWins`.** Every `RulesGame` created must be disposed in a `finally`.
- [ ] **Step 4: Run** `yarn test` and `yarn ts`. Expected: all PASS, including the designer tests unchanged.
- [ ] **Step 5: Commit.**

---

### Task 2: Runners, content loader and the content check

**Files:**
- Create:
  - `src/tutorial/runner.ts` and `runner.test.ts`
  - `src/tutorial/content.ts`
  - `src/tutorial/check.ts`
  - `src/tutorial/content.test.ts`
- Create the first lesson, `src/tutorial/content/basics/rook.json`. It has all four steps and four puzzles: a capture in 1, a capture in 2, a mate in 1 and a mate in 2.

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `content.ts`:
    - `LESSONS: readonly Lesson[]` and `VARIANT_PAGES: readonly VariantPage[]`, loaded with `import.meta.glob('./content/**/*.json', { eager: true, import: 'default' })`. `variants/*.json` files are variant pages and every other file is a lesson.
    - A file that fails its guard throws at load, naming the file.
    - `lessonById(id: string): Lesson | undefined`
    - `cardsByTrack(track: Track | 'variants'): { name: string; lessonId: string }[]`, sorted by `order`, then by name.
  - `check.ts`: `checkLesson(rules: Rules, lesson: Lesson, register: (spec: SetupSpec) => string): string[]`. It returns problem texts and is empty when the lesson is sound. `register` gives the variant name for a setup board; in tests that is `generateVariant` plus `rules.loadConfig`. It checks:
    - every board's FEN is legal (`positionProblems` is empty)
    - every `see` and `try` square holds a White piece with at least one move (`canMove(reachFrom(...))`)
    - every `try` target can be reached by repeated moves of that piece, with the turn handed back to White after each move
    - every page's arrows are legal moves
    - every puzzle obeys the Global Constraints puzzle rules: `forcedWins(...)` equals `[line[0]]`; for `moves: 2`, `line[1]` is legal and `line[2]` meets the goal; in a piece lesson, `line[0]` starts on a square holding a taught piece
  - `runner.ts`:
    - `createTryRun(rules, variant, board fen, square, targets)` with `fen()`, `legalFrom(sq)`, `play(uci): 'moved' | 'target' | 'done' | 'illegal'` and `restart()`. Only the taught piece moves, and the turn is given back to White after every move.
    - `createPuzzleRun(rules, variant, puzzle)` with `fen()`, `turn()`, `legalFrom(sq)`, `lastMove()`, and `play(uci): { result: 'wrong' } | { result: 'reply'; reply: string } | { result: 'solved' }`, plus `restart()`.
    - A wrong move is popped, so the position is again the one before that move.
    - A first move is right only if it equals `line[0]`. A last move is right if `goalMet` is true.
- [ ] **Step 1: Write the failing tests.**

```ts
// runner.test.ts (on a hand-made mate-in-2 puzzle)
it('plays the written reply after the right first move', ...);      // play(line[0]) -> { result: 'reply', reply: line[1] }
it('accepts any mating last move', ...);                             // a second mate, not line[2] -> 'solved'
it('undoes a wrong last move back to after the reply', ...);        // fen() equals the fen after line[1]
it('a try run hands the turn back and reports each target', ...);
// content.test.ts: the content check, for every lesson and variant page
for (const lesson of LESSONS) it(`${lesson.id} is sound`, () => expect(checkLesson(rules, lesson, register)).toEqual([]));
it('reports a puzzle with a second solution', ...);                  // a cloned rook puzzle whose line[0] is replaced
it('reports an illegal board and an unreachable target', ...);
```

- [ ] **Step 2: Run** `yarn test src/tutorial`. Expected: FAIL.
- [ ] **Step 3: Implement** `runner.ts`, `content.ts` and `check.ts`, then write `rook.json`. Positions come from hand or from the search in Task 5's script, whichever is ready.
- [ ] **Step 4: Run** `yarn test` and `yarn ts`. Expected: PASS, with `rook is sound`.
- [ ] **Step 5: Commit.**

---

### Task 3: The lesson screen (Layout A)

**Files:**
- Create:
  - `src/tutorial/ui/lesson-view.ts`: the panel (title and track, step markers, instruction, feedback, and the Hint, Restart, Next and All lessons buttons)
  - `src/tutorial/ui/tutorial.ts`: the screen controller
  - `e2e/tutorial.spec.ts`
- Modify:
  - `src/ui/board-view.ts`: `BoardPosition` gains `marks?: { square: string; kind: 'move' | 'capture' | 'target' }[]` and `arrows?: [string, string][]`, drawn through chessgroundx `drawable.autoShapes` and square highlights
  - `src/ui/styles.css`
  - `src/ui/app.ts`: create the tutorial and include it in `covered()`

**Interfaces:**
- Consumes: Task 2, and from the existing app `createBoardView`, `createChoiceDialog`, `registerSetup` and `ENGINE_NEEDED_MESSAGE`.
- Produces:
  - `createTutorial(host: HTMLElement, deps: { rules: Rules; engine: Engine | null; choiceDialog: ChoiceDialog; progress: TutorialProgress; playVariant(id: VariantId): void; close(): void }): Tutorial`, with `Tutorial { open(lessonId?: string): void; hide(): void; isOpen(): boolean }`. `TutorialProgress` is defined in Task 4; until then the tutorial takes a stub in memory with the same interface.
  - `data-testid`s:
    - the screen: `tutorial`, `tutorial-board`
    - step markers: `step-<index>`, with `data-state` set to `done`, `current` or `todo`
    - the text: `lesson-instruction`, `lesson-feedback`
    - the buttons: `lesson-hint`, `lesson-restart`, `lesson-next`, `lesson-all`
- Behaviour:
  - **See it** marks `reachFrom` squares: `move` and `capture`.
  - **Try it** marks the next target as `target`.
  - **Read** pages are paged with Next, with highlights from `square` and `arrows`.
  - **Puzzles:**
    - The title shows "Puzzle *n* of *m*".
    - After a right first move, the reply is played after 400 ms.
    - Hint shows the hint in `lesson-feedback`.
    - Restart puts the puzzle back at its start.
    - A promotion with several candidates asks through `choiceDialog`; a cancel puts the piece back and is not counted as wrong.
  - Clicking a step marker opens that step.
  - A step that needs a custom board while `engine` is null shows `ENGINE_NEEDED_MESSAGE` in place of the board, and its steps stay navigable.
- [ ] **Step 1: Write the failing e2e tests** in `e2e/tutorial.spec.ts`. They open the rook lesson with `page.evaluate` through a test hook, `window.__openLesson('rook')`, added in `main.ts` only when `import.meta.env.DEV`. Task 4 replaces the hook with the lesson list.
  - `see it highlights every rook square`: 14 move marks on an empty board.
  - `try it moves the rook to each target, then marks the step done`.
  - `a wrong puzzle move says "Not quite. Try again." and puts the piece back`.
  - `hint shows only when pressed`: `lesson-feedback` is empty before Hint.
  - `a mate in 2: right key, the written reply plays, then mate says "Solved!"`.
  - `a wrong last move returns to the position after the reply` (Review Focus 5).
  - `a promotion puzzle asks for the piece, and cancel is not wrong` (Review Focus 4). This uses a promotion puzzle added to `content/basics/promotion.json`, which must pass the content check.
  - `without the engine, a custom-board lesson says the engine is needed` (Review Focus 1). It uses the existing e2e way of starting with no engine, as in `engine.spec.ts`, and a minimal `content/fairy/wazir.json` with a custom board, which must pass the content check.
- [ ] **Step 2: Run** `yarn test:e2e e2e/tutorial.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `board-view.ts` marks and arrows, then `lesson-view.ts`, `tutorial.ts` and the app wiring.
- [ ] **Step 4: Run** `yarn ts`, `yarn test` and `yarn test:e2e e2e/tutorial.spec.ts --repeat-each 3 --workers 2`. Expected: PASS, and the existing e2e specs still pass.
- [ ] **Step 5: Commit.**

---

### Task 4: Lesson list, variant pages, progress and the top bar

**Files:**
- Create:
  - `src/persistence/tutorial.ts` and `tutorial.test.ts`
  - `src/tutorial/ui/lesson-list.ts`
  - `src/tutorial/ui/variant-page.ts`
  - `src/tutorial/content/variants/<id>.json` for each of the 8 curated variants (chess's page says it is the standard game and points to Chess basics)
- Modify:
  - `src/ui/top-bar.ts`: Tutorial is enabled, with a `tutorial()` handler, and the header comment is updated
  - `src/ui/app.ts`: the store load and its banner, `openTutorial`, and `playVariant` as `openPlay({ kind: 'curated', id })`
  - `src/main.ts`: remove the dev hook
  - `e2e/tutorial.spec.ts`
- Docs: in `docs/specs/chess/chess.md`, the top bar no longer marks Tutorial as coming later.

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `TutorialProgress` with `isFinished(lessonId)`, `solved(lessonId): number[]`, `markSolved(lessonId, index, puzzleCount)` (which also finishes the lesson when every puzzle is solved), and `markFinished(id)`, for a variant page once it is opened. It is built by `loadTutorialProgress(store: Store): { progress: TutorialProgress; problem: 'corrupt' | null }`, which saves through `store.save('chess.tutorial', 1, …)`.
  - `MSG_CORRUPT_TUTORIAL = 'Your tutorial progress could not be read and was reset.'`
  - The lesson list has cards in three groups (Chess basics, Fairy pieces, Variants), from `cardsByTrack`. Each card's `data-testid` is `card-<lessonId>-<name>`, and it has `data-finished`.
  - A variant page shows:
    - the variant's `blurb` and its `differences`
    - the start position, from `rules.newGame(engineName)`, read-only
    - one link per piece letter in the start position, to that piece's lesson (Task 6 gives `lessonFor`; until then the list shows names only)
    - **Play this variant**
  - A half-done lesson opens at its first unsolved puzzle when the player reaches the Puzzles step.
- [ ] **Step 1: Write the failing tests.**
  - Unit: progress round-trips through the store; a corrupt value gives `problem: 'corrupt'` and an empty progress; `markSolved` on the last puzzle finishes the lesson.
  - e2e:
    - `the top bar's Tutorial opens the lesson list grouped by track`
    - `solving all of a lesson's puzzles ticks its card, and the tick survives a reload`
    - `a corrupt chess.tutorial shows the banner and an empty list` (Review Focus 3)
    - `opening the tutorial mid-game pauses the clock, and the game and chess.game are unchanged after closing and after a reload` (Review Focus 2), on a 5+0 game
    - `Play this variant opens the Play dialog with the variant chosen, and nothing changes until Start`
    - `a variant page is ticked once opened`
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** the progress store, the list, the variant pages and their 8 JSON files, the top bar and the app wiring.
- [ ] **Step 4: Run** `yarn ts`, `yarn test`, and `yarn test:e2e e2e/tutorial.spec.ts --repeat-each 3 --workers 2`. Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Task 5: The puzzle search script

**Files:**
- Create:
  - `scripts/find-puzzles.search.ts`, run by `yarn tutorial:search` as `vitest run --dir scripts find-puzzles`. It sits outside the default `yarn test` include.
  - `package.json` script `tutorial:search`.

**Interfaces:**
- Consumes: `forcedWins`, `checkLesson`'s `register`, and `BUILTIN_PIECES`.
- Produces: the dev-time tool the content tasks use. Environment inputs:
  - `PIECE`: a built-in type or `<variant>:<letter>`
  - `GOAL`: `mate1`, `mate2`, `capture1` or `capture2`
  - `COUNT`: default 5
  - `SEED`
- Behaviour:
  - It puts random small positions on an 8×8 chess-based setup, or the piece's own curated variant: the taught piece, both kings, and at most 4 more pieces.
  - It keeps positions that are legal, where `forcedWins` is exactly one move, and where that move is by the taught piece.
  - It prints each one as a ready-to-paste `Puzzle` JSON object with a placeholder prompt and hint.
  - It is deterministic for a given `SEED`, and stops after 60 s with whatever it found.
- [ ] **Step 1: Write a failing unit test** `src/tutorial/search.test.ts` for the pure part, `searchPuzzles(rules, opts): Puzzle[]` in `src/tutorial/search.ts`: `searchPuzzles({ piece: 'rook', goal: 'mate1', count: 2, seed: 1 })` returns 2 puzzles, each passing `checkLesson`'s puzzle rules.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `search.ts` (a seeded PRNG; no `Math.random`) and the script wrapper.
- [ ] **Step 4: Run** `yarn test` and `PIECE=wazir GOAL=mate2 yarn tutorial:search`. Expected: PASS, and the search prints at least one puzzle (or reports none within 60 s).
- [ ] **Step 5: Commit.**

---

### Task 6: "Learn this piece" links

**Files:**
- Create: `src/tutorial/links.ts` and `links.test.ts`
- Modify:
  - `src/ui/editor/editor-view.ts`: each built-in palette entry gets a `?` button, `data-testid="learn-<type-or-letter>"`
  - `src/ui/panel.ts`: a "Pieces" line lists the game's piece names, each a link
  - `src/ui/app.ts`: wiring
  - `src/tutorial/ui/variant-page.ts`: piece links
  - `e2e/tutorial.spec.ts`

**Interfaces:**
- Consumes: `LESSONS`, `variantTypes`, `INHERITED`, and `ActiveVariant`.
- Produces: `lessonFor(v: ActiveVariant, letter: string, types: Map<string, string>): string | null`. The lookup goes, in order:
  1. a designed letter gives `null`
  2. otherwise the letter's built-in type (`v.setup?.pieces`, or `types` for curated variants) is matched against `teaches: { type }`
  3. otherwise, for an inherited letter, against `teaches: { variant, letter }`
  4. otherwise `null`
- [ ] **Step 1: Write the failing tests.**
  - Unit:
    - Seirawan's hawk letter gives the archbishop lesson.
    - A designed letter gives `null`.
    - The commoner type gives `king`. This test is written now and passes once Task 7's content exists; until then it is `it.todo`.
  - e2e: the rook's `?` in the editor opens the rook lesson, and the panel's "Rook" link in a chess game does too.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** `lessonFor`, the palette buttons, the panel line and the variant-page links.
- [ ] **Step 4: Run** `yarn ts`, `yarn test`, and the e2e tests. Expected: PASS.
- [ ] **Step 5: Commit.**

---

### Tasks 7–10: Content

Each content task writes lessons as JSON only. Each lesson must pass `checkLesson`, and the task's lessons must keep `yarn test` under the 60 s budget. Puzzles build up in this order: capture in 1, capture in 2 (or reach), mate in 1, mate in 2. A piece lesson has 2–3 strategy pages and about four puzzles. Look-alikes share one lesson with a card for each name.

If the search finds no unique mate in 2 for a piece, stop and report. The owner decides whether that piece's lesson may end earlier.

| Task | Lessons |
|---|---|
| **7** Basics | how a game is won, the board, pawn, knight, bishop, queen, king (also carded as Commoner in Fairy pieces, with the not-royal sentence), check and checkmate, castling, en passant, promotion, draws. The rook from Task 2 is finished, and `promotion.json` from Task 3 is completed. |
| **8** Fairy leapers | fers, wazir (completing Task 3's file), alfil, fers-alfil, silver general, gold general, shogi pawn, shogi knight, lance, soldier, horse, elephant (xiangqi), janggi elephant, clobber piece, breakthrough piece |
| **9** Fairy compounds and hoppers | archbishop (also Hawk, Seirawan), chancellor (also Elephant, Seirawan), amazon, centaur, aiwok, bers, dragon horse, knibis, biskni, kniroo, rookni, cannon, janggi cannon, banner |
| **10** Spartan and coverage | every Spartan letter `typesOfVariant` reports as `inherited`, taught on `spartan` boards. Then the coverage test in `content.test.ts`: every `BUILTIN_PIECES` type, and every start-position letter of every curated variant, gives exactly one lesson through `lessonFor`. The `it.todo` from Task 6 becomes a real test. |

For each content task:

- [ ] **Step 1:** Add the task's lesson files with only their `id`, `cards` and `teaches` filled in, and an empty `steps`. Run `yarn test src/tutorial/content.test.ts`. Expected: FAIL (the step-shape check, and for Task 10 the coverage check).
- [ ] **Step 2:** Write each lesson's steps, using `yarn tutorial:search` for puzzle positions. Run `yarn test src/tutorial/content.test.ts` after each lesson. Expected: that lesson PASSES.
- [ ] **Step 3:** Run `yarn test` and check the time. Expected: PASS, under 60 s.
- [ ] **Step 4:** Commit, one commit per few lessons.

After Task 10, open `docs/specs/chess/tutorial.md` and record in its Must Have any lesson that ended without a mate in 2 under the owner's ruling. Record in `engine.md` Spike findings anything the content work learned about the rules.
