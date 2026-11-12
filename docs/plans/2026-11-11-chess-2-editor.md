# Chess Plan 2: Board Editor and Edit Current Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player build a custom setup (any board size from 5×5 to 12×10, any built-in Fairy-Stockfish piece, a chosen base rule set), save it, and play it against the AI or hot-seat. Let them also edit the game in progress at any time and resume it.

**Architecture:**
- A pure **generator** turns a `SetupSpec` into a Fairy-Stockfish variants.ini section. The section inherits from the base variant and is named by a hash of its own text.
- A **registry** validates that section with the engine's `check` command, then loads it into ffish.js and the engine.
- The UI layers stop depending on the curated catalog directly. They depend on an `ActiveVariant` description, which curated and custom variants both provide.
- Editing the game in progress starts a new `GameSession` from the edited position, carrying the paused clock times over.
- Saved data stores the `SetupSpec`, never ini text.

**Tech Stack:** As in Plan 1 (TypeScript, Vite, Vitest, Playwright, yarn 1.22, Node 22, `ffish-es6@0.7.10`, `fairy-stockfish-nnue.wasm@1.1.12`, `chessgroundx@10.7.5`).

**Spec:** `docs/specs/chess/editor.md` (see its Technical Constraints), `docs/specs/chess/chess.md` ("Edit current game"), `docs/specs/chess/engine.md` (spike findings).

**Later plans:** Plan 3 is the piece designer, which adds designed pieces to the palette and `customPieceN` to the generator. Plan 4 is the tutorial. In this plan the palette has built-in pieces only, but the `SetupSpec` must leave room for designed pieces (see Task 2).

## Global Constraints

- **Process:** yarn only. Write each test before its code. Commit after each red-green cycle on branch `feat/editor`. Commit messages explain *why*. No Co-Authored-By or Claude signature lines.
- **Layer rule:** `src/session`, `src/rules`, `src/engine`, `src/persistence` and `src/variants` must not import DOM APIs or UI modules. The UI never decides legality itself.
- **Board sizes:** minimum 5×5, maximum 12 files × 10 ranks.
- **Custom setup defaults:** castling off, and pawns promote on the last rank to any non-king piece type in the setup.
- **Variant names:** every generated variant is named `cx_` plus 8 lowercase hex digits of a 32-bit FNV-1a hash of the parent variant's engine name, a newline, then the section body (the text after the `[name:parent]` header). Hashing the parent keeps two bases with identical bodies from sharing a name (ruling during Task 2). The same setup always gets the same name.
- **Validation:** a generated definition reaches `ffish.loadVariantConfig` and the engine's `UCI_Variant` only after the engine's `check` reports no problems. If the engine is unavailable, "Play" and "Resume" stay disabled for a generated definition, and the reason is shown.
- **ffish crash trap:** never create a board for a variant name that isn't in `ffish.variants()`.
- **Text in definitions:** setup and piece names never enter a definition. Any value written into a definition must match `^[A-Za-z0-9_*~+ /-]*$` (no newline, `[`, `]`, `=` or `;`), or the generator throws.
- **Storage:** `chess.setups` holds `{ version: 1, data: SavedSetup[] }`. `chess.game`'s `SessionState` stores `setup?: SetupSpec` and no `ini`. Stored data is validated, and a corrupt entry is moved aside as in Plan 1.
- **Text rendering:** user-entered text is always rendered with `textContent`.
- **Clocks:** they pause while the editor is open, and resume from the paused times.

## Review Focus

1. **Editing changes only the position.** Resuming must keep the curated variant: no generated variant is created, and the panel still says, for example, "Grand". *Test in Task 7.*
2. **Reloading a custom game.** The definition is regenerated from the saved `setup` and re-validated. A setup that no longer validates is treated as corrupt (banner shown, fresh start), and the app must not crash. *Tests in Tasks 5 and 7.*
3. **Editing while the AI is thinking.** Opening the editor stops the search, and the late bestmove is thrown away. *Test in Task 7.*
4. **Shrinking the board.** Pieces outside the new size are removed, and the editor says how many. *Test in Task 6.*
5. **Registering the same setup twice** (playing a saved setup twice, or reloading). The second registration is a no-op success, not an "already exists" error. *Test in Task 3.*

