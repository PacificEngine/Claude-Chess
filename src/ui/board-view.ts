// Wraps chessgroundx. It only draws positions and reports where the player dragged or clicked a piece:
// legality comes from the `legalFrom` and `legalDrops` callbacks (the rules adapter via the session), never from here.
import { Chessground } from 'chessgroundx';
import type { Api } from 'chessgroundx/api';
import type { Config } from 'chessgroundx/config';
import type * as cg from 'chessgroundx/types';
import type { Color } from '../rules/types';
import { type ActiveVariant, artTypeOf, designedArt } from '../variants/active';
import { parseUci, type UciMove } from '../variants/fen';
import { currentPieceSet, onPieceSetChange } from './piece-sets';
import { artUrl, facingUrl, parsePieceClass, pocketRoles, promotedArtUrl, promotedMark, promotedMarkClass, tokenClass } from './pieces';

export interface BoardPosition {
  variant: ActiveVariant;
  fen: string;
  turn: Color;
  orientation: Color;
  /** The side the player may move now, or null while nobody may (AI turn, game over). */
  movable: Color | null;
  /** UCI moves from a UCI square, e.g. legalFrom('e2') -> ['e2e4', 'e2e3']. */
  legalFrom: (square: string) => string[];
  /** UCI drops of a piece in hand, by its letter, e.g. legalDrops('b') -> ['B@a1', ...]. None without it. */
  legalDrops?: (letter: string) => string[];
  /** The last move's squares, from `moveSquares`: [from, to], or [to] for a drop. */
  lastMove: string[] | null;
  check: boolean;
  showDests: boolean;
  /** Squares to mark (a lesson's highlights), each with what it marks. */
  marks?: { square: string; kind: 'move' | 'capture' | 'target' }[];
  /** Arrows from one UCI square to another. */
  arrows?: [string, string][];
}

export interface BoardView {
  /** Draws a position. Rebuilds the board when the variant (size, pockets) changes. */
  show(pos: BoardPosition): void;
  /** Called with UCI squares when the player moves a piece. The view does not apply the move itself. */
  onMove(cb: (from: string, to: string) => void): void;
  /** Called with the dropped piece's letter (uppercase, as in UCI) and the UCI square it was dropped on. */
  onDrop(cb: (letter: string, to: string) => void): void;
}

// chessgroundx names rank 10 ':' (its ranks run '1'..'9', ':', ';', ...), so UCI squares are translated.
const CG_RANKS = '123456789:;<=>?@';
export const toKey = (square: string): cg.Key => {
  const rank = Number(square.slice(1));
  return `${square[0]}${CG_RANKS[rank - 1]}` as cg.Key;
};
export const fromKey = (key: string): string => `${key[0]}${CG_RANKS.indexOf(key[1]) + 1}`;

// The UCI parser lives with the rules-side helpers; it's re-exported here for the views that already use it.
export { parseUci };

/** The squares to highlight for a move: from and to, or only the to-square for a drop. */
export const moveSquares = (m: UciMove): string[] => (m.from ? [m.from, m.to] : [m.to]);

/**
 * Gives every piece element its art (an inline background image) or, when the variant has none for it, the
 * lettered-token markup. chessgroundx owns the elements and rewrites their class when a piece changes (a
 * promotion), so this reruns on class changes; the pockets are in the host too.
 */
