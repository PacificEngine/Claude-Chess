# Chess Plan 5: Shogi and Xiangqi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shogi and Xiangqi as curated variants, playable against every AI level and hot-seat in the site's own style, with Shogi drops and promotion, Xiangqi's shaded river and palaces, position-only editing, and tutorial coverage.

**Architecture:** Both games are built into ffish.js and Fairy-Stockfish, so the rules and the AI need no new logic. The work is in the seams the builder check found:
- the catalog, and `typesOfVariant`'s probe on odd-width boards
- drop and `+` promotion moves in UCI parsing
- per-variant art, including promoted roles
- dragging a piece from a pocket
- a position-only editor base
- tutorial cards, pages and four Xiangqi lessons

Every game in these variants is the curated variant played from a FEN. No generated variants are involved.

**Tech Stack:** As in Plans 1–4 (TypeScript, Vite, Vitest, Playwright, yarn 1.22, Node 22, `ffish-es6@0.7.10`, `fairy-stockfish-nnue.wasm@1.1.12`, `chessgroundx@10.7.5`).

**Spec:**
- `docs/specs/chess/chess.md` (Variants, Piece art)
- `docs/specs/chess/editor.md` (Shogi and Xiangqi bases are position-only)
- `docs/specs/chess/tutorial.md` (Shogi and Xiangqi)

The design is in `docs/designs/2026-11-17-chess-shogi-xiangqi-design.md`, which includes the builder check's "Known technical gaps".

## Global Constraints

- **Process:**
  - yarn only.
  - Write each test before its code, and commit after each red-green cycle on branch `feat/shogi-xiangqi`.
  - Commit messages explain *why*.
  - No Co-Authored-By or Claude signature lines.
  - No mocks of first-party code.
- **Layer rule:**
  - `src/session`, `src/rules`, `src/engine`, `src/persistence`, `src/variants` and `src/tutorial` (apart from `src/tutorial/ui/`) must not import DOM APIs or UI modules.
  - The UI never decides legality: drops and promotion choices come from the rules adapter's legal moves.
- **Names:**
  - ffish variant names are `shogi` and `xiangqi`.
  - Catalog ids are `shogi` and `xiangqi`.
  - Labels are `Shogi` and `Xiangqi`.
  - Sides are White and Black: White, uppercase in the FEN, moves first.
- **Moves (ffish facts):**
  - A drop is UCI `B@a2`, and its SAN is the same.
  - A Shogi promotion is UCI `<from><to>+`.
  - A promoted piece is `+B` in the FEN.
  - A forced promotion is the only legal move offered.
- **Promotion choice:**
  - When both `<from><to>` and `<from><to>+` are legal, the choice window asks, with the labels `Promote` and `Don't promote`.
  - Cancelling puts the piece back.
- **Art:** no Shogi or Xiangqi piece, promoted forms included, is ever a lettered token. A promoted Shogi piece never draws the same image as its unpromoted form.
- **Editor:**
  - Shogi and Xiangqi bases are position-only: board size fixed, only the game's own pieces (Shogi's promoted forms included), pockets editable for Shogi, no promotion controls.
  - `needsCustomVariant` is always false for these bases, so a setup plays as the curated variant from its FEN.
- **Saved data:** every existing saved game, setup and lesson of the other eight variants loads and plays unchanged.
- **Content check speed:** `yarn test` stays under 60 s.

## Review Focus

1. **A Shogi drop after an undo, and the AI dropping.** Undo of a drop puts the piece back in hand. The AI's drop moves (`P@e5`) are drawn and listed. *Test in Task 3.*
2. **A forced promotion** (a pawn or lance reaching the last rank, a knight the last two). No choice window opens, and the piece arrives promoted. *Test in Task 3.*
3. **A saved Shogi game with pieces in hand and promoted pieces, reloaded.** The board, the hands and the art come back exactly. *Test in Task 3.*
4. **Editing a Shogi game mid-game.** The board keeps the hands and promoted pieces, the palette offers promoted forms, and Resume plays the curated `shogi` from the edited FEN. *Test in Task 4.*
5. **Xiangqi's flying general and a cannon that has nothing to hop over.** The board offers exactly the moves ffish allows. *Test in Task 1 (rules) and Task 2 (marks on the board).*

---

### Task 1: The variants, drop moves and the type probe

**Files:**
- Modify:
  - `src/variants/catalog.ts`: add `shogi` and `xiangqi` to `VariantId` and `CURATED_VARIANTS`, with labels and blurbs
  - `src/variants/fen.ts` (the square split near line 45)
  - `src/ui/board-view.ts` `parseUci`
  - `src/variants/piece-types.ts` `probeGeometry` and `typesOfVariant`