---

### Task 1: Built-in piece catalog

**Files:**
- Create: `src/variants/piece-types.ts`, `src/variants/piece-types.test.ts`

**Interfaces:**
- Produces:
  - `interface PieceType { type: string; name: string; letter: string; royal: boolean }`
    - `type` is the Fairy-Stockfish variants.ini piece option name, for example `knight`, `archbishop`, `cannon`, `fersAlfil`.
    - `letter` is its default letter.
  - `BUILTIN_PIECES: readonly PieceType[]`
  - `pieceTypeByName(type: string): PieceType`
  - `typesOfVariant(rules: Rules, engineName: string): Map<string, string>` (letter to `type`, for the pieces a curated variant uses, worked out from its start FEN and pockets)

- [ ] **Step 1: Write the failing test.** Each test uses real ffish via `loadTestRules()`.

```ts
it('offers every Fairy-Stockfish built-in piece so the editor palette is complete', () =>
  expect(BUILTIN_PIECES.length).toBeGreaterThanOrEqual(30));
it('lets each built-in piece move on an empty board, so none is a dead entry', async () => {
  for (const p of BUILTIN_PIECES.filter(p => !p.royal)) {
    const { name, ini } = probeVariant(p);          // test helper: [probe_<type>:chess] with `<type> = <letter>`
    rules.loadConfig(ini);
    expect(rules.newGame(name, `8/8/8/3${p.letter.toUpperCase()}4/8/8/8/K6k w - - 0 1`).legalMovesFrom('d5').length, p.type).toBeGreaterThan(0);
  }
});
it('knows which piece type each curated variant uses for each letter', () => {
  expect(typesOfVariant(rules, 'capablanca').get('a')).toBe('archbishop');
  expect(typesOfVariant(rules, 'shako').get('c')).toBe('cannon');
});
```

- [ ] **Step 2:** Run `yarn test src/variants/piece-types`. Expected: FAIL, because the module is missing.
- [ ] **Step 3:** Build the list from Fairy-Stockfish's piece-type names for the bundled engine version (`b2e693ef`, from `src/piece.cpp` / `src/parser.cpp` at that commit).
  - Include only types that load and move in ffish.
  - Mark `king` and `commoner` royal-capable. Only `king` gets `royal: true`.
  - Give display names in plain English.
  - `typesOfVariant` maps letters by comparing each letter's moves on an empty board with each built-in type's moves. If a letter is ambiguous, it throws.
- [ ] **Step 4:** Run `yarn test src/variants`. Expected: PASS. Commit.

### Task 2: Variant generator (pure)

**Files:**
- Create: `src/variants/setup.ts`, `src/variants/generator.ts`, `src/variants/generator.test.ts`

**Interfaces:**
- Consumes: `VariantId` and `variantById` (catalog), `PieceType` (Task 1).
- Produces:
  - `interface SetupSpec { base: VariantId; files: number; ranks: number; pieces: Record<string, string>; fen: string; castling: boolean; promotion: { rank: 'last'; pieceTypes: string[] } }`
    - `pieces` maps a letter to a built-in `type`. Plan 3 adds `designed: Record<string, string>` (letter to designed-piece id).
  - `isSetupSpec(d: unknown): d is SetupSpec`
  - `generateVariant(spec: SetupSpec): { name: string; ini: string }`
  - `needsCustomVariant(spec: SetupSpec, base: ActiveVariantShape): boolean` (false when only the position differs from the base: same size, every letter is one the base already has, same castling and promotion)
  - `MIN_FILES = 5`, `MIN_RANKS = 5`, `MAX_FILES = 12`, `MAX_RANKS = 10`

- [ ] **Step 1: Write the failing tests**

