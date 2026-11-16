// The piece designer's state: name, preferred letter, move components, combined built-in pieces, an advanced
// Betza override and art. Pure (no DOM): the view draws it, designer.ts previews and saves what it builds.
// It decides nothing about where the piece can move: the preview asks the rules library.
import type { DesignedPiece } from '../../persistence/pieces';
import { betzaProblem, buildBetza, CANNON_LEAPS, type Leap, MAX_PARTS, type MoveComponent, SLIDING_LEAPS } from '../../variants/betza';
import { BUILTIN_PIECES, type PieceType } from '../../variants/piece-types';

export const MAX_NAME = 30;

export const NAME_REQUIRED = 'Give the piece a name.';
export const NAME_TOO_LONG = `A name can be at most ${MAX_NAME} characters.`;
export const LETTER_INVALID = 'The letter must be one of a to z.';
export const NO_MOVES = 'Add at least one move.';
export const CANNOT_MOVE = 'This piece cannot move anywhere.';

/** Built-in pieces a design may add the moves of: those Betza can describe (not the pawn), and never a royal one. */
export const COMBINABLE: readonly PieceType[] = BUILTIN_PIECES.filter((p) => p.betza !== '' && !p.royal);

export const canSlide = (atom: Leap): boolean => SLIDING_LEAPS.includes(atom);
/** A cannon hops along a slide, and the engine only hops along W and F slides. */
export const canCannon = (c: Pick<MoveComponent, 'atom' | 'slide'>): boolean => c.slide && CANNON_LEAPS.includes(c.atom);

const STEP: MoveComponent = { atom: 'W', slide: false, range: null, mode: 'both' };

export type BetzaResult = { betza: string; problem: null } | { betza: null; problem: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class DesignerModel {
  /** The library id of the piece being edited; null for a new piece. */
  id: string | null = null;
  /** As typed: trimmed when checked and saved. */
  name = '';
  letter = 'z';
  components: MoveComponent[] = [];
  combineWith: string[] = [];
  /** Betza typed in the advanced box, used instead of the components; null to use the components. */
  advanced: string | null = null;
  /** An ART_CHOICES id, or null for a lettered token. */
  art: string | null = null;

  /** A new piece: a one-square orthogonal step, drawn as a token. */
  static create(): DesignerModel {
    const m = new DesignerModel();
    m.components = [{ ...STEP }];
    return m;
  }

  /** A library piece to edit. Only its Betza is stored, so it opens in the advanced box. */
  static fromPiece(p: DesignedPiece): DesignerModel {
    const m = new DesignerModel();
    m.id = p.id;
    m.name = p.name;
    m.letter = p.letter;
    m.advanced = p.betza;
    m.art = p.art;
    return m;
  }

  /** The moves and the pieces it also moves like fill the cap (MAX_PARTS, together): nothing more can be added. */
  atCap(): boolean {
    return this.components.length + this.combineWith.length >= MAX_PARTS;
  }

  /** Adds a step; false at the cap. */
  addComponent(): boolean {
    if (this.atCap()) return false;
    this.components.push({ ...STEP });
    return true;
  }

  removeComponent(i: number): void {
    this.components.splice(i, 1);
  }

  /**
   * Changes a component, keeping it one the engine plays: a leap that can't slide stops sliding, a step has
   * no range, and a cannon needs a W or F slide (otherwise it moves and captures normally).
   */
  updateComponent(i: number, patch: Partial<MoveComponent>): void {
    const c = this.components[i];
    if (!c) throw new Error(`No move ${i}`);
    const next: MoveComponent = { ...c, ...patch };
    if (!canSlide(next.atom)) next.slide = false;
    if (!next.slide) next.range = null;
    if (next.mode === 'cannon' && !canCannon(next)) next.mode = 'both';
    this.components[i] = next;
  }

  /** Adds or removes a piece to move like; false when adding one would pass the cap (nothing changes then). */
  setCombine(type: string, on: boolean): boolean {
    if (!COMBINABLE.some((p) => p.type === type)) throw new Error(`The ${type} can't be combined`);
    const rest = this.combineWith.filter((t) => t !== type);
    if (on && this.components.length + rest.length >= MAX_PARTS) return false;
    this.combineWith = on ? [...rest, type] : rest;
    return true;
  }

  setAdvanced(betza: string | null): void {
    this.advanced = betza;
  }

  /** The components' Betza (or the override), or why it can't be given to the engine. */
  betza(): BetzaResult {
    let betza: string;
    if (this.advanced !== null) betza = this.advanced;
    else {
      if (this.components.length === 0 && this.combineWith.length === 0) return { betza: null, problem: NO_MOVES };
      try {
        betza = buildBetza(this.components, this.combineWith);
      } catch (e) {
        return { betza: null, problem: message(e) };
      }
    }
    const problem = betzaProblem(betza);
    return problem === null ? { betza, problem: null } : { betza: null, problem };
  }

  /**
   * What stops the piece being saved, before the preview has had its say. Pass `result` when betza() was just
   * worked out, so it isn't built again.
   */
  problems(result: BetzaResult = this.betza()): string[] {
    const problems: string[] = [];
    const name = this.name.trim();
    if (name.length === 0) problems.push(NAME_REQUIRED);
    else if (name.length > MAX_NAME) problems.push(NAME_TOO_LONG);
    if (!/^[a-z]$/.test(this.letter)) problems.push(LETTER_INVALID);
    if (result.problem !== null) problems.push(result.problem);
    return problems;
  }

  /** The piece for the library. Throws while it has problems. Pass `result` when betza() was just worked out. */
  toPiece(id: string, savedAt: number, result: BetzaResult = this.betza()): DesignedPiece {
    const problems = this.problems(result);
    if (problems.length) throw new Error(problems.join(' '));
    return { id, name: this.name.trim(), letter: this.letter, betza: result.betza!, art: this.art, savedAt };
  }
}

/** The library with `piece` saved: replacing the entry with its id (in place), and never holding an id twice. */
export function upsertPiece(list: readonly DesignedPiece[], piece: DesignedPiece): DesignedPiece[] {
  const out: DesignedPiece[] = [];
  let placed = false;
  for (const p of list) {
    if (p.id !== piece.id) out.push(p);
    else if (!placed) {
      out.push(piece);
      placed = true;
    }
  }
  if (!placed) out.push(piece);
  return out;
}

/** The library as stored, with any repeated id dropped (the first entry wins), so each id names one piece. */
export function uniqueById(list: readonly DesignedPiece[]): DesignedPiece[] {
  const seen = new Set<string>();
  return list.filter((p) => !seen.has(p.id) && seen.add(p.id));
}
