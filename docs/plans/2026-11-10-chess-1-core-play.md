# Chess Plan 1: Core Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a deployable GitHub Pages site where you can play Standard, the curated fairy variants and Antichess against Fairy-Stockfish (five levels plus Max) or hot-seat, with clocks, undo, and the game saved across reloads.

**Architecture:** Four layers, with dependencies pointing down only: UI → game session → rules adapter (ffish.js) and engine adapter (Fairy-Stockfish wasm in a Web Worker, talking UCI). The session, rules and engine code have no DOM access and are unit-tested. The UI uses chessgroundx to render boards. `coi-serviceworker` gives cross-origin isolation on Pages, which the engine needs.

**Tech Stack:** TypeScript 7, Vite 8, Vitest 5, Playwright 1.65, yarn 1.22, `ffish-es6@0.7.10`, `fairy-stockfish-nnue.wasm@1.1.12`, `chessgroundx@11`, `coi-serviceworker@0.1.7`.

**Spec:** `docs/specs/chess/chess.md`, `docs/specs/chess/engine.md` (design: `docs/designs/2026-11-10-chess-design.md`)

**Later plans (written after Task 1, because its findings shape them):** Plan 2, the board editor plus "edit current game". Plan 3, the piece designer. Plan 4, the tutorial. In this plan, the Edit button is present but disabled.

## Global Constraints

- Use yarn only. Write each test before its code. Commit after each red-green cycle, on a branch and never on `main`. Commit messages explain *why*.
- Session, rules, engine and persistence code (`src/session`, `src/rules`, `src/engine`, `src/persistence`, `src/variants`) must not import DOM APIs or UI modules.
- The engine always runs in a Web Worker. The UI never decides legality or game end itself; only `src/rules` does.
- The engine and ffish.js are bundled with the site. Nothing is loaded from a CDN at runtime.
- AI levels: Beginner 800, Novice 1100, Intermediate 1400, Advanced 1700, Expert 2000 (`UCI_LimitStrength true`, `UCI_Elo`), and Max (`UCI_LimitStrength false`).
- Clock presets: None, 1+0, 3+2, 5+0, 10+5, 15+10, and Custom (base minutes plus increment seconds).
- Flagging: running out of time loses, unless the opponent has insufficient mating material, in which case it's a draw.
- The engine gets 15 s to answer `uciok` / `readyok`, or it is marked unavailable. Hot-seat keeps working when it is.
- `localStorage` keys are `chess.game`, `chess.settings`, `chess.setups`, `chess.pieces`, `chess.tutorial`. Each value is `{ version: number, data: ... }`. Malformed data, or data from an unknown future version, is moved to `<key>.corrupt`.
- User-entered text is always rendered with `textContent`, never `innerHTML`.
- Vite `base: './'`, so the site works under any Pages repo path.

## Review Focus

1. **Promotion with several choices** (Capablanca and Grand promote to Archbishop or Chancellor). The player must be offered every legal promotion piece, and the game must never auto-pick a queen. *Test in Task 8.*
2. **Seirawan gating.** After a back-rank piece's first move, the player must be offered "gate Hawk / Elephant / nothing". *Test in Task 8.*
3. **Reload while it's the AI's turn.** On load, the AI must start searching again instead of the game hanging. *Test in Task 8.*
4. **Clocks across a closed tab or a background tab.**
   - Time is computed from timestamps, not timer ticks, so a background tab still flags correctly.
   - A saved game reloads with its clocks paused at the saved times, so closing the tab never makes you lose on time.
   - *Tests in Tasks 4 and 7.*
5. **Clicks while the AI is thinking.** The player can't move the AI's pieces. Undo stops the search, and the late `bestmove` is thrown away. *Tests in Tasks 5 and 8.*

---

### Task 1: Scaffold, plus engine spike on a header-less server

This is the blocking spike from the engine spec. It answers that spec's "verify" list and records the answers.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `index.html`, `src/main.ts`, `public/coi-serviceworker.min.js` (copied from the package), `spike/engine-spike.html`, `spike/engine-spike.ts`, `e2e/spike.spec.ts`
- Modify: `.gitignore` (add `node_modules/`, `dist/`, `test-results/`, `playwright-report/`), `docs/specs/chess/engine.md` (record the findings and remove the answered open questions)