```ts
it('names a setup by a hash of its definition so the same setup never needs redefining', () => {
  expect(generateVariant(spec()).name).toBe(generateVariant(spec()).name);
  expect(generateVariant(spec()).name).toMatch(/^cx_[0-9a-f]{8}$/);
  expect(generateVariant({ ...spec(), files: 9 }).name).not.toBe(generateVariant(spec()).name);
});
it('inherits from the base variant and overrides only what the setup changes', () => {
  const { name, ini } = generateVariant({ ...spec(), base: 'grand', files: 12, ranks: 10 });
  expect(ini.split('\n')[0]).toBe(`[${name}:grand]`);
  expect(ini).toContain('maxFile = l');
  expect(ini).toContain('maxRank = 10');
});
it('defaults to no castling and last-rank promotion to every non-king piece in the setup', () => { /* assert castling = false and promotionPieceTypes lists the setup's non-king, non-pawn letters */ });
it('refuses values that could inject extra variants.ini lines', () =>
  expect(() => generateVariant({ ...spec(), fen: 'k7/8/8/8/8/8/8/K7 w - - 0 1\nstartFen = x' })).toThrow());
it('refuses board sizes outside 5x5..12x10', () => {
  expect(() => generateVariant({ ...spec(), files: 4 })).toThrow();
  expect(() => generateVariant({ ...spec(), ranks: 11 })).toThrow();
});
it('loads in ffish and plays from the setup position', () => { /* rules.loadConfig(ini); rules.newGame(name).fen() === spec.fen; legalMoves non-empty */ });
it('needs no custom variant when only the position changed', () =>
  expect(needsCustomVariant(chessSpecWithDifferentFen(), curatedActive('chess'))).toBe(false));
```

Write the helper `spec()` in the test file: an 8×8 `base: 'chess'` setup with K, Q and R per side.

- [ ] **Step 2:** Run `yarn test src/variants/generator`. Expected: FAIL.
- [ ] **Step 3:** Implement the generator. Output one ini section. Write the option names exactly as the bundled Fairy-Stockfish parser expects:
  - `maxFile`, `maxRank`, `startFen`, `castling`
  - one line per piece type, `<type> = <letter>`
  - the promotion region options, which are `promotionRank` or `promotionRegionWhite/Black` depending on the version (check `src/parser.cpp` at `b2e693ef`)
  - `promotionPieceTypes`
  - `pieceToCharTable` whenever letters beyond the base's are added

  Write the body lines in a fixed order, so the hash is stable. `ActiveVariantShape` is `{ files: number; ranks: number; letters: string[]; castling: boolean }`. Get it from Task 5's `ActiveVariant`, or define it here and let Task 5 satisfy it.
- [ ] **Step 4:** Run `yarn test src/variants`. Expected: PASS. Commit.

### Task 3: Engine `check`, ffish name lookup, and the registry

**Files:**
- Modify: `src/engine/engine.ts`, `src/engine/engine-worker.ts` (if needed), `src/rules/types.ts`, `src/rules/rules.ts`
- Create: `src/variants/registry.ts`, `src/variants/registry.test.ts`, `e2e/registry.spec.ts`
- Modify: `e2e/pages/engine-harness.ts` (expose the registry for the e2e)

**Interfaces:**
- Consumes: `generateVariant` (Task 2).
- Produces:
  - `Engine.check(ini: string): Promise<string[]>`. It writes the file, sends `check <path>`, then `isready`, and collects the problem lines until `readyok`. An empty array means valid.
  - `Rules.knows(name: string): boolean` (backed by `ffish.variants()`)
  - `registerSetup(rules: Rules, engine: Engine | null, spec: SetupSpec): Promise<{ ok: true; name: string; ini: string } | { ok: false; problems: string[] }>`

- [ ] **Step 1: Write the failing unit test** (real ffish; `engine` is `null`)

```ts
it('refuses a custom setup while the engine is unavailable, because ffish cannot validate it', async () =>
  expect(await registerSetup(rules, null, spec())).toEqual({ ok: false, problems: [ENGINE_NEEDED_MESSAGE] }));
```

