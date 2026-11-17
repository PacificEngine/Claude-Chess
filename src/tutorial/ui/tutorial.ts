// The tutorial screen. It shows one of three pages: the lesson list; a lesson, with its board on the left and
// its panel on the right (layout A); or a variant page. In a lesson it shows each step and passes the player's
// moves to the runners, which decide what is legal and when a goal is met.
import type { Engine } from '../../engine/engine';
import type { Color, Rules } from '../../rules/types';
import { type BoardPosition, createBoardView, parseUci } from '../../ui/board-view';
import type { ChoiceDialog } from '../../ui/choice-dialog';
import { type ActiveVariant, curatedActive, customActive, variantTypes } from '../../variants/active';
import { type VariantId, variantById } from '../../variants/catalog';
import { generateVariant } from '../../variants/generator';
import { reachFrom } from '../../variants/reach';
import { registerSetup } from '../../variants/registry';
import type { SetupSpec } from '../../variants/setup';
import { LESSONS, lessonById, nextLessonOf, VARIANT_PAGES } from '../content';
import { boardFen, type Lesson, type LessonBoard } from '../lesson';
import type { TutorialProgress } from '../progress';
import { createPuzzleRun, createTryRun, type PuzzleRun, type TryRun } from '../runner';
import { createLessonList, TRACK_NAMES } from './lesson-list';
import { createLessonView, type StepState } from './lesson-view';
import { createVariantPage } from './variant-page';
import { type Cue, moveCue } from '../../ui/sound-cues';

export const MSG_WRONG = 'Not quite. Try again.';
export const MSG_SOLVED = 'Solved!';
const MSG_TRY_DONE = 'Well done.';
const MSG_LOADING = 'Getting the board ready…';
/** How long the player's right first move stays on the board before the written reply is played. */
const REPLY_DELAY_MS = 400;

export interface TutorialDeps {
  rules: Rules;
  engine: Engine | null;
  choiceDialog: ChoiceDialog;
  progress: TutorialProgress;
  playVariant(id: VariantId): void;
  close(): void;
  /** Plays a sound cue; the player decides in Settings whether it is heard. */
  sound(cue: Cue): void;
}

export interface Tutorial {
  /** Shows the lesson or variant page `id` from its start, or, without one, the lesson list. */
  open(id?: string): void;
  hide(): void;
  isOpen(): boolean;
}

/** A lesson board as the rules play it, or why it can't be shown. */
type Resolved = { ok: true; variant: ActiveVariant; fen: string } | { ok: false; problem: string };

const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