**Interfaces:**
- Produces: the yarn scripts `dev`, `build`, `preview` (`vite preview --port 4173`), `test` (vitest run), `test:e2e` (playwright test), and `ts` (`tsc --noEmit`).

- [ ] **Step 1:** Run `git init -b main`, make the first commit with the docs, then create and switch to branch `feat/core-play`.
- [ ] **Step 2:** Scaffold Vite with vanilla TypeScript. Add the dev dependencies and dependencies listed in Tech Stack. Set `base: './'`. Configure Vite so the ffish and engine `.wasm` and worker files are copied as assets (for example, with `optimizeDeps.exclude` for both packages).
- [ ] **Step 3: Write the failing e2e test** `e2e/spike.spec.ts`. It runs against `yarn build && yarn preview`, which sends no COOP or COEP headers and so behaves like Pages.

```ts
test('engine answers bestmove on a server without isolation headers', async ({ page }) => {
  await page.goto('/spike/engine-spike.html');
  await expect.poll(() => page.evaluate(() => self.crossOriginIsolated), { timeout: 15000 }).toBe(true);
  const r = await page.evaluate(() => (window as any).runSpike());
  for (const v of ['chess','capablanca','grand','seirawan','amazon','shako','antichess','spartan','spikecustom'])
    expect(r.bestmove[v], v).toMatch(/^[a-l]\d+[a-l]\d+/);
  expect(r.ffishVariantsIncludeSpartan || r.spartanLoadedFromIni).toBe(true);
});
```

- [ ] **Step 4:** Run `yarn test:e2e e2e/spike.spec.ts`. Expected: FAIL, because `runSpike` isn't defined.
- [ ] **Step 5:** Implement `window.runSpike(): Promise<SpikeReport>` in `spike/engine-spike.ts`. It must:
  - register `coi-serviceworker`
  - start the engine worker and send it `uci` and `isready`
  - for each variant, send `setoption name UCI_Variant`, then `position startpos`, then `go movetime 200`
  - load a variants.ini text that defines `spartan` (copied from Fairy-Stockfish's `src/variants.ini`) and `[spikecustom:chess]`, which has `customPiece1 = a:NN` and board size 12×10, into both ffish (`loadVariantConfig`) and the engine (write it to the engine's virtual filesystem, then `setoption name VariantPath`, or `load`, whichever the package supports)

  Also record, in the report:
  - `UCI_Elo`'s min and max from the `uci` option output
  - whether `UCI_Elo` changes play in `grand`
  - the highest `customPieceN` that loads
  - which Betza modifiers in `m c p g n j` load
  - what the single-threaded fallback is, if isolation fails
- [ ] **Step 6:** Run `yarn test:e2e e2e/spike.spec.ts`. Expected: PASS. If isolation or large boards fail, stop and follow the fallbacks in `engine.md`. If no large-board build works, ask the owner.
- [ ] **Step 7:** Write the findings into `docs/specs/chess/engine.md`: the package used, threading, how variants.ini is loaded in each library, the custom piece slot limit, the supported Betza modifiers, the `UCI_Elo` range, and the exact ffish method names for result, insufficient material and SAN. Commit.

### Task 2: Variant catalog

**Files:**
- Create: `src/variants/catalog.ts`, `src/variants/spartan.ini.ts`, `src/variants/catalog.test.ts`

**Interfaces:**
- Produces:
  - `type VariantId = 'chess'|'capablanca'|'grand'|'seirawan'|'amazon'|'shako'|'spartan'|'antichess'`
  - `interface VariantInfo { id: VariantId; label: string; engineName: string; files: number; ranks: number; ini?: string; blurb: string }`
  - `CURATED_VARIANTS: readonly VariantInfo[]`
  - `variantById(id: VariantId): VariantInfo`
  - `requiredIni(): string` (concatenates every `ini` in the catalog)

- [ ] **Step 1: Write the failing test**

```ts
it('lists every owner-approved variant in menu order', () =>
  expect(CURATED_VARIANTS.map(v => v.id)).toEqual(['chess','capablanca','grand','seirawan','amazon','shako','spartan','antichess']));
it('knows board sizes so the UI can lay out large boards', () => {
  expect(variantById('capablanca')).toMatchObject({ files: 10, ranks: 8 });
  expect(variantById('grand')).toMatchObject({ files: 10, ranks: 10 });
  expect(variantById('shako')).toMatchObject({ files: 10, ranks: 10 });
});
it('ships Spartan as config because ffish has no built-in spartan', () =>
  expect(requiredIni()).toContain('[spartan'));
```