Export `ENGINE_NEEDED_MESSAGE = 'The AI engine is needed to check custom setups and is not available.'`.

- [ ] **Step 2: Write the failing e2e tests** in `e2e/registry.spec.ts`, using the engine harness page.

```ts
test('a valid setup registers in both ffish and the engine and the engine can move in it', ...);
test('registering the same setup twice succeeds without an "already exists" error', ...);
test('an invalid definition is refused with the engine’s own problem lines', ...); // e.g. a spec whose generated ini is hand-corrupted via a test-only path → problems non-empty, Rules.knows(name) === false
```

- [ ] **Step 3:** Run `yarn test src/variants/registry` and `yarn test:e2e e2e/registry.spec.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement it. In `registerSetup`:
  - if `rules.knows(name)`, return ok without loading anything
  - otherwise run `engine.check(ini)`
  - if there are problems, return them
  - otherwise run `rules.loadConfig(ini)`, confirm `rules.knows(name)`, and return ok

  The engine loads the ini later through the existing `setVariant(name, ini)`. Treat `pieceToCharTable - Missing piece type` lines as problems, because the generator must prevent them.
- [ ] **Step 5:** Run `yarn ts && yarn test && yarn test:e2e e2e/registry.spec.ts`. Expected: PASS. Commit.

### Task 4: Position legality

**Files:**
- Modify: `src/rules/types.ts`, `src/rules/rules.ts` (add `RulesGame.inCheck(): boolean`)
- Create: `src/variants/legality.ts`, `src/variants/legality.test.ts`

**Interfaces:**
- Produces:
  - `positionProblems(rules: Rules, variant: string, fen: string): string[]`
  - The problems are plain-English strings, from this fixed set:
    - `'The position is not a valid FEN for this variant.'`
    - `'White needs a king.'` and `'Black needs a king.'` (only when the variant's rules need one)
    - `'The side not to move is in check.'`
    - `'There are no legal moves from this position.'` (checked only when the game isn't already over)

- [ ] **Step 1: Write the failing tests** (real ffish)

```ts
it('blocks a chess position with no black king', () =>
  expect(positionProblems(rules, 'chess', '8/8/8/8/8/8/8/K7 w - - 0 1')).toContain('Black needs a king.'));
it('allows Antichess positions without kings, because the king is an ordinary piece there', () =>
  expect(positionProblems(rules, 'antichess', '8/8/8/8/8/8/p7/R7 w - - 0 1')).toEqual([]));
it('blocks a position where the side not to move is in check', () =>
  expect(positionProblems(rules, 'chess', '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1')).toContain('The side not to move is in check.'));
