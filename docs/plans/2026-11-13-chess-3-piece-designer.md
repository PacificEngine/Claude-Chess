# Chess Plan 3: Piece Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player invent pieces by describing how they move, pick artwork for each from any piece art the site ships, keep them in a library, and use them in the board editor, saved setups and games (against the AI or hot-seat).

**Architecture:**
- **Pure Betza module.** It turns designer components (step or slide, a direction set, a range, a mode, and combinations with built-in pieces) into a Betza string, and validates Betza typed by hand.
- **Library.** Designed pieces live in a versioned library under `chess.pieces`.
- **Setups carry copies.** A `SetupSpec` carries a *copy* of each designed piece it uses (library id, Betza, art). The generator emits those copies as `customPieceN = <letter>:<betza>`. So the existing hash names, engine `check`, registry, restore and editor flows carry designed pieces with no new loading path.
- **Art catalog.** The catalog lists every image with both a White and a Black version. A designed letter is drawn with its chosen art, or as a lettered token when it has none.

**Tech Stack:** As in Plans 1–2 (TypeScript, Vite, Vitest, Playwright, yarn 1.22, Node 22, `ffish-es6@0.7.10`, `fairy-stockfish-nnue.wasm@1.1.12`, `chessgroundx@10.7.5`).

**Spec:** `docs/specs/chess/editor.md` (Piece designer, Changing a designed piece, Technical Constraints, Security), `docs/specs/chess/engine.md` (spike findings: 25 custom slots, Betza `m c p g n` work, `j` ignored).

## Global Constraints

- **Process:** yarn only. Write each test before its code. Commit after each red-green cycle on branch `feat/piece-designer`. Commit messages explain *why*. No Co-Authored-By or Claude signature lines.
- **Layer rule:** `src/session`, `src/rules`, `src/engine`, `src/persistence` and `src/variants` must not import DOM APIs or UI modules. The UI never decides legality itself.
- **Slot limit:** at most 25 designed pieces in one setup (`customPiece1`–`customPiece25`). A 26th is a problem with the text `'A setup can use at most 25 designed pieces.'`.
- **Betza safety:** a designed piece's Betza must match `^[A-Za-z0-9]{1,40}$` and must not contain `j`. Anything else is refused, with the text `'This move description uses characters the engine does not accept.'`, or `'The "j" modifier is not supported by the engine.'` when it contains `j`, or `'This move description is too long (at most 40 characters).'` when only its length is wrong. Engine `check` still validates everything else.
- **Every piece must move:** a designed piece must reach at least one square on the preview board. If it can't, the designer refuses to save it, with the text `'This piece cannot move anywhere.'`.
- **Royalty:** designed pieces are never royal.
- **Text:** piece names are user text. They are rendered with `textContent` only and never enter a variant definition.
- **Storage:** `chess.pieces` holds `{ version: 1, data: DesignedPiece[] }`. A setup's copy of a designed piece is the source of truth for that setup; the library is only where copies come from.
- **Art choices:** every image under `public/pieces/` that has both a `w…` and a `b…` file (Merida, Merida/Shako, Alfaerie, shogi-tile), plus "Lettered token". The default is the token. Spartan is excluded because its art covers Black only. An art id read from storage that isn't in the catalog draws a token; it never throws.
- **Engine needed:** the preview and saving a piece need the engine's `check`. While the engine is unavailable, both are disabled with `ENGINE_NEEDED_MESSAGE`. This is the same rule the editor already follows.

## Review Focus

1. **Deleting a library piece that saved setups or a saved game use.** Those still load and play, from their copies. *Test in Task 6.*
2. **An unknown or removed art id in storage.** The piece draws as a token, with no crash. *Test in Task 4.*
3. **A setup with 26 designed pieces.** The editor shows the slot-limit problem, and Play stays disabled. *Test in Task 3.*
4. **Hand-typed Betza with `j`, odd characters, or something the engine rejects.** The designer shows the reason, and Save stays disabled. *Test in Task 5.*
5. **"Update everywhere" while the game in progress uses the piece.** The game's variant is regenerated under a new name and the position is kept. With "Save as new piece", nothing that already exists changes. *Test in Task 6.*

---

### Task 1: Betza building blocks