export function observePieces(host: HTMLElement, variant: () => ActiveVariant | null): void {
  const style = (piece: HTMLElement): void => {
    const parsed = parsePieceClass(piece.className);
    if (!parsed) return;
    const v = variant();
    if (!v) return;
    const own = parsed.promoted
      ? promotedArtUrl(parsed.letter, parsed.color, v.artBase)
      : artUrl(parsed.letter, parsed.color, v.artBase, artTypeOf(v, parsed.letter), designedArt(v, parsed.letter), currentPieceSet());
    // chessgroundx marks the side at the bottom `ally` and the other `enemy`, on the board and in the pockets.
    const side = piece.classList.contains('ally') ? 'ally' : piece.classList.contains('enemy') ? 'enemy' : null;
    const url = own && facingUrl(own, parsed.color, side);
    piece.style.backgroundImage = url ? `url("${import.meta.env.BASE_URL}${url}")` : '';
    const mark = parsed.promoted && url !== null && promotedMark(parsed.letter, v.artBase);
    if (piece.classList.contains(promotedMarkClass) !== mark) piece.classList.toggle(promotedMarkClass, mark);
    const token = tokenClass(parsed.letter).split(' ');
    // Touch the class only when it must change: a class write is itself a mutation this observer would see.
    const hasToken = token.every(c => piece.classList.contains(c));
    if (url && hasToken) piece.classList.remove(...token);
    if (!url && !hasToken) piece.classList.add(...token);
    if (url) piece.removeAttribute('data-letter');
    else piece.dataset.letter = `${parsed.promoted ? '+' : ''}${parsed.letter.toUpperCase()}`;
  };
  const all = (): void => host.querySelectorAll<HTMLElement>('piece').forEach(style);
  // A new piece set in Settings redraws this board's pieces, whether it is on screen or not.
  onPieceSetChange(all);
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
  let current: ActiveVariant | null = null;
  observePieces(host, () => current);
  let api: Api | null = null;
  let builtFor: string | null = null;
  let moveListener: (from: string, to: string) => void = () => {};
  let dropListener: (letter: string, to: string) => void = () => {};
  // chessgroundx 10.7 has no custom square highlights, so marks are drawn in an overlay over the squares,
  // styled like the designer's reach preview.
  const markLayer = document.createElement('div');
  markLayer.className = 'reach-layer board-marks';
  markLayer.setAttribute('aria-hidden', 'true');

  function drawMarks(pos: BoardPosition): void {
    const flipped = pos.orientation === 'black';
    markLayer.replaceChildren(
      ...(pos.marks ?? []).map(({ square, kind }) => {
        const mark = document.createElement('span');
        mark.className = `reach-square board-mark ${kind}`;
        mark.dataset.square = square;
        const file = square.charCodeAt(0) - 97;
        const rank = Number(square.slice(1)) - 1;
        const col = flipped ? pos.variant.files - 1 - file : file;
        const row = flipped ? rank : pos.variant.ranks - 1 - rank;
        mark.style.left = `${(col * 100) / pos.variant.files}%`;
        mark.style.top = `${(row * 100) / pos.variant.ranks}%`;
        return mark;
      }),
    );
  }

  function build(pos: BoardPosition): void {
    api?.destroy();
    host.replaceChildren();
    const roles = pocketRoles(pos.variant);
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
      movable: {
        free: false,
        events: {
          after: (orig, dest) => moveListener(fromKey(orig), fromKey(dest)),
          afterNewPiece: (piece, dest) => dropListener(piece.role[0]!.toUpperCase(), fromKey(dest)),
        },
      },
      ...(roles && { pocketRoles: { white: roles, black: roles } }),
    };
    api = Chessground(wrap, config, pocketTop, pocketBottom);
    wrap.append(markLayer);
    builtFor = `${pos.variant.engineName}:${pos.orientation}`;
  }

  return {
    show(pos) {
      host.style.setProperty('--files', String(pos.variant.files));
      host.style.setProperty('--ranks', String(pos.variant.ranks));
      host.style.setProperty('--pocket-rows', pocketRoles(pos.variant) ? '2' : '0');
      current = pos.variant;
      host.dataset.variant = pos.variant.engineName;
      host.dataset.files = String(pos.variant.files);
      host.dataset.ranks = String(pos.variant.ranks);
      host.dataset.orientation = pos.orientation;
      if (builtFor !== `${pos.variant.engineName}:${pos.orientation}`) build(pos);
      const board = api!;
      board.set({
        fen: pos.fen,
        turnColor: pos.turn,
        lastMove: pos.lastMove?.map(toKey),
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
        // A piece in hand may go only where the rules allow its drops: chessgroundx keys those `P@`.
        for (const role of pos.legalDrops ? (pocketRoles(pos.variant) ?? []) : []) {
          const letter = role[0]!.toUpperCase();
          const targets = pos.legalDrops!(letter).flatMap((uci) => {
            const m = parseUci(uci);
            return m && m.drop === letter ? [toKey(m.to)] : [];
          });
          if (targets.length) dests.set(`${letter}@` as cg.DropOrig, targets);
        }
        board.set({ movable: { dests } });
      }
      board.setAutoShapes((pos.arrows ?? []).map(([from, to]) => ({ orig: toKey(from), dest: toKey(to), brush: 'green' })));
      drawMarks(pos);
      // Set last: tests and the app treat data-fen as "the board now shows this position".
      host.dataset.fen = pos.fen;
    },
    onMove(cb) {
      moveListener = cb;
    },
    onDrop(cb) {
      dropListener = cb;
    },
  };
}