Adjust the Spartan expectation to match Task 1's finding.

- [ ] **Step 2:** Run `yarn test src/variants`. Expected: FAIL.
- [ ] **Step 3:** Implement the catalog. Antichess uses engine name `antichess`, which is the lichess rules where a stalemated side wins.
- [ ] **Step 4:** Run `yarn test src/variants`. Expected: PASS. Commit.

### Task 3: Rules adapter

**Files:**
- Create: `src/rules/ffish-loader.ts`, `src/rules/rules.ts`, `src/rules/types.ts`, `src/rules/rules.test.ts`

**Interfaces:**
- Consumes: `VariantInfo` and `requiredIni()` from Task 2.
- Produces:
  - `type Color = 'white'|'black'`
  - `type GameResult = { winner: Color|null; reason: 'checkmate'|'stalemate'|'repetition'|'fifty-move'|'insufficient'|'variant'|'timeout'|'timeout-insufficient' }`
  - `loadRules(): Promise<Rules>` (initializes ffish once and loads `requiredIni()`)
  - `interface Rules { newGame(variant: string, fen?: string): RulesGame; loadConfig(ini: string): void; validateFen(variant: string, fen: string): boolean }`
  - `interface RulesGame { fen(): string; turn(): Color; legalMoves(): string[]; legalMovesFrom(square: string): string[]; san(uci: string): string; push(uci: string): void; pop(): void; result(): GameResult|null; hasInsufficientMaterial(color: Color): boolean; dispose(): void }`

- [ ] **Step 1: Write the failing tests.** They run against real ffish with no mocks.

```ts
describe('antichess', () => {
  it('forces a capture when one is available', () => {
    const g = rules.newGame('antichess', 'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w - - 0 2');
    expect(g.legalMoves()).toEqual(['e4d5']);
  });
  it('awards the win to the side that is stalemated', () => {
    const g = rules.newGame('antichess', /* black to move, no legal moves, pieces on board */ FEN_ANTI_STALEMATE);
    expect(g.result()).toEqual({ winner: 'black', reason: 'variant' });
  });
});
it('offers Seirawan gating moves after a back-rank piece first moves', () =>
  expect(rules.newGame('seirawan').legalMoves()).toContain('g1f3h'));
it('offers every Grand promotion piece, not only the queen', () =>
  expect(rules.newGame('grand', FEN_GRAND_PAWN_ON_9TH).legalMoves().filter(m => m.startsWith('a9a10')).length).toBeGreaterThan(1));
it('does not call a Spartan game over while one of two kings survives', () =>
  expect(rules.newGame('spartan', FEN_SPARTAN_ONE_KING_CAPTURED).result()).toBeNull());
it('reports checkmate with the winner', () =>
  expect(rules.newGame('chess', FEN_FOOLS_MATE).result()).toEqual({ winner: 'black', reason: 'checkmate' }));
```

Build the `FEN_*` constants by hand in the test file and check each one with `validateFen`.

- [ ] **Step 2:** Run `yarn test src/rules`. Expected: FAIL.
- [ ] **Step 3:** Implement it over ffish's `Board`, using the method names recorded in Task 1.
  - In `result()`, map ffish's `"1-0"`, `"0-1"` and `"1/2-1/2"` strings, together with `isCheck()` and the presence of legal moves, to a `GameResult` reason.
  - `dispose()` calls `board.delete()`, because ffish objects are not garbage-collected.
- [ ] **Step 4:** Run `yarn test src/rules`. Expected: PASS. Commit.

### Task 4: Clock

**Files:**
- Create: `src/session/clock.ts`, `src/session/clock.test.ts`

**Interfaces:**
- Produces:
  - `type ClockConfig = { baseMs: number; incrementMs: number } | null`
  - `CLOCK_PRESETS: { label: string; config: ClockConfig }[]`
  - `interface ClockState { whiteMs: number; blackMs: number; running: Color|null; since: number|null }`
  - `startClock(cfg: ClockConfig, toMove: Color, now: number): ClockState`
  - `press(state: ClockState, cfg: ClockConfig, now: number): ClockState` (adds the increment to the mover, then switches)
  - `pause(state: ClockState, now: number): ClockState`
  - `resume(state: ClockState, toMove: Color, now: number): ClockState`
  - `remaining(state: ClockState, color: Color, now: number): number`
  - `flagged(state: ClockState, now: number): Color|null`