it('accepts the curated start positions', () => {
  for (const v of CURATED_VARIANTS) expect(positionProblems(rules, v.engineName, rules.newGame(v.engineName).fen()), v.id).toEqual([]);
});
```


- [ ] **Step 2:** Run `yarn test src/variants/legality`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
  - A variant "needs a king" when its start FEN contains `k` and `K`. Spartan needs at least one black king.
  - To check "side not to move is in check", flip the side-to-move field, load the position, and call `inCheck()`. Clear the en-passant square when you flip it.
  - Dispose every board you create.
- [ ] **Step 4:** Run `yarn test src/variants src/rules`. Expected: PASS. Commit.

### Task 5: `ActiveVariant` refactor, and storing the setup instead of ini

Two commits. **5a** is a pure refactor with no behavior change, and the existing tests must stay green without edits beyond types. **5b** is the behavior change, written test-first.

**Files:**
- Create: `src/variants/active.ts`, `src/variants/active.test.ts`
- Modify: `src/ui/board-view.ts`, `src/ui/pieces.ts`, `src/ui/panel.ts`, `src/ui/app.ts`, `src/session/session.ts`, `src/session/session.test.ts`

**Interfaces:**
- Produces:
  - `interface ActiveVariant { engineName: string; label: string; files: number; ranks: number; pockets: boolean; artBase: VariantId; letters: string[]; castling: boolean; setup: SetupSpec | null }`
  - `curatedActive(id: VariantId, rules: Rules): ActiveVariant`
  - `customActive(spec: SetupSpec, name: string): ActiveVariant` (label `Custom (based on <base label>)`, `artBase = spec.base`)
- Changes:
  - `BoardPosition.variant` and the panel take an `ActiveVariant`.
  - `artUrl(letter, color, artBase)` resolves letters through the base variant's art, then through Task 1's piece types. Letters with no art get tokens.
- **5b changes:**
  - `SessionState` drops `ini` and gains `setup?: SetupSpec`.
  - `GameSession.create` and `GameSession.restore` no longer load ini (delete `ensureVariant`). The caller registers the variant first.
  - `GameSession.create` gains an optional `clock?: ClockState`. When given, it starts from those times, paused.
  - `restorable` in `app.ts` accepts a saved game with `setup` after `registerSetup` succeeds and the regenerated name equals `variant`. Otherwise the save is corrupt.

- [ ] **Step 1 (5a):** Introduce `ActiveVariant`, route the board view, pieces and panel through it, and run `yarn ts && yarn test && yarn test:e2e`. Expected: all PASS, unchanged. Commit.
- [ ] **Step 2 (5b): Write the failing tests**

```ts
it('stores a custom game by its setup, never by ini text', () => {
  const s = GameSession.create(rules, { variant: name, setup, opponent: hotseat, clockConfig: null }, 0);
  expect(s.state()).toMatchObject({ setup }); expect('ini' in s.state()).toBe(false);
});
it('can start from carried-over paused clock times so editing costs no time', () => {
  const s = GameSession.create(rules, { variant: 'chess', opponent: hotseat, clockConfig: cfg, clock: { whiteMs: 1000, blackMs: 2000, running: null, since: null } }, 0);
  expect(s.state().clock).toMatchObject({ whiteMs: 1000, blackMs: 2000, running: null });
});
```

Add an e2e test in `e2e/play.spec.ts`: "a saved custom game whose setup no longer validates is treated as corrupt", which seeds storage with a `setup` that has `files: 13`, then expects the corrupt banner and a fresh game.

- [ ] **Step 3:** Run them. Expected: FAIL. Implement 5b. Run `yarn ts && yarn test && yarn test:e2e`. Expected: PASS. Commit.

### Task 6: Editor screen, saved setups, playing a setup

**Files:**
- Create: `src/ui/editor/editor-view.ts` (board plus palette), `src/ui/editor/editor-controls.ts` (base variant, size, side to move, castling, pockets, name, problems list, Play/Save/Close), `src/ui/editor/editor-model.ts` (pure state: place, remove, move, resize, toSpec; unit-tested), `src/ui/editor/editor-model.test.ts`, `src/persistence/setups.ts`, `src/persistence/setups.test.ts`, `e2e/editor.spec.ts`
- Modify: `src/ui/top-bar.ts` (enable Editor), `src/ui/play-dialog.ts` (list saved setups under "Saved setups"), `src/ui/app.ts`, `src/ui/styles.css`

**Interfaces:**
- Produces:
  - `interface SavedSetup { id: string; name: string; spec: SetupSpec; savedAt: number }`
  - `loadSetups(store): { setups: SavedSetup[]; problem: 'corrupt' | null }`
  - `saveSetups(store, setups): boolean`
  - `SETUPS_VERSION = 1`
  - `EditorModel` with `place(square, letter, color)`, `remove(square)`, `move(from, to)`, `resize(files, ranks): { removed: number }`, `setBase(id)`, `setTurn(c)`, `setCastling(b)`, `setPocket(color, letter, count)`, `toSpec(): SetupSpec`, `fromGame(active, fen)`
  - `PlayChoice.variant` becomes `{ kind: 'curated'; id: VariantId } | { kind: 'setup'; id: string }`

- [ ] **Step 1: Write the failing unit tests** for `editor-model` and `setups`

```ts
it('removes pieces that fall off a shrunk board and reports how many', () => {
  const m = EditorModel.fromGame(curated('grand'), GRAND_START); expect(m.resize(8, 8).removed).toBeGreaterThan(0);
  expect(m.toSpec().files).toBe(8);
});
it('builds a spec whose piece letters map to built-in types', () => { /* place an archbishop on a chess base; spec.pieces.a === 'archbishop' */ });
it('keeps a malformed saved-setups list from crashing the app', () => { /* corrupt chess.setups → { setups: [], problem: 'corrupt' } */ });
```

- [ ] **Step 2: Write the failing e2e tests** in `e2e/editor.spec.ts`:
  - 'builds a 10×8 setup with an archbishop, saves it, and plays it hot-seat from the Play dialog'
  - 'plays a saved setup against the AI and gets a legal reply'
  - 'shows why Play is disabled when black has no king, and enables it once a king is placed'
  - 'tells the player how many pieces were removed when the board shrinks'
  - 'keeps saved setups across a reload'
  - 'disables Play for a custom setup while the engine is unavailable, with the reason'
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement the editor.
  - **Placing pieces:** the palette shows every `BUILTIN_PIECES` entry for both colors, plus an eraser. Clicking a palette piece and then a square places it. Pieces on the board can be dragged freely (chessgroundx `movable.free`, with no legality).
  - **Problems:** recomputed on every change. They are `positionProblems`, plus generator errors, plus `registerSetup` problems. "Play" and "Save" are disabled while any are present.
  - **Playing:** "Play" opens the Play dialog with this setup preselected.
  - **Choosing a setup:** picking a setup in the Play dialog registers it, then starts a `GameSession` with `setup`.
  - **Curated-only edits:** when `needsCustomVariant` is false, play the curated variant from the setup FEN instead.
- [ ] **Step 5:** Run `yarn ts && yarn test && yarn test:e2e`. Expected: PASS. Commit.

### Task 7: Edit current game

**Files:**
- Modify: `src/ui/app.ts`, `src/ui/panel.ts` (enable Edit), `src/ui/settings-dialog.ts` (add "Edit current game"), `src/ui/editor/editor-controls.ts` (a "Resume" mode in place of Play/Save)
- Create: `e2e/edit-game.spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `openEditorForCurrentGame(): void` inside `app.ts`.