**Files:**
- Modify: `src/variants/piece-types.ts` (add `betza: string` to every `PieceType`, taken from Fairy-Stockfish's `piece.cpp` for the bundled version)
- Create: `src/variants/betza.ts`, `src/variants/betza.test.ts`

**Interfaces:**
- Produces:
  - `type Leap = 'W' | 'F' | 'D' | 'N' | 'A' | 'H' | 'C' | 'Z' | 'G'`
  - `LEAPS: { atom: Leap; label: string }[]` (for example `{ atom: 'W', label: '1 square orthogonally' }` and `{ atom: 'N', label: 'Knight jump (1,2)' }`)
  - `type Mode = 'both' | 'move' | 'capture' | 'cannon'`
  - `interface MoveComponent { atom: Leap; slide: boolean; range: number | null; mode: Mode }`
    - `range` is the most squares a slide may go. `null` means unlimited, and it applies only when `slide` is true.
  - `buildBetza(components: MoveComponent[], combineWith: string[]): string`
    - `combineWith` holds built-in piece type names, whose `betza` strings are appended.
  - `betzaProblem(betza: string): string | null` (the Global Constraints safety texts, or null)
- Betza rules:
  - A slide is the doubled atom (`WW`), or the atom with a range (`W3`).
  - Modes:
    - `move` prefixes `m`
    - `capture` prefixes `c`
    - `cannon` is `m<slide>cp<slide>`, which moves like the slide and captures by hopping one screen

- [ ] **Step 1: Write the failing tests.** They use real ffish, so each built string is proven by the moves it allows, not by its text.

```ts
it('builds a rook from orthogonal slides and the engine moves it like the built-in rook', () =>
  expect(movesOf(buildBetza([{ atom: 'W', slide: true, range: null, mode: 'both' }], []))).toEqual(movesOf(pieceTypeByName('rook').betza)));
it('limits a slide to its range', () => expect(movesOf(buildBetza([{ atom: 'F', slide: true, range: 2, mode: 'both' }], [])).length).toBe(8));
it('builds a cannon that captures only over a screen, like the built-in cannon', () =>
  expect(capturesOver(buildBetza([{ atom: 'W', slide: true, range: null, mode: 'cannon' }], []))).toEqual(capturesOver(pieceTypeByName('cannon').betza)));
it('combines components with built-in pieces (rook + knight moves like the chancellor)', () =>
  expect(movesOf(buildBetza([{ atom: 'N', slide: false, range: null, mode: 'both' }], ['rook']))).toEqual(movesOf(pieceTypeByName('chancellor').betza)));
it('gives every built-in piece the Betza the engine plays it with', () => {
  for (const p of BUILTIN_PIECES.filter((p) => !p.royal)) expect(movesOf(p.betza), p.type).toEqual(builtinMoves(p.type));
});
it('refuses j, unsafe characters and empty strings', () => {
  expect(betzaProblem('jR')).toBe('The "j" modifier is not supported by the engine.');
  expect(betzaProblem('R\n[x]')).toBe('This move description uses characters the engine does not accept.');
  expect(betzaProblem('')).not.toBeNull();
  expect(betzaProblem('mRcpR')).toBeNull();
});
```

The helpers `movesOf(betza)`, `capturesOver(betza)` and `builtinMoves(type)` go in the test file. They load one probe variant per Betza through `rules.loadConfig`, using a fresh `probe_<fnv1a>` name each time, and list the moves from d4 on an empty 8×8 board (with a black pawn screen for `capturesOver`).

- [ ] **Step 2:** Run `yarn test src/variants/betza`. Expected: FAIL, because the module is missing.
- [ ] **Step 3:** Implement `betza.ts` (pure) and the `betza` field. If a built-in's Betza from `piece.cpp` doesn't reproduce its moves in ffish (some built-ins are special-cased in code, such as pawns or the Janggi pieces), mark that type `betza: ''`. `buildBetza` then refuses to combine with it, and the test skips it with a comment naming the reason.
- [ ] **Step 4:** Run `yarn test src/variants`. Expected: PASS. Commit.

### Task 2: Art catalog and the piece library

**Files:**
- Create: `src/ui/art-catalog.ts`, `src/ui/art-catalog.test.ts`, `src/persistence/pieces.ts`, `src/persistence/pieces.test.ts`

**Interfaces:**
- Produces:
  - `interface ArtChoice { id: string; label: string; white: string; black: string }`
    - `id` is `<dir>/<file>`, for example `alfaerie/amazon` or `merida/Q`.
    - `white` and `black` are paths under `public/`.
  - `ART_CHOICES: readonly ArtChoice[]` (built from a static list in code, not by scanning the disk at runtime)
  - `artChoice(id: string | null): ArtChoice | null` (null for an unknown id)
  - `interface DesignedPiece { id: string; name: string; letter: string; betza: string; art: string | null; savedAt: number }`
  - `PIECES_VERSION = 1`
  - `loadPieces(store): { pieces: DesignedPiece[]; problem: 'corrupt' | null }`
  - `savePieces(store, pieces): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
it('offers every piece image the site ships with both colours, and never Spartan', () => {
  for (const c of ART_CHOICES) for (const p of [c.white, c.black]) expect(existsSync(resolve('public', p)), p).toBe(true);
  expect(ART_CHOICES.some((c) => c.id.startsWith('spartan'))).toBe(false);
  expect(ART_CHOICES.map((c) => c.id)).toEqual(expect.arrayContaining(['merida/Q', 'merida/shako/C', 'alfaerie/amazon', 'shogi-tile/gold']));
});
it('gives an unknown art id no art instead of throwing', () => expect(artChoice('gone/x')).toBeNull());
it('keeps a malformed piece library from crashing the app', () => { /* corrupt chess.pieces → { pieces: [], problem: 'corrupt' } */ });
it('round-trips designed pieces through storage', () => { /* save then load equals */ });
```

Add a test that walks `public/pieces/*` with `readdirSync` and checks that every `w*.svg` that has a matching `b*.svg` outside `spartan/` appears in `ART_CHOICES`, so new art can't be forgotten. The catalog itself stays a static list.

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement both. Labels are plain English: the existing piece names where known (for example "Queen (Merida)" and "Amazon (Alfaerie)"), and otherwise the file name in title case. `src/persistence/pieces.ts` validates each entry's shape. Its Betza and art values are validated where they are used (Tasks 3–4).
- [ ] **Step 4:** Run the tests. Expected: PASS. Commit.

### Task 3: Designed pieces in setups and the generator

**Files:**
- Modify: `src/variants/setup.ts` (`SetupSpec.designed?: Record<string, DesignedCopy>`, `isSetupSpec`), `src/variants/generator.ts`, `src/variants/generator.test.ts`, `src/variants/registry.test.ts`, `e2e/registry.spec.ts`

**Interfaces:**
- Produces:
  - `interface DesignedCopy { id: string; betza: string; art: string | null }`
    - The keys of `SetupSpec.designed` are lowercase letters, disjoint from `pieces`.
  - `generateVariant` emits, for designed letters in sorted order, `customPiece<N> = <letter>:<betza>` with N from 1 upward. It includes them in `pieceToCharTable`, and allows them as promotion targets.
  - `needsCustomVariant` returns true whenever `designed` is non-empty.
  - The name hash covers the designed lines, because they are part of the body.

- [ ] **Step 1: Write the failing tests**

```ts
it('emits a designed piece as a custom piece the engine plays by its Betza', () => { /* chess base + designed z:'NN' (nightrider) → ffish moves from the setup FEN include a 3-knight-jump square */ });
it('names setups differently when only a designed piece’s moves differ', () => expect(nameWith('NN')).not.toBe(nameWith('N')));
it('refuses a 26th designed piece with the slot-limit text', () => expect(() => generateVariant(specWithDesigned(26))).toThrow('A setup can use at most 25 designed pieces.'));
it('refuses unsafe Betza with the safety text', () => expect(() => generateVariant(specWithDesigned(1, 'jR'))).toThrow('The "j" modifier is not supported by the engine.'));
it('refuses a designed letter that is also a built-in or base letter', () => { /* designed.n on a chess base → throws */ });
it('accepts setups without designed pieces exactly as before', () => expect(generateVariant(plainSpec()).name).toBe(KNOWN_PLAIN_NAME));
```

Pin `KNOWN_PLAIN_NAME` by computing it on the current code before you change anything, so existing saved setups keep their names. Add a registry e2e test: a setup with a designed nightrider registers, and the engine returns a legal move in it.

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it. In `isSetupSpec`, `designed` is optional, and when present it must be a record of `{ id: string; betza: string; art: string | null }`.
- [ ] **Step 4:** Run `yarn test src/variants && yarn test:e2e e2e/registry.spec.ts`. Expected: PASS. Commit.

### Task 4: Drawing designed pieces

**Files:**
- Modify: `src/variants/active.ts` (expose `designedArt(v, letter): string | null`), `src/ui/pieces.ts` (`artUrl` resolves a designed letter through `artChoice`), `src/ui/board-view.ts`, `src/ui/pieces.test.ts`, `e2e/pieces.spec.ts`

**Interfaces:**
- Produces:
  - `artUrl(letter, color, artBase, type?, designedArt?: string | null)`
  - A designed letter uses its art choice's `white` or `black` path. With no art, or an unknown id, it is a token.
  - Designed letters never fall back to the base's art for the same letter.

- [ ] **Step 1: Write the failing tests**

```ts
it('draws a designed piece with the art the player chose, for each side', () =>
  expect(artUrl('z', 'black', 'chess', undefined, 'alfaerie/amazon')).toBe('pieces/alfaerie/bamazon.svg'));
it('draws a designed piece with no art, or with art that no longer exists, as a lettered token', () => {
  expect(artUrl('z', 'white', 'chess', undefined, null)).toBeNull();
  expect(artUrl('z', 'white', 'chess', undefined, 'gone/x')).toBeNull();
});
```

Add an e2e test that loads a custom game whose setup has a designed `z` with `alfaerie/ox` art and checks the board piece's background image. A second e2e test seeds a saved custom game whose copy has art `gone/x`, then checks the app starts and the piece is a token.

- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement it. Pockets and the editor palette use the same path.
- [ ] **Step 4:** Run `yarn test && yarn test:e2e e2e/pieces.spec.ts`. Expected: PASS. Commit.

### Task 5: The piece designer screen and the editor palette

**Files:**
- Create: `src/ui/designer/designer-model.ts` (pure state: name, letter, components, combineWith, advanced Betza override, art; `toPiece()`; unit-tested), `src/ui/designer/designer-model.test.ts`, `src/ui/designer/designer-view.ts` (controls, art picker, preview board), `src/ui/designer/designer.ts` (wiring: preview registration, save, delete), `e2e/designer.spec.ts`
- Modify: `src/ui/editor/editor-view.ts` (a "Your pieces" palette section listing library pieces with their art, plus "New piece…" and "Edit…" entries), `src/ui/editor/editor-model.ts` (placing a designed piece copies it into the setup's `designed` and gives it the piece's preferred letter if free, else the first free letter), `src/ui/app.ts` (opens the designer from the editor), `src/ui/styles.css`

**Interfaces:**
- Consumes: Tasks 1–4, `registerSetup`, `positionProblems`, `ENGINE_NEEDED_MESSAGE`.
- Produces: `openDesigner(piece: DesignedPiece | null)` in the editor wiring, where null means a new piece.

- [ ] **Step 1: Write the failing unit tests** for `designer-model`, covering:
  - components to Betza (via Task 1)
  - the advanced box overriding the components
  - a name that is required, 1–30 characters
  - a letter that is a–z
  - art defaulting to null (a token)

- [ ] **Step 2: Write the failing e2e tests** in `e2e/designer.spec.ts`:
  - 'designs a piece from components, sees its moves on the preview, picks Alfaerie art, and saves it to the library'
  - 'places a designed piece in a setup and plays it hot-seat: the piece moves as designed and shows its art'
  - 'plays a setup with a designed piece against the AI and gets a legal reply'
  - 'refuses hand-typed Betza with j or bad characters, with the reason, and keeps Save disabled'
  - 'refuses a piece that cannot move anywhere'
  - 'keeps designed pieces and their art across a reload'
  - 'disables the preview and Save while the engine is unavailable, with the reason'
  - 'shows the slot-limit problem when a setup would use 26 designed pieces' (seed 26 pieces in the library, then place them)
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement it.
  - **Preview:** an 8×8 board with the piece on d4, both kings in corners and a few black pawns as screens. It is registered as a setup through `registerSetup`, debounced at 300 ms, and the reachable squares are highlighted using the rules adapter. Capture-only squares are shown differently from move squares.
  - **Art picker:** a grid of every `ART_CHOICES` entry showing the White image, plus "Lettered token". The selected choice is highlighted.
  - **Delete:** asks inline ("Delete? Yes / No").
- [ ] **Step 5:** Run `yarn ts && yarn test && yarn build && yarn test:e2e`, with the designer spec at `--repeat-each 3`. Expected: PASS. Commit.

### Task 6: Changing a piece that is already used

**Files:**
- Modify: `src/ui/designer/designer.ts`, `src/persistence/setups.ts` (a pure helper `setupsUsingPiece(setups, id)` and `rewritePieceCopies(spec, piece): SetupSpec`), `src/session/restore.ts` or `src/ui/app.ts` (the game in progress), `e2e/designer.spec.ts`

**Interfaces:**
- Produces:
  - `rewritePieceCopies(spec: SetupSpec, piece: DesignedPiece): SetupSpec`. It replaces the Betza and art of every copy with `piece.id` and keeps the letters.
  - A choice dialog, "Update everywhere" or "Save as new piece", shown only when saving an edit of a piece that a saved setup or the current game uses.

- [ ] **Step 1: Write the failing tests**

```ts
it('rewrites only the copies of the changed piece, keeping letters', () => { /* spec with two designed pieces → only one copy changes */ });
```

Add these e2e tests:
- 'saving a used piece as new leaves saved setups and the game unchanged'
- 'updating a used piece everywhere changes saved setups and the game in progress, which keeps its position under a new variant name'
- 'deleting a library piece leaves setups and games that use it playable from their copies'
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement it.
  - **Updating the game in progress:** rewrite the copies in its setup, register the new setup (engine check), and replace the session with `GameSession.create` from the current FEN. Use the same opponent and clock, and carry the paused times over, as in Resume.
  - **If registration fails:** keep the old game and show the problems.
- [ ] **Step 4:** Run `yarn ts && yarn test && yarn build && yarn test:e2e`. Expected: PASS.
- [ ] **Step 5:** Update `docs/specs/chess/editor.md` only where the implementation settled something: preview layout, how the letter is assigned, and the dialog. Keep spec style. Commit.