- [ ] **Step 1: Write the failing tests**

```ts
it('offers exactly the presets in the spec', () =>
  expect(CLOCK_PRESETS.map(p => p.label)).toEqual(['None','1+0','3+2','5+0','10+5','15+10']));
it('adds the increment to the player who just moved', () => {
  const s = press(startClock({ baseMs: 180000, incrementMs: 2000 }, 'white', 0), cfg32, 10000);
  expect(s.whiteMs).toBe(172000);
  expect(s.running).toBe('black');
});
it('flags from elapsed timestamps so a backgrounded tab still loses on time', () =>
  expect(flagged(startClock({ baseMs: 60000, incrementMs: 0 }, 'white', 0), 60001)).toBe('white'));
it('does not tick while paused, so the editor and dialogs cost no time', () => {
  const p = pause(startClock(cfg10, 'white', 0), 5000);
  expect(remaining(p, 'white', 999999)).toBe(595000);
});
```

- [ ] **Step 2:** Run `yarn test src/session/clock`. Expected: FAIL.
- [ ] **Step 3:** Implement the clock as pure functions. A `null` config means no clock: `remaining` returns `Infinity`, and `flagged` returns `null`.
- [ ] **Step 4:** Run `yarn test src/session/clock`. Expected: PASS. Commit.

### Task 5: Game session (moves, undo, results, engine request ids)

**Files:**
- Create: `src/session/session.ts`, `src/session/session.test.ts`

**Interfaces:**
- Consumes: `Rules` and `RulesGame` (Task 3), the clock functions (Task 4), `VariantInfo` (Task 2).
- Produces:
  - `type Opponent = { kind: 'hotseat' } | { kind: 'ai'; level: AiLevelId; aiColor: Color }`
  - `interface Snapshot { fen: string; clock: ClockState }`
  - `interface SessionState { variant: string; ini?: string; startFen: string; moves: string[]; snapshots: Snapshot[]; opponent: Opponent; clockConfig: ClockConfig; clock: ClockState; result: GameResult|null; engineRequestId: number }` (this is serializable)
  - `class GameSession` with:
    - `static create(rules: Rules, init: { variant: string; ini?: string; fen?: string; opponent: Opponent; clockConfig: ClockConfig }, now: number)`
    - `static restore(rules: Rules, s: SessionState)`
    - `state(): SessionState`
    - `legalMovesFrom(sq: string): string[]`
    - `isHumanTurn(): boolean`
    - `play(uci: string, now: number): void` (throws if the move is illegal or the game is over)
    - `undo(now: number): void`
    - `canUndo(): boolean`
    - `beginEngineRequest(): number`
    - `acceptEngineMove(requestId: number, uci: string, now: number): boolean`
    - `checkFlag(now: number): GameResult|null`
    - `pauseClock(now: number)`
    - `resumeClock(now: number)`
- `AiLevelId` comes from Task 6. Define it in `src/engine/levels.ts` as part of this task if Task 6 hasn't run yet.

- [ ] **Step 1: Write the failing tests**

```ts
describe('against the AI', () => {
  it('undo returns to the human turn by taking back the AI reply and the human move', () => {
    const s = vsAi('black'); s.play('e2e4', 0); s.acceptEngineMove(s.beginEngineRequest(), 'e7e5', 1);
    s.undo(2); expect(s.state().moves).toEqual([]); expect(s.isHumanTurn()).toBe(true);
  });
  it('throws away a bestmove that arrives after undo, so a stale search cannot corrupt the game', () => {
    const s = vsAi('black'); s.play('e2e4', 0); const id = s.beginEngineRequest(); s.undo(1);
    expect(s.acceptEngineMove(id, 'e7e5', 2)).toBe(false); expect(s.state().moves).toEqual([]);
  });
});
it('hot-seat undo takes back exactly one ply', () => {
  const s = hotseat(); s.play('e2e4', 0); s.play('e7e5', 1); s.undo(2); expect(s.state().moves).toEqual(['e2e4']);
});
it('restores both clock times from the snapshot when undoing', () => {
  const s = hotseat({ baseMs: 60000, incrementMs: 0 }); s.play('e2e4', 10000); s.play('e7e5', 25000); s.undo(30000);
  expect(s.state().clock).toMatchObject({ whiteMs: 50000, blackMs: 60000, running: 'black' });
});
it('scores a flag as a draw when the opponent cannot mate', () =>
  expect(sessionWithKingVsKingRook_blackFlags().checkFlag(BIG)).toEqual({ winner: null, reason: 'timeout-insufficient' }));
it('round-trips through state() and restore() so a reload resumes the same game', () => {
  const s = hotseat(); s.play('e2e4', 0);
  expect(GameSession.restore(rules, JSON.parse(JSON.stringify(s.state()))).state()).toEqual(s.state());
});
```