- Test:
  - `src/variants/catalog.test.ts`
  - `src/variants/piece-types.test.ts`
  - `src/rules/rules.test.ts`, as integration tests on real ffish
  - `src/tutorial/content.test.ts`: the coverage test gains an explicit, named `PENDING_COVERAGE` set listing the new letters that have no lesson yet. Task 6 empties it.

**Interfaces:**
- Produces:
  - `parseUci(uci)` returns `{ from: string | null; to: string; suffix: string; drop: string | null }`.
    - A drop `B@a2` gives `{ from: null, to: 'a2', drop: 'B', suffix: '' }`.
    - A promotion `b2h8+` gives suffix `+`.
    - Every existing caller is updated for `from` possibly being null.
  - The fen.ts square split handles drops and `+`.
  - `typesOfVariant(rules, 'shogi' | 'xiangqi')` no longer throws.
    - Each letter maps to the built-in type it moves as when measured, or to `inherited`.
    - The palace- and river-bound Xiangqi pieces, the general, advisor, elephant and soldier, are `inherited`. Measure them where they can stand, or rule them inherited explicitly, and record which.
- [ ] **Step 1: Write the failing tests.**
  - `the catalog lists Shogi and Xiangqi with ffish's sizes`: 9×9, and 9×10 with 9 files and 10 ranks.
  - `parseUci reads a drop and a + promotion`.
  - `typesOfVariant maps Shogi's gold, silver, lance and knight, and Xiangqi's chariot, horse and cannon, and leaves the general, advisor, elephant and soldier inherited`.
  - Integration:
    - A Shogi capture puts the piece in hand (`[B]` in the FEN).
    - A drop `B@e5` is legal.
    - A two-pawn drop is refused.
    - A pawn on the 8th rank (with ranks counted for White) offers both `x` and `x+`.
    - Xiangqi's flying general: the generals can't face each other on an open file.
    - A cannon with no screen can't capture.
