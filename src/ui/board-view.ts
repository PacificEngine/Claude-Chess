// Wraps chessgroundx. It only draws positions and reports where the player dragged or clicked a piece:
// legality comes from the `legalFrom` callback (the rules adapter via the session), never from here.
import { Chessground } from 'chessgroundx';
import type { Api } from 'chessgroundx/api';
import type { Config } from 'chessgroundx/config';
import type * as cg from 'chessgroundx/types';
import type { Color } from '../rules/types';
import type { VariantInfo } from '../variants/catalog';
import { artUrl, parsePieceClass, tokenClass } from './pieces';

export interface BoardPosition {
  variant: VariantInfo;
  fen: string;
  turn: Color;
  orientation: Color;
  /** The side the player may move now, or null while nobody may (AI turn, game over). */
  movable: Color | null;
  /** UCI moves from a UCI square, e.g. legalFrom('e2') -> ['e2e4', 'e2e3']. */
  legalFrom: (square: string) => string[];
  lastMove: [string, string] | null;
  check: boolean;
  showDests: boolean;
}

export interface BoardView {
  /** Draws a position. Rebuilds the board when the variant (size, pockets) changes. */
  show(pos: BoardPosition): void;
  /** Called with UCI squares when the player moves a piece. The view does not apply the move itself. */
  onMove(cb: (from: string, to: string) => void): void;
}

// chessgroundx names rank 10 ':' (its ranks run '1'..'9', ':', ';', ...), so UCI squares are translated.
const CG_RANKS = '123456789:;<=>?@';
export const toKey = (square: string): cg.Key => {
  const rank = Number(square.slice(1));
  return `${square[0]}${CG_RANKS[rank - 1]}` as cg.Key;
};
export const fromKey = (key: string): string => `${key[0]}${CG_RANKS.indexOf(key[1]) + 1}`;

/** Splits a UCI move into squares and a suffix (promotion piece or Seirawan gating piece). */
export function parseUci(uci: string): { from: string; to: string; suffix: string } | null {
  const m = /^([a-p])(\d+)([a-p])(\d+)(.*)$/.exec(uci);
  return m ? { from: `${m[1]}${m[2]}`, to: `${m[3]}${m[4]}`, suffix: m[5] } : null;
}

// Pieces held in hand, shown as pockets beside the board.
const POCKET_ROLES: Partial<Record<string, cg.Role[]>> = {
  seirawan: ['h-piece', 'e-piece'],
};

/**
 * Gives every piece element its art (an inline background image) or, when the variant has none for it, the
 * lettered-token markup. chessgroundx owns the elements and rewrites their class when a piece changes (a
 * promotion), so this reruns on class changes; the pockets are in the host too.
 */
function observePieces(host: HTMLElement): void {
  const style = (piece: HTMLElement): void => {
    const parsed = parsePieceClass(piece.className);
    if (!parsed) return;
    const url = artUrl(parsed.letter, parsed.color, host.dataset.variant ?? '');
    piece.style.backgroundImage = url ? `url("${import.meta.env.BASE_URL}${url}")` : '';
    const token = tokenClass(parsed.letter).split(' ');
    // Touch the class only when it must change: a class write is itself a mutation this observer would see.
    const hasToken = token.every(c => piece.classList.contains(c));
    if (url && hasToken) piece.classList.remove(...token);
    if (!url && !hasToken) piece.classList.add(...token);
    if (url) piece.removeAttribute('data-letter');
    else piece.dataset.letter = parsed.letter.toUpperCase();
  };
  const all = (): void => host.querySelectorAll<HTMLElement>('piece').forEach(style);
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') style(r.target as HTMLElement);
      else all();
    }
  }).observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
}

export function createBoardView(host: HTMLElement): BoardView {
  host.dataset.testid = 'board';
  host.classList.add('board-host');
  observePieces(host);
  let api: Api | null = null;
  let builtFor: string | null = null;
  let moveListener: (from: string, to: string) => void = () => {};

  function build(pos: BoardPosition): void {
    api?.destroy();
    host.replaceChildren();
    const roles = POCKET_ROLES[pos.variant.id];
    const pocketTop = roles ? document.createElement('div') : undefined;
    const pocketBottom = roles ? document.createElement('div') : undefined;
    const wrap = document.createElement('div');
    wrap.className = 'board-wrap';
    host.append(...[pocketTop, wrap, pocketBottom].filter((el): el is HTMLDivElement => el !== undefined));
    const config: Config = {
      // The FEN must come with the build: the pockets are drawn from it immediately.
      fen: pos.fen,
      dimensions: { width: pos.variant.files, height: pos.variant.ranks },
      orientation: pos.orientation,
      coordinates: true,
      autoCastle: true,
      premovable: { enabled: false },
      drawable: { enabled: true },
      movable: { free: false, events: { after: (orig, dest) => moveListener(fromKey(orig), fromKey(dest)) } },
      ...(roles && { pocketRoles: { white: roles, black: roles } }),
    };
    api = Chessground(wrap, config, pocketTop, pocketBottom);
    builtFor = `${pos.variant.id}:${pos.orientation}`;
  }

  return {
    show(pos) {
      host.style.setProperty('--files', String(pos.variant.files));
      host.style.setProperty('--ranks', String(pos.variant.ranks));
      host.style.setProperty('--pocket-rows', POCKET_ROLES[pos.variant.id] ? '2' : '0');
      host.dataset.variant = pos.variant.id;
      host.dataset.files = String(pos.variant.files);
      host.dataset.ranks = String(pos.variant.ranks);
      host.dataset.orientation = pos.orientation;
      if (builtFor !== `${pos.variant.id}:${pos.orientation}`) build(pos);
      const board = api!;
      board.set({
        fen: pos.fen,
        turnColor: pos.turn,
        lastMove: pos.lastMove ? [toKey(pos.lastMove[0]), toKey(pos.lastMove[1])] : undefined,
        check: pos.check,
        movable: { color: pos.movable ?? undefined, dests: new Map(), showDests: pos.showDests },
      });
      if (pos.movable) {
        // Only the mover's own pieces can have moves, so ask the rules about those squares alone.
        const dests: cg.Dests = new Map();
        for (const [key, piece] of board.state.boardState.pieces) {
          if (piece.color !== pos.movable) continue;
          const targets = new Set<cg.Key>();
          for (const uci of pos.legalFrom(fromKey(key))) {
            const m = parseUci(uci);
            if (m) targets.add(toKey(m.to));
          }
          if (targets.size) dests.set(key, [...targets]);
        }
        board.set({ movable: { dests } });
      }
      // Set last: tests and the app treat data-fen as "the board now shows this position".
      host.dataset.fen = pos.fen;
    },
    onMove(cb) {
      moveListener = cb;
    },
  };
}