The helpers `vsAi` and `hotseat` build real sessions over the real `Rules`.

- [ ] **Step 2:** Run `yarn test src/session/session`. Expected: FAIL.
- [ ] **Step 3:** Implement `GameSession`.
  - `snapshots[i]` is the position and clock *before* ply `i`. Undo pops back to a snapshot.
  - Every `play`, `undo` and `create` bumps `engineRequestId`.
  - Undo against the AI pops plies until it's the human's turn, and never below 0.
  - Once `result` is set, `play` is rejected.
- [ ] **Step 4:** Run `yarn test src/session`. Expected: PASS. Commit.

### Task 6: Engine adapter

**Files:**
- Create: `src/engine/levels.ts`, `src/engine/uci.ts`, `src/engine/uci.test.ts`, `src/engine/levels.test.ts`, `src/engine/engine-worker.ts`, `src/engine/engine.ts`, `e2e/engine.spec.ts`

**Interfaces:**
- Consumes: Task 1's findings (how to load variants.ini, the package), `ClockState`.
- Produces:
  - `type AiLevelId = 'beginner'|'novice'|'intermediate'|'advanced'|'expert'|'max'`
  - `AI_LEVELS: { id: AiLevelId; label: string; elo: number|null; movetimeMs: number }[]`
  - `levelOptions(id: AiLevelId): string[]` (the `setoption` lines)
  - `goCommand(level: AiLevelId, clock: ClockState|null, now: number, cfg: ClockConfig): string`
  - `parseBestMove(line: string): string|null`
  - `interface Engine { ready: Promise<void>; status(): 'loading'|'ready'|'unavailable'; setVariant(name: string, ini?: string): Promise<void>; search(req: { fen: string; moves: string[]; level: AiLevelId; clock: ClockState|null; now: number }): Promise<string>; stop(): void; onLine(cb: (l: string) => void): void }`
  - `createEngine(): Engine`

- [ ] **Step 1: Write the failing unit tests**

```ts
it('limits strength for every named level and lifts it for Max', () => {
  expect(levelOptions('expert')).toEqual(['setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 2000']);
  expect(levelOptions('max')).toEqual(['setoption name UCI_LimitStrength value false']);
});
it('gives the AI its real clock when a timer runs', () =>
  expect(goCommand('expert', { whiteMs: 170000, blackMs: 180000, running: 'black', since: 0 }, 0, cfg32))
    .toBe('go wtime 170000 btime 180000 winc 2000 binc 2000'));
it('uses the level movetime when there is no clock', () =>
  expect(goCommand('beginner', null, 0, null)).toMatch(/^go movetime \d+$/));
it('reads the move from a bestmove line, including promotion and gating suffixes', () =>
  expect(parseBestMove('bestmove a9a10c ponder x')).toBe('a9a10c'));
```

Elo values come from Global Constraints. If Task 1 found a minimum Elo above 800, clamp to it and record that in `engine.md`.

- [ ] **Step 2:** Run `yarn test src/engine`. Expected: FAIL.
- [ ] **Step 3:** Implement `levels.ts` and `uci.ts` as pure modules. Then implement the worker and `createEngine`:
  - If `uciok` / `readyok` doesn't arrive within 15000 ms, the status becomes `'unavailable'`.
  - `search` sends the level options, then `position fen ... moves ...`, then `go`, and resolves on the first `bestmove`.
  - `stop()` sends `stop`. The caller throws away the result using the session's request id.