- [ ] **Step 2: Run** `yarn test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep every existing caller working.
- [ ] **Step 4: Run** `yarn ts` and `yarn test`. Expected: PASS, with the coverage test passing only through `PENDING_COVERAGE`.
- [ ] **Step 5: Commit.**

---

### Task 2: Art, promoted roles, and the river and palaces

**Files:**
- Modify:
  - `src/ui/pieces.ts`: per-variant art for `shogi` and `xiangqi`. Letters in `pnbrqk` must not fall to the standard art where the game's piece differs: the Shogi pawn and knight, and the Xiangqi horse, elephant and soldier.
  - `parsePieceClass`: chessgroundx draws `+P` as role `pp-piece` with a `promoted` class. The function should return `{ letter, color, promoted: boolean }`.
  - `src/ui/board-view.ts` and `src/ui/styles.css`: Xiangqi's river and palace shading, through a `data-variant="xiangqi"` hook on the board host.
- Test:
  - `src/ui/pieces.test.ts`: every letter and promoted form of both games has art, no promoted form shares its unpromoted image, and the chosen piece set draws the Shogi king, rook and bishop and the Xiangqi chariot and general.
  - `e2e/pieces.spec.ts`: a Shogi and a Xiangqi position show art and no token, including a promoted piece, and the Xiangqi board shows its river and palace shading.
- **Art map** (spec):
  - Shogi: the pawn, lance, knight, silver and gold use their tiles. Promoted pawn, lance, knight and silver use the gold tile. The promoted bishop uses the dragon-horse tile. The promoted rook uses the Alfaerie bers art (`kingrook`). The king, rook and bishop come from the chosen piece set.
  - Xiangqi: the chariot and general come from the chosen piece set (R and K). The advisor uses `ferz`. The elephant uses `elephantwazir`, the horse `horse`, the cannon the Shako cannon, and the soldier `chinesepawn`.
- **Builder's call:** a small marker on promoted gold-movers, so they read as promoted even though they share the gold tile. Promotion must still be visible somehow: the constraint is that a promoted piece never looks the same as its unpromoted form, and the gold-mover tile alone already differs from the pawn, lance, knight and silver tiles.
- [ ] Steps 1–5 as above: failing tests, run, implement, run (`yarn ts`, `yarn test`, and `yarn test:e2e e2e/pieces.spec.ts --workers 2`), commit.

---

### Task 3: Playing: promotion choice, pockets and drops

**Files:**
- Modify:
  - `src/ui/app.ts` `onBoardMove`: the promotion choice for `+`, with the choice labels from Global Constraints, and drops.
  - `src/ui/board-view.ts`: Shogi's pockets shown from the start, even when empty. Dragging from a pocket offers the legal drop squares from the rules (`legalMoves` filtered to drops of that piece), and dropping calls a new `onDrop(piece, to)`.
  - `src/ui/choice-dialog.ts`: the promotion labels.
  - `src/ui/pieces.ts` `pocketRoles`: Shogi's droppable roles.
  - `src/session/session.ts`: only if drop UCI needs anything there. Undo already pops plies.
- Test:
  - `e2e/shogi.spec.ts`:
    - A capture puts the piece in White's pocket.
    - Dragging it to an empty square drops it, and the move list shows `B@e5`.
    - Undo returns it to the pocket (Review Focus 1).
    - Promotion asks, and Cancel puts the piece back.
    - A forced promotion doesn't ask (Review Focus 2).
    - A reload restores the hands and the promoted art (Review Focus 3).
    - The AI at the beginner level plays a legal move, and a drop if offered, for example from a position where dropping is its only legal move.
  - `e2e/xiangqi.spec.ts`: a hot-seat game plays the opening moves of both sides, the AI replies legally, and the flying-general rule holds on the board (Review Focus 5).
- [ ] Steps 1–5: failing tests, run, implement, run (`yarn ts`, `yarn test`, the two new specs with `--repeat-each 3 --workers 2`, then the full `yarn test:e2e --workers 2`), commit.

---

### Task 4: Position-only editor bases

**Files:**
- Modify:
  - `src/ui/editor/editor-model.ts`, `editor-view.ts` and `editor-controls.ts`: for a `shogi` or `xiangqi` base:
    - the size controls are fixed and disabled, with a one-line reason
    - the palette holds only the game's own pieces, with Shogi's promoted forms as entries that place `+X`
    - the Shogi pocket controls are present
    - the promotion and castling controls are absent
  - `src/variants/generator.ts` `needsCustomVariant`: false for these bases. The check accepts the setup as the curated variant with the FEN, through `positionProblems`.
- Test:
  - `src/ui/editor/editor-model.test.ts`: a Shogi base has a fixed size and offers promoted forms, and its spec never needs a custom variant.
  - `e2e/editor.spec.ts`:
    - Build a Shogi setup with pieces in hand and a promoted piece, then Play, and it starts as `shogi` from that FEN.
    - Edit a Shogi game mid-game, then Resume (Review Focus 4).
    - The same for Xiangqi, with no promoted forms.
- [ ] Steps 1–5: failing tests, run, implement, run (`yarn ts`, `yarn test`, `yarn test:e2e e2e/editor.spec.ts --workers 2`), commit.

---

### Task 5: Tutorial pages and shared lessons

**Files:**
- Create: `src/tutorial/content/variants/shogi.json` and `xiangqi.json` (variant pages, 2–4 short points each). Shogi covers drops, promotion and what each piece becomes, and that the first mover is traditionally called Black. Xiangqi covers the river, the palaces, the flying general, and that Red moves first.
- Modify:
  - `fairy/bers.json`: add a "Dragon King (Shogi)" card and a sentence saying Shogi's promoted rook moves this way.
  - The `teaches` of the shared lessons wherever a Shogi or Xiangqi letter is `inherited` but moves like the lesson's piece. Use `{ variant, letter }` entries, so `lessonFor` finds them.
  - `fairy/elephant.json` and `fairy/soldier.json`: replace "this app has no river" and "it may always move sideways" with text saying the editor's piece moves freely, and that the Xiangqi game confines it (see the Xiangqi lessons).
  - Remove the letters these changes cover from `PENDING_COVERAGE`.
- Test: the content check passes for every changed file. `lessonFor` finds a lesson for each Shogi letter, and for the Xiangqi chariot, horse and cannon.
- [ ] Steps 1–5: failing tests, run (`yarn test src/tutorial`), write the JSON, run `yarn test`, commit.

---

### Task 6: The four Xiangqi lessons

**Files:**
- Create: `src/tutorial/content/fairy/xiangqi-general.json`, `xiangqi-advisor.json`, `xiangqi-elephant.json` and `xiangqi-soldier.json`.
  - Each is a piece lesson on curated `{ variant: 'xiangqi', fen }` boards, with `teaches: [{ variant: 'xiangqi', letter }]` and a card named "(Xiangqi)".
  - Each follows the four steps: see, try, 2–3 strategy pages, and about four puzzles building to a mate in 2. Use `yarn tutorial:search` with `PIECE=xiangqi:<letter>`.
  - If no unique mate in 2 can be found for a piece, stop and report. The owner decides.
- Modify: empty `PENDING_COVERAGE` and remove it, so the coverage test covers both games fully.
- Test: the content check passes for all four lessons, and the coverage test passes with no pending letters.
- [ ] Steps 1–5: add the lesson stubs (they fail the shape check), write each lesson and run `yarn test src/tutorial/content.test.ts` after each, then run `yarn test` and check the time is under 60 s. Commit.

After Task 6, record what the work learned about the rules (drops, promotion and the palace probe) in `docs/specs/chess/engine.md` Spike findings.