export function createTutorial(host: HTMLElement, deps: TutorialDeps): Tutorial {
  const { rules, engine, choiceDialog, progress } = deps;
  const section = document.createElement('section');
  section.className = 'tutorial';
  section.dataset.testid = 'tutorial';
  section.hidden = true;
  const lessonScreen = document.createElement('div');
  lessonScreen.className = 'layout';
  lessonScreen.dataset.testid = 'lesson';
  lessonScreen.hidden = true;
  const boardArea = document.createElement('div');
  boardArea.className = 'tutorial-board-area';
  const boardHost = document.createElement('div');
  const notice = document.createElement('p');
  notice.className = 'tutorial-notice';
  notice.dataset.testid = 'tutorial-notice';
  notice.hidden = true;
  boardArea.append(boardHost, notice);
  lessonScreen.append(boardArea);
  section.append(lessonScreen);
  host.append(section);
  const list = createLessonList(section, { open: (id) => open(id), back: () => deps.close() });
  const variantPage = createVariantPage(section, rules, { play: (id) => deps.playVariant(id), learn: (id) => open(id), all: () => showList() });
  const board = createBoardView(boardHost);
  boardHost.dataset.testid = 'tutorial-board';
  const view = createLessonView(lessonScreen, {
    step: (i) => showStep(i),
    hint: () => hint(),
    restart: () => restart(),
    next: () => next(),
    all: () => showList(),
  });

  let lesson: Lesson | null = null;
  let stepIndex = 0;
  /** The page of a read step. */
  let page = 0;
  let puzzleIndex = 0;
  /** Steps finished in this visit: See it and read steps once left with Next, Try it once every target is reached. */
  let done = new Set<number>();
  let feedback = '';
  /** The current board, once resolved; null while it loads or when the page has none. */
  let resolved: Resolved | null = null;
  let tryRun: TryRun | null = null;
  let puzzleRun: PuzzleRun | null = null;
  let puzzleSolved = false;
  /** The position after the player's right first move, shown until the written reply is played. */
  let beforeReply: { fen: string; move: [string, string] } | null = null;
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped whenever the screen moves on, so a board still loading or a reply still waiting is dropped. */
  let token = 0;
  const curated = new Map<VariantId, ActiveVariant>();

  const currentStep = () => lesson!.steps[stepIndex];

  /** Stops the current board: drops a pending reply and frees the puzzle's game. */
  function leaveBoard(): void {
    token++;
    clearTimeout(replyTimer);
    beforeReply = null;
    puzzleRun?.dispose();
    puzzleRun = null;
    tryRun = null;
    resolved = null;
    puzzleSolved = false;
    feedback = '';
  }

  async function resolve(lessonBoard: LessonBoard): Promise<Resolved> {
    if (!('setup' in lessonBoard)) {
      const id = lessonBoard.variant;
      if (!curated.has(id)) curated.set(id, curatedActive(id, rules));
      return { ok: true, variant: curated.get(id)!, fen: lessonBoard.fen };
    }
    const spec = lessonBoard.setup;
    // registerSetup needs a ready engine; a failed one is reported by registerSetup itself.
    await engine?.ready.catch(() => {});
    const registered = await registerSetup(rules, engine, spec);
    if (!registered.ok) return { ok: false, problem: registered.problems.join(' ') };
    const baseTypes = variantTypes(rules, variantById(spec.base).engineName);
    return { ok: true, variant: customActive(spec, registered.name, baseTypes), fen: boardFen(lessonBoard) };
  }

  /** Whether the setup's variant is loaded already, so its board shows without waiting for the engine. */
  function isRegistered(spec: SetupSpec): boolean {
    try {
      return rules.knows(generateVariant(spec, variantTypes(rules, variantById(spec.base).engineName)).name);
    } catch {
      return false; // registerSetup reports why
    }
  }

  /** The board the current step, page or puzzle is on, if any. */
  function boardOfView(): LessonBoard | undefined {
    const step = currentStep();
    switch (step.kind) {
      case 'see':
      case 'try':
        return step.board;
      case 'read':
        return step.pages[page].board;
      case 'puzzles':
        return step.puzzles[puzzleIndex].board;
    }
  }

  /** Loads the board of what is on screen now, then starts its run and draws it. */
  async function load(): Promise<void> {
    const lessonBoard = boardOfView();
    const t = token;
    renderPanel();
    if (!lessonBoard) return showBoard(null);
    if ('setup' in lessonBoard && !isRegistered(lessonBoard.setup)) showBoard(MSG_LOADING);
    const r = await resolve(lessonBoard);
    if (t !== token) return;
    resolved = r;
    if (!r.ok) {
      showBoard(r.problem);
      return renderPanel();
    }
    const step = currentStep();
    const name = r.variant.engineName;
    if (step.kind === 'try') {
      tryRun = createTryRun(rules, name, r.fen, step.square, step.targets);
    } else if (step.kind === 'puzzles') {
      puzzleRun = createPuzzleRun(rules, name, step.puzzles[puzzleIndex]);
    }
    showBoard();
    draw();
    renderPanel();
  }

  /** Shows the board, or hides it behind a notice; with null, shows neither (a page with no board). */
  function showBoard(message?: string | null): void {
    boardHost.hidden = message !== undefined;
    notice.hidden = !message;
    notice.textContent = message ?? '';
  }

  function reachMarks(name: string, fen: string, square: string): BoardPosition['marks'] {
    const { moves, captures } = reachFrom(rules, name, fen, square);
    return [...moves.map((s) => ({ square: s, kind: 'move' as const })), ...captures.map((s) => ({ square: s, kind: 'capture' as const }))];
  }

  function draw(): void {
    if (!resolved?.ok) return;
    const { variant } = resolved;
    const name = variant.engineName;
    const step = currentStep();
    const base = { variant, orientation: 'white' as Color, check: false, showDests: true, lastMove: null, movable: null, legalFrom: () => [] };
    let pos: BoardPosition;
    switch (step.kind) {
      case 'see':
        pos = { ...base, fen: resolved.fen, turn: turnOf(resolved.fen), marks: reachMarks(name, resolved.fen, step.square) };
        break;
      case 'read': {
        const p = step.pages[page];
        pos = { ...base, fen: resolved.fen, turn: turnOf(resolved.fen), marks: p.square ? reachMarks(name, resolved.fen, p.square) : [], arrows: p.arrows };
        break;
      }
      case 'try': {
        const run = tryRun!;
        const target = run.nextTarget();
        pos = {
          ...base,
          fen: run.fen(),
          turn: 'white',
          // Once every target is reached the step is over, and the piece stays where it is.
          movable: target ? 'white' : null,
          legalFrom: (sq) => run.legalFrom(sq),
          marks: target ? [{ square: target, kind: 'target' }] : [],
        };
        break;
      }
      case 'puzzles': {
        const run = puzzleRun!;
        const last = run.lastMove() ? parseUci(run.lastMove()!) : null;
        const fen = beforeReply?.fen ?? run.fen();
        pos = {
          ...base,
          fen,
          turn: turnOf(fen),
          movable: puzzleSolved || beforeReply ? null : 'white',
          legalFrom: (sq) => run.legalFrom(sq),
          lastMove: beforeReply?.move ?? (last ? [last.from, last.to] : null),
        };
        break;
      }
    }
    board.show(pos);
  }

  function stepState(i: number): StepState {
    const step = lesson!.steps[i];
    if (step.kind === 'puzzles' ? progress.isFinished(lesson!.id) : done.has(i)) return 'done';
    return i === stepIndex ? 'current' : 'todo';
  }

  function renderPanel(): void {
    const l = lesson!;
    const step = currentStep();
    let heading: string = step.title;
    let instruction = '';
    let canNext = stepIndex < l.steps.length - 1;
    switch (step.kind) {
      case 'see':
      case 'try':
        instruction = step.text;
        break;
      case 'read':
        if (step.pages.length > 1) heading = `${step.title} ${page + 1} of ${step.pages.length}`;
        instruction = step.pages[page].text;
        canNext ||= page < step.pages.length - 1;
        break;
      case 'puzzles':
        heading = `Puzzle ${puzzleIndex + 1} of ${step.puzzles.length}`;
        instruction = step.puzzles[puzzleIndex].prompt;
        canNext = puzzleIndex < step.puzzles.length - 1;
        break;
    }
    // Once the last puzzle is solved, Next moves on to the next lesson in the list, when there is one.
    const nextLesson = lessonAfter();
    if (nextLesson !== null) canNext = true;
    view.render({
      title: l.title,
      track: TRACK_NAMES[l.track],
      steps: l.steps.map((s, i) => ({ title: s.title, state: stepState(i) })),
      current: stepIndex,
      heading,
      instruction,
      feedback,
      canHint: step.kind === 'puzzles' && resolved?.ok === true && !puzzleSolved,
      canRestart: (step.kind === 'try' || step.kind === 'puzzles') && resolved?.ok === true,
      canNext,
      nextLabel: nextLesson === null ? 'Next' : 'Next lesson',
    });
  }

  /** The lesson Next opens: set only on the last step's last puzzle, once it is solved. */
  function lessonAfter(): string | null {
    const step = currentStep();
    const last = stepIndex === lesson!.steps.length - 1 && step.kind === 'puzzles' && puzzleIndex === step.puzzles.length - 1;
    return last && puzzleSolved ? nextLessonOf(LESSONS, lesson!.id) : null;
  }

  function showStep(i: number): void {
    leaveBoard();
    stepIndex = i;
    page = 0;
    const step = currentStep();
    if (step.kind === 'puzzles') {
      // A half-done lesson resumes at its first unsolved puzzle.
      const solved = progress.solved(lesson!.id);
      const unsolved = step.puzzles.findIndex((_, p) => !solved.includes(p));
      puzzleIndex = unsolved === -1 ? 0 : unsolved;
    }
    void load();
  }

  function next(): void {
    const nextLesson = lessonAfter();
    if (nextLesson !== null) return open(nextLesson);
    const step = currentStep();
    if (step.kind === 'read' && page < step.pages.length - 1) {
      leaveBoard();
      page++;
      return void load();
    }
    if (step.kind === 'puzzles') {
      if (puzzleIndex >= step.puzzles.length - 1) return;
      leaveBoard();
      puzzleIndex++;
      return void load();
    }
    if (step.kind === 'see' || step.kind === 'read') done.add(stepIndex);
    if (stepIndex < lesson!.steps.length - 1) showStep(stepIndex + 1);
  }

  function hint(): void {
    const step = currentStep();
    if (step.kind !== 'puzzles' || puzzleSolved) return;
    feedback = step.puzzles[puzzleIndex].hint;
    renderPanel();
  }

  function restart(): void {
    if (!resolved?.ok) return;
    token++;
    clearTimeout(replyTimer);
    beforeReply = null;
    feedback = '';
    tryRun?.restart();
    if (puzzleRun) {
      puzzleRun.restart();
      puzzleSolved = false;
    }
    draw();
    renderPanel();
  }

  /** The move the player means between two squares: asks when several share them (promotion or gating). */
  async function pick(legal: string[], to: string): Promise<string | null> {
    const candidates = legal.filter((uci) => parseUci(uci)?.to === to);
    if (candidates.length <= 1) return candidates[0] ?? null;
    const artBase = resolved?.ok ? resolved.variant.artBase : 'chess';
    const choices = candidates.map((uci) => ({ uci, suffix: parseUci(uci)!.suffix }));
    return choiceDialog.ask(artBase, artBase === 'seirawan' ? 'Bring in a piece from hand?' : 'Promote to', choices);
  }

  async function onMove(from: string, to: string): Promise<void> {
    const t = token;
    const step = currentStep();
    if (step.kind === 'try' && tryRun) {
      const run = tryRun;
      const uci = await pick(run.legalFrom(from), to);
      if (t !== token) return;
      const result = uci ? run.play(uci) : 'illegal';
      if (result !== 'illegal') deps.sound('move');
      if (result === 'done') {
        done.add(stepIndex);
        feedback = MSG_TRY_DONE;
      }
    } else if (step.kind === 'puzzles' && puzzleRun && resolved?.ok && !puzzleSolved && !beforeReply) {
      const run = puzzleRun;
      const variant = resolved.variant.engineName;
      const before = run.fen();
      const uci = await pick(run.legalFrom(from), to);
      if (t !== token) return;
      // A cancelled choice puts the piece back and is not a wrong move.
      if (uci) played(run, variant, before, uci, step.puzzles.length);
    }
    draw();
    renderPanel();
  }

  function played(run: PuzzleRun, variant: string, before: string, uci: string, count: number): void {
    const san = sanAt(variant, before, uci);
    const outcome = run.play(uci);
    if (outcome.result === 'wrong') {
      // Undone at once and flagged in the panel: no sound.
      feedback = MSG_WRONG;
    } else if (outcome.result === 'solved') {
      deps.sound('win');
      feedback = MSG_SOLVED;
      puzzleSolved = true;
      progress.markSolved(lesson!.id, puzzleIndex, count);
    } else {
      feedback = '';
      deps.sound(moveCue(san));
      const m = parseUci(uci)!;
      const after = positionAfter(variant, before, uci);
      const replySan = sanAt(variant, after, outcome.reply);
      beforeReply = { fen: after, move: [m.from, m.to] };
      const t = token;
      replyTimer = setTimeout(() => {
        if (t !== token) return;
        deps.sound(moveCue(replySan));
        beforeReply = null;
        draw();
      }, REPLY_DELAY_MS);
    }
  }

  /** The SAN of `uci` from `fen`, for its sound. */
  function sanAt(variant: string, fen: string, uci: string): string {
    const game = rules.newGame(variant, fen);
    try {
      return game.san(uci);
    } finally {
      game.dispose();
    }
  }

  /** The position after `uci`, only to draw it before the reply: the run has already played both moves. */
  function positionAfter(variant: string, fen: string, uci: string): string {
    const game = rules.newGame(variant, fen);
    try {
      game.push(uci);
      return game.fen();
    } finally {
      game.dispose();
    }
  }

  board.onMove((from, to) => void onMove(from, to));

  /** Shows one page of the tutorial: the list, a lesson's screen or a variant page. */
  function showPage(page: 'list' | 'lesson' | 'variant'): void {
    leaveBoard();
    section.hidden = false;
    lessonScreen.hidden = page !== 'lesson';
    if (page !== 'list') list.hide();
    if (page !== 'variant') variantPage.hide();
  }

  function showList(): void {
    showPage('list');
    list.show((id) => progress.isFinished(id));
  }

  function open(id?: string): void {
    if (id === undefined) return showList();
    const variant = VARIANT_PAGES.find((p) => p.id === id);
    if (variant) {
      showPage('variant');
      variantPage.show(variant);
      // A variant page counts as finished once opened.
      progress.markFinished(variant.id);
      return;
    }
    const next = lessonById(id);
    if (!next) throw new Error(`No lesson or variant page has the id ${id}`);
    if (next !== lesson) done = new Set();
    lesson = next;
    showPage('lesson');
    showStep(0);
  }

  return {
    open,
    hide() {
      leaveBoard();
      section.hidden = true;
    },
    isOpen: () => !section.hidden,
  };
}