- [ ] **Step 4: Write the e2e test** `e2e/engine.spec.ts`. On the preview server, `createEngine()` must return a legal bestmove for every `CURATED_VARIANTS` entry at the `beginner` level, checked against `rules.newGame(...).legalMoves()`. Run `yarn test:e2e e2e/engine.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Run `yarn test src/engine`. Expected: PASS. Commit.

### Task 7: Persistence

**Files:**
- Create: `src/persistence/store.ts`, `src/persistence/store.test.ts`

**Interfaces:**
- Produces:
  - `type StoreKey = 'chess.game'|'chess.settings'|'chess.setups'|'chess.pieces'|'chess.tutorial'`
  - `createStore(storage: Storage | null): Store`
  - `interface Store { available: boolean; load<T>(key: StoreKey, version: number, migrations: Record<number, (old: unknown) => unknown>, validate: (d: unknown) => d is T): { data: T|null; problem: 'corrupt'|null }; save(key: StoreKey, version: number, data: unknown): boolean }`
  - `interface Settings { highlightLegal: boolean; boardTheme: string; pieceSet: string; sound: boolean }`
  - `DEFAULT_SETTINGS`

- [ ] **Step 1: Write the failing tests.** They use an in-memory `Storage` object.

```ts
it('moves unreadable saved data aside instead of crashing, and reports it', () => {
  mem.setItem('chess.game', '{not json');
  expect(store.load('chess.game', 1, {}, isState)).toEqual({ data: null, problem: 'corrupt' });
  expect(mem.getItem('chess.game.corrupt')).toBe('{not json');
});
it('runs migrations from an older version', () => {
  mem.setItem('chess.settings', JSON.stringify({ version: 1, data: { highlight: true } }));
  expect(store.load('chess.settings', 2, { 1: (o: any) => ({ highlightLegal: o.highlight }) }, isSettingsV2).data).toEqual({ highlightLegal: true });
});
it('treats an unknown future version as corrupt rather than guessing', () => {
  mem.setItem('chess.settings', JSON.stringify({ version: 99, data: {} }));
  expect(store.load('chess.settings', 2, {}, isSettingsV2).problem).toBe('corrupt');
});
it('reports unavailable storage so the UI can warn that progress will not save', () =>
  expect(createStore(null).available).toBe(false));
```

- [ ] **Step 2:** Run `yarn test src/persistence`. Expected: FAIL.
- [ ] **Step 3:** Implement the store. `save` catches `QuotaExceededError` and returns `false`.
- [ ] **Step 4:** Run `yarn test src/persistence`. Expected: PASS. Commit.

### Task 8: Board UI, panel, Play dialog and Settings (layout A)

**Files:**
- Create:
  - `src/ui/app.ts`: owns the `GameSession`, the `Engine` and the `Store`, and wires the events together
  - `src/ui/board-view.ts`: wraps chessgroundx
  - `src/ui/panel.ts`: clocks, move list, Undo, Edit (disabled), Settings, and the variant/opponent line
  - `src/ui/play-dialog.ts`: variant, opponent (AI level or hot-seat), color, clock preset or custom
  - `src/ui/choice-dialog.ts`: promotion and gating picker
  - `src/ui/settings-dialog.ts`
  - `src/ui/top-bar.ts`
  - `src/ui/styles.css`
  - `e2e/play.spec.ts`
- Modify: `src/main.ts`, `index.html`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: `startApp(root: HTMLElement): Promise<void>`

- [ ] **Step 1: Write the failing e2e tests** in `e2e/play.spec.ts`.

```ts
test('plays a move against the AI and gets a reply', async ({ page }) => { /* new game: chess, expert→beginner, white; e2e4; expect move list to have 2 plies */ });
test('undo against the AI returns to the human move with an empty move list', async ({ page }) => { /* ... */ });
test('offers every promotion piece in Grand instead of auto-queening', async ({ page }) => { /* hot-seat grand from FEN_GRAND_PAWN_ON_9TH via test hook; move pawn; expect choice dialog with >1 option */ });
test('offers Hawk, Elephant or nothing when a Seirawan back-rank piece first moves', async ({ page }) => { /* hot-seat seirawan; g1f3; expect choices H, E, none */ });
test('a reload during the AI turn resumes the AI search instead of hanging', async ({ page }) => { /* play e2e4, reload immediately, expect AI reply appears */ });
test('a reload restores the game with clocks paused at their saved times', async ({ page }) => { /* 5+0 hot-seat, play 2 moves, reload, clocks equal pre-reload values and not running until a move */ });
test('the AI side cannot be moved by the player while the AI is thinking', async ({ page }) => { /* ... */ });
test('hot-seat still works when the engine is unavailable', async ({ page }) => { /* route the engine wasm to 404; expect AI options disabled with message; hot-seat game playable */ });
```

Expose a test hook, `window.__chessTest = { loadFen(variant, fen) }`, only when `import.meta.env.MODE === 'test'`. Write each test body in full in this step; the comments above are the scenarios to cover.

- [ ] **Step 2:** Run `yarn test:e2e e2e/play.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the UI.
  - **Board:** chessgroundx gets its dimensions from `VariantInfo.files` and `ranks`, and its legal destinations from `legalMovesFrom`.
  - **Choices:** if the legal moves contain more than one UCI move for the same from and to squares (because of promotion or gating), open `choice-dialog`.
  - **Engine status:** while the engine is `'loading'`, the AI options in the Play dialog show "Engine loading…". When it's `'unavailable'`, they're disabled with a reason.
  - **Saving:** save `chess.game` after every state change.
  - **Loading:** restore it on load with the clock paused, and resume the clock on the next move. If it's the AI's turn after restoring, search straight away.
  - **Clock loop:** use `requestAnimationFrame` to redraw the clocks and call `checkFlag`.
  - **Storage problems:** show a banner when storage is unavailable or the saved game was corrupt.
