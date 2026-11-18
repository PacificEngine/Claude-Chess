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
  /** The last move's squares, from `moveSquares`: [from, to], or [to] for a drop, then a duck's square. */
  lastMove: string[] | null;
  check: boolean;
  showDests: boolean;
  /** Squares to mark (a lesson's highlights), each with what it marks. */
  marks?: { square: string; kind: 'move' | 'capture' | 'target' }[];
  /** Arrows from one UCI square to another. */
  arrows?: [string, string][];
  /**
   * Duck Chess's second step: the piece has moved and a duck must follow. Every duck on the board lights up and
   * may move, onto `squares` only (from the rules' candidates); with `fromHand` the duck has not come on yet, so it
   * waits lit up beside the board and is dragged on. `movable` is still the mover, who may move only the ducks.
   */
  duckStep?: { squares: string[]; fromHand: boolean } | null;
  /**
   * Keeps the row beside the board where a duck waits before it comes on, for the whole game, so the board is
   * sized to leave room for it and nothing moves when it comes and goes.
   */
  duckTray?: boolean;
}

export interface BoardView {
  /** Draws a position. Rebuilds the board when the variant (size, pockets) changes. */
  show(pos: BoardPosition): void;
  /** Called with UCI squares when the player moves a piece. The view does not apply the move itself. */
  onMove(cb: (from: string, to: string) => void): void;
  /** Called with the dropped piece's letter (uppercase, as in UCI) and the UCI square it was dropped on. */
  onDrop(cb: (letter: string, to: string) => void): void;
  /** Called with the UCI square the player clicks or starts to drag from, whatever is on it. */
  onSelect(cb: (square: string) => void): void;
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

/** The squares to highlight for a move: from and to, or only the to-square for a drop, and where a duck went. */
export const moveSquares = (m: UciMove): string[] => [...(m.from ? [m.from, m.to] : [m.to]), ...(m.duck ? [m.duck] : [])];

/**
 * Gives every piece element its art (an inline background image) or, when the variant has none for it, the
 * lettered-token markup. chessgroundx owns the elements and rewrites their class when a piece changes (a
 * promotion), so this reruns on class changes; the pockets are in the host too.
 */
export function observePieces(
  host: HTMLElement,
  variant: () => ActiveVariant | null,
  decorate?: (piece: HTMLElement, letter: string) => void,
): () => void {
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
    decorate?.(piece, parsed.letter);
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
  return all;
}

/** The class that lights up a duck the player may move now. */
const DUCK_LIT = 'duck-lit';
/** The duck as chessgroundx holds it: the FEN's `*` is role `_-piece`, always Black's, with drop origin `*@`. */
const DUCK: cg.Piece = { role: '_-piece' as cg.Role, color: 'black' };

export function createBoardView(host: HTMLElement): BoardView {
  host.dataset.testid = 'board';
  host.classList.add('board-host');
  let current: ActiveVariant | null = null;
  /** The duck step on show, or null. */
  let duckStep: BoardPosition['duckStep'] = null;
  // chessgroundx makes and reuses the piece elements on its own schedule, so the light goes on as each is styled.
  const restyle = observePieces(
    host,
    () => current,
    (piece, letter) => {
      const lit = letter === '*' && duckStep !== null;
      if (piece.classList.contains(DUCK_LIT) !== lit) piece.classList.toggle(DUCK_LIT, lit);
    },
  );
  let api: Api | null = null;
  let builtFor: string | null = null;
  let moveListener: (from: string, to: string) => void = () => {};
  let dropListener: (letter: string, to: string) => void = () => {};
  let selectListener: (square: string) => void = () => {};
  /** The duck beside the board was clicked: the next click on one of its squares puts it there. */
  let trayArmed = false;
  let showDests = true;
  let lastPos: BoardPosition | null = null;
  // chessgroundx 10.7 has no custom square highlights, so marks are drawn in an overlay over the squares,
  // styled like the designer's reach preview.
  const markLayer = document.createElement('div');
  markLayer.className = 'reach-layer board-marks';
  markLayer.setAttribute('aria-hidden', 'true');

  function drawMarks(pos: BoardPosition): void {
    const flipped = pos.orientation === 'black';
    // chessgroundx shows no destinations for a piece from off the board, so the clicked duck's are marked here.
    const armed = trayArmed && showDests ? (duckStep?.squares ?? []).map((square) => ({ square, kind: 'move' as const })) : [];
    markLayer.replaceChildren(
      ...[...(pos.marks ?? []), ...armed].map(({ square, kind }) => {
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
          afterNewPiece: (piece, dest) =>
            dropListener(piece.role === DUCK.role ? '*' : piece.role[0]!.toUpperCase(), fromKey(dest)),
        },
      },
      events: { select: (key) => onSquare(fromKey(key)) },
      ...(roles && { pocketRoles: { white: roles, black: roles } }),
    };
    api = Chessground(wrap, config, pocketTop, pocketBottom);
    wrap.append(markLayer);
    host.append(tray);
    builtFor = `${pos.variant.engineName}:${pos.orientation}`;
  }

  // The duck waiting beside the board before it first comes on. It is dragged on (chessgroundx's dragNewPiece,
  // offered only the duck's squares as the drop origin `*@`), or clicked and then put on a square.
  const tray = document.createElement('div');
  tray.className = 'duck-tray';
  tray.dataset.testid = 'duck-tray';
  tray.hidden = true;
  const traySquare = document.createElement('square');
  const trayPiece = document.createElement('piece');
  trayPiece.className = `${DUCK.role} ${DUCK.color}`;
  traySquare.append(trayPiece);
  tray.append(traySquare);
  for (const type of ['mousedown', 'touchstart'] as const) {
    trayPiece.addEventListener(
      type,
      (e) => {
        if (!api || !duckStep?.fromHand || (e instanceof MouseEvent && e.button !== 0)) return;
        e.preventDefault();
        api.dragNewPiece(DUCK, false, e);
      },
      { passive: false },
    );
  }
  trayPiece.addEventListener('click', () => {
    if (!duckStep?.fromHand) return;
    setArmed(!trayArmed);
  });
  // touchstart's preventDefault (which keeps the page from scrolling under a drag) also stops the click, so a tap
  // is a touch that ends where it began, on the duck.
  trayPiece.addEventListener('touchend', (e) => {
    const touch = e.changedTouches[0];
    if (!duckStep?.fromHand || !touch) return;
    const r = trayPiece.getBoundingClientRect();
    const onDuck = touch.clientX >= r.left && touch.clientX <= r.right && touch.clientY >= r.top && touch.clientY <= r.bottom;
    if (onDuck) setArmed(!trayArmed);
  });

  function setArmed(armed: boolean): void {
    trayArmed = armed;
    traySquare.classList.toggle('selected-square', armed);
    if (lastPos) drawMarks(lastPos);
  }

  function onSquare(square: string): void {
    if (trayArmed) {
      setArmed(false);
      if (duckStep?.squares.includes(square)) return dropListener('*', square);
    }
    selectListener(square);
  }

  return {
    show(pos) {
      host.style.setProperty('--files', String(pos.variant.files));
      host.style.setProperty('--ranks', String(pos.variant.ranks));
      host.style.setProperty('--pocket-rows', String((pocketRoles(pos.variant) ? 2 : 0) + (pos.duckTray ? 1 : 0)));
      current = pos.variant;
      host.dataset.variant = pos.variant.engineName;
      host.dataset.files = String(pos.variant.files);
      host.dataset.ranks = String(pos.variant.ranks);
      host.dataset.orientation = pos.orientation;
      if (builtFor !== `${pos.variant.engineName}:${pos.orientation}`) build(pos);
      const board = api!;
      lastPos = pos;
      showDests = pos.showDests;
      const wasLit = duckStep !== null;
      duckStep = pos.movable ? (pos.duckStep ?? null) : null;
      trayArmed = false;
      traySquare.classList.remove('selected-square');
      tray.hidden = !pos.duckTray && !duckStep?.fromHand;
      // An empty reserved row keeps its room: only the duck waiting in it is shown.
      tray.dataset.waiting = String(!!duckStep?.fromHand);
      if (duckStep) host.dataset.duckStep = 'true';
      else delete host.dataset.duckStep;
      board.set({
        fen: pos.fen,
        turnColor: pos.turn,
        lastMove: pos.lastMove?.map(toKey),
        check: pos.check,
        // The duck is always Black's to chessgroundx, so on its step either colour may move, and only it has squares.
        movable: { color: duckStep ? 'both' : (pos.movable ?? undefined), dests: new Map(), showDests: pos.showDests },
      });
      if (duckStep) {
        const dests: cg.Dests = new Map();
        const targets = duckStep.squares.map(toKey);
        for (const [key, piece] of board.state.boardState.pieces) {
          if (piece.role === DUCK.role) dests.set(key, targets.filter((t) => t !== key));
        }
        if (duckStep.fromHand) dests.set('*@' as cg.DropOrig, targets);
        board.set({ movable: { dests } });
      } else if (pos.movable) {
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
      // The ducks already drawn light up or go dark; ones chessgroundx draws later are styled as they appear.
      if (wasLit !== (duckStep !== null)) restyle();
      // Set last: tests and the app treat data-fen as "the board now shows this position".
      host.dataset.fen = pos.fen;
    },
    onMove(cb) {
      moveListener = cb;
    },
    onDrop(cb) {
      dropListener = cb;
    },
    onSelect(cb) {
      selectListener = cb;
    },
  };
}