- [ ] **Step 1: Write the failing e2e tests**

```ts
test('editing only the position resumes the same curated variant with a fresh move history', ...); // Grand, move a piece in editor, Resume → panel says "Grand", undo disabled
test('editing that adds a piece the variant lacks resumes as "Custom (based on Standard)"', ...);
test('clocks pause while editing and resume from the paused times', ...);   // 5+0, open editor 2 s, unchanged
test('opening the editor while the AI is thinking discards its late move', ...);
test('Resume is blocked while the edited position is illegal, with the reason', ...);
test('a resumed custom game survives a reload', ...);
test('after resuming, if it is the AI’s turn the AI moves', ...);
```

- [ ] **Step 2:** Run `yarn test:e2e e2e/edit-game.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement it.
  - **Opening the editor:** the Edit button and Settings → "Edit current game" call `cancelAi()` and `session.pauseClock(now)`, then open the editor with `EditorModel.fromGame(active, session.fen())`. If the game is already over, open it anyway.
  - **Resuming:**
    - Build the spec. If `needsCustomVariant`, register it; otherwise use the curated name.
    - Dispose the old session.
    - Create a new session with the same opponent and clock config and `clock` set to the paused times, then `resumeClock(now)`.
    - Save. If it's the AI's turn, run the AI.
  - **Closing without resuming** returns to the unchanged game, and its clock resumes.
- [ ] **Step 4:** Run `yarn ts && yarn test && yarn build && yarn test:e2e`. Expected: PASS. Update `docs/specs/chess/editor.md` and `chess.md` only where the implementation settled an open question (for example, the engine-unavailable behavior). Commit.