- [ ] **Step 4:** Run `yarn test:e2e e2e/play.spec.ts`. Expected: PASS. Commit.

### Task 9: Piece art and lettered tokens

**Files:**
- Create: `public/pieces/<set>/…`, `public/pieces/LICENSE-<set>.txt`, `src/ui/pieces.css`, `src/ui/pieces.ts`, `src/ui/pieces.test.ts`, `ATTRIBUTION.md`

**Interfaces:**
- Produces: `pieceClass(letter: string, color: Color): string`, `hasArt(letter: string, variant: string): boolean`

- [ ] **Step 1: Write the failing test.** Every piece letter used by `CURATED_VARIANTS` either has art or falls back to a lettered token, and the fallback CSS class shows the letter.

```ts
it('gives every curated-variant piece either art or a visible lettered token', () => {
  for (const v of CURATED_VARIANTS) for (const l of pieceLettersOf(v)) expect(hasArt(l, v.id) || tokenClass(l)).toBeTruthy();
});
```

- [ ] **Step 2:** Run `yarn test src/ui/pieces`. Expected: FAIL.
- [ ] **Step 3:** Choose an open-source piece set with fairy pieces (pychess-variants or the chessgroundx-compatible sets). Use it only if its license allows redistribution on a public site. Copy its license and add attribution. Lettered tokens are drawn with CSS `::after { content: attr(data-letter) }`.
- [ ] **Step 4:** Run `yarn test src/ui/pieces`. Expected: PASS. Then `yarn test:e2e`. Expected: PASS. Commit.

### Task 10: Deploy to GitHub Pages

**Files:**
- Create: `.github/workflows/pages.yml`, `README.md` (how to run, build and deploy, plus the GPL-3.0 note)
- Create: `LICENSE` (GPL-3.0, because the site ships GPL-3.0 Fairy-Stockfish and ffish.js)

- [ ] **Step 1:** Write the workflow. On a push to `main`, it runs `yarn install --frozen-lockfile`, `yarn ts`, `yarn test`, and `yarn build`, then deploys `dist/` with `actions/upload-pages-artifact` and `actions/deploy-pages`.
- [ ] **Step 2:** Run `yarn ts && yarn test && yarn build && yarn test:e2e` locally. Expected: everything passes.
- [ ] **Step 3:** Commit. Squash the branch into one meaningful commit, then ask the owner to create the GitHub repo and enable Pages ("GitHub Actions" source) before pushing. *Pushing and creating the repo are the owner's actions.*
- [ ] **Step 4:** After the first deploy, open the Pages URL and confirm:
  - the page reloads once to become cross-origin isolated
  - an Expert game against the AI works
