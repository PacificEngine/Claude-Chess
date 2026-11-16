// Turns piece-designer components into Betza move notation for the engine, and checks Betza typed by hand
// before it reaches a variant definition. Pure: no DOM, UI or engine imports.
import { pieceTypeByName } from './piece-types';

/** The leap atoms the designer offers. A slide repeats the leap along its line. */
export type Leap = 'W' | 'F' | 'D' | 'N' | 'A' | 'H' | 'C' | 'Z' | 'G';

export const LEAPS: { atom: Leap; label: string }[] = [
  { atom: 'W', label: '1 square orthogonally' },
  { atom: 'F', label: '1 square diagonally' },
  { atom: 'D', label: '2 squares orthogonally' },
  { atom: 'N', label: 'Knight jump (1,2)' },
  { atom: 'A', label: '2 squares diagonally' },
  { atom: 'H', label: '3 squares orthogonally' },
  { atom: 'C', label: 'Camel jump (1,3)' },
  { atom: 'Z', label: 'Zebra jump (2,3)' },
  { atom: 'G', label: '3 squares diagonally' },
];

/**
 * The leaps the engine can slide. Fairy-Stockfish rides only its sliders (W, F) and the nightrider (N):
 * "DD", "AA", "HH", "CC", "ZZ", "GG" and their ranged forms load but never move.
 */
export const SLIDING_LEAPS: readonly Leap[] = ['W', 'F', 'N'];

/** The slides the engine can hop along as a cannon. A hopping nightrider ("mNNcpNN") never captures. */
export const CANNON_LEAPS: readonly Leap[] = ['W', 'F'];

/** `cannon` moves like the slide and captures only by hopping over one piece (the screen) along it. */
export type Mode = 'both' | 'move' | 'capture' | 'cannon';

export interface MoveComponent {
  atom: Leap;
  slide: boolean;
  /** The most squares a slide may go. `null` means unlimited. Only applies when `slide` is true. */
  range: number | null;
  mode: Mode;
}

export const UNSAFE_BETZA = 'This move description uses characters the engine does not accept.';
export const J_UNSUPPORTED = 'The "j" modifier is not supported by the engine.';
export const BETZA_EMPTY = 'Type a Betza move description.';
export const MAX_BETZA = 40;
export const BETZA_TOO_LONG = `This move description is too long (at most ${MAX_BETZA} characters).`;

const SAFE_BETZA = /^[A-Za-z0-9]+$/;

/**
 * The most moves and combined pieces one design may have, together. Ordering the parts (joinParts) searches
 * their orders, which grows exponentially with their number: at 8 it takes milliseconds; at 13 it took
 * minutes on the main thread.
 */
export const MAX_PARTS = 8;
export const TOO_MANY_PARTS = `A piece can have at most ${MAX_PARTS} moves and pieces to move like, together.`;

/**
 * The components' Betza followed by each combined built-in's. Throws when a component can't be written in
 * Betza the engine reads, or a built-in's moves can't be described by Betza (its `betza` is '').
 * The result can still fail `betzaProblem` (for example by passing 40 characters), so check it before use.
 */
export function buildBetza(components: MoveComponent[], combineWith: string[]): string {
  if (components.length + combineWith.length > MAX_PARTS) throw new Error(TOO_MANY_PARTS);
  const parts = components.map(componentBetza);
  for (const type of combineWith) {
    const piece = pieceTypeByName(type);
    if (piece.betza === '') {
      throw new Error(`The ${piece.name} can't be combined: the engine plays it with rules Betza can't describe.`);
    }
    parts.push(piece.betza);
  }
  return joinParts(parts);
}

/**
 * Joins Betza parts so none changes meaning. An atom followed by the same atom is a slide ("N" + "N" is the
 * nightrider "NN"), so exact duplicates are dropped and the rest are ordered so that no part ending in an
 * atom is followed by one starting with that atom. Throws when no such order exists.
 */
function joinParts(parts: string[]): string {
  const unique = [...new Set(parts)];
  const clashes = (before: string, after: string) => before.at(-1) === after[0] && /[A-Z]/.test(after[0]);
  const order: number[] = [];
  // Whether the rest can be placed depends only on which parts are placed and which came last, so a state
  // that failed once is never searched again: at most 2^n × n states, not n! orders.
  const failed = new Set<number>();
  const place = (used: number): boolean => {
    if (order.length === unique.length) return true;
    const last = order.at(-1);
    const state = used * (unique.length + 1) + (last ?? unique.length);
    if (failed.has(state)) return false;
    for (let i = 0; i < unique.length; i++) {
      if (used & (1 << i) || (last !== undefined && clashes(unique[last], unique[i]))) continue;
      order.push(i);
      if (place(used | (1 << i))) return true;
      order.pop();
    }
    failed.add(state);
    return false;
  };
  if (!place(0)) {
    throw new Error(`These moves can't be written in any order without one changing another: ${unique.join(', ')}.`);
  }
  return order.map((i) => unique[i]).join('');
}

function componentBetza(c: MoveComponent): string {
  let body: string = c.atom;
  if (c.slide) {
    if (!SLIDING_LEAPS.includes(c.atom)) throw new Error(`The engine can't slide the "${label(c.atom)}" leap.`);
    // Fairy-Stockfish reads a single digit after the atom as the range, so only 1 to 9 can be said.
    if (c.range !== null && !(Number.isInteger(c.range) && c.range >= 1 && c.range <= 9)) {
      throw new Error(`A slide's range must be a whole number from 1 to 9, not ${c.range}.`);
    }
    body = c.range === null ? c.atom + c.atom : c.atom + String(c.range);
  }
  switch (c.mode) {
    case 'both':
      return body;
    case 'move':
      return `m${body}`;
    case 'capture':
      return `c${body}`;
    case 'cannon':
      if (!c.slide) throw new Error('A cannon move must slide: it hops over a piece along its line.');
      if (!CANNON_LEAPS.includes(c.atom)) throw new Error(`The engine can't hop a cannon along the "${label(c.atom)}" slide.`);
      return `m${body}cp${body}`;
  }
}

const label = (atom: Leap) => LEAPS.find((l) => l.atom === atom)?.label ?? atom;

/** Why the engine must not be given this Betza, or null when it's safe. The engine's `check` judges the rest. */
export function betzaProblem(betza: string): string | null {
  // The engine silently ignores j, so the piece would move differently from what was described. This is
  // checked first so the more specific reason wins.
  if (betza === '') return BETZA_EMPTY;
  if (betza.includes('j')) return J_UNSUPPORTED;
  if (!SAFE_BETZA.test(betza)) return UNSAFE_BETZA;
  if (betza.length > MAX_BETZA) return BETZA_TOO_LONG;
  return null;
}
