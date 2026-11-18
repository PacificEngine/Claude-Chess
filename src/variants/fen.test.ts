import { describe, expect, it } from 'vitest';
import { buildFen, parseFen, parseUci, uciSquares } from './fen';

describe('parseUci', () => {
  it('reads a board move, a promotion letter and a Seirawan gating letter', () => {
    expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4', suffix: '', drop: null, duck: null });
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', suffix: 'q', drop: null, duck: null });
    expect(parseUci('a10a9')).toEqual({ from: 'a10', to: 'a9', suffix: '', drop: null, duck: null });
  });

  it('parseUci reads a drop and a + promotion', () => {
    expect(parseUci('B@a2')).toEqual({ from: null, to: 'a2', suffix: '', drop: 'B', duck: null });
    expect(parseUci('b2h8+')).toEqual({ from: 'b2', to: 'h8', suffix: '+', drop: null, duck: null });
  });

  // Duck Chess: the piece's move, then the duck's part, whose "from" is where the piece landed.
  it("reads a Duck Chess move's duck square from the part after the comma, and the piece's move as usual", () => {
    expect(parseUci('e7e5,e5a3')).toEqual({ from: 'e7', to: 'e5', suffix: '', drop: null, duck: 'a3' });
    expect(parseUci('e7e8q,e8d5')).toEqual({ from: 'e7', to: 'e8', suffix: 'q', drop: null, duck: 'd5' });
  });

  it('refuses text that is not a move', () => {
    expect(parseUci('nonsense')).toBeNull();
    expect(parseUci('e7e5,')).toBeNull();
    expect(parseUci('e7e5,nonsense')).toBeNull();
  });
});

describe('uciSquares', () => {
  it('splits a drop into no from-square and its to-square', () => expect(uciSquares('P@e5')).toEqual({ from: null, to: 'e5' }));
  it('ignores a + promotion', () => expect(uciSquares('b2h8+')).toEqual({ from: 'b2', to: 'h8' }));
  it("gives a Duck Chess move's piece squares, not the duck's", () => expect(uciSquares('e7e5,e5a3')).toEqual({ from: 'e7', to: 'e5' }));
});

describe('parseFen', () => {
  it("reads the Duck Chess duck '*' as a piece on its square, so the rows keep their width, and buildFen writes it back", () => {
    const fen = 'rnbqkbnr/pppppppp/8/3*4/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    const p = parseFen(fen);
    expect(p).toMatchObject({ files: 8, ranks: 8 });
    expect(p.squares.get(3 + 4 * 8)).toBe('*');
    expect(p.squares.get(4 + 3 * 8)).toBe('P');
    expect(buildFen(p, 'b KQkq - 0 1')).toBe(fen);
  });

  it("notes a Shogi '+' piece as promoted, keeping its own letter on the square, and buildFen writes it back", () => {
    const fen = '4k4/9/9/9/4+P4/9/9/1+r7/4K4[Gp] w - - 0 1';
    const p = parseFen(fen);
    expect(p.squares.get(4 + 4 * 9)).toBe('P');
    expect(p.squares.get(1 + 1 * 9)).toBe('r');
    expect([...p.promoted].sort((a, b) => a - b)).toEqual([1 + 1 * 9, 4 + 4 * 9]);
    expect(p.pocket).toEqual(['G', 'p']);
    expect(p.files).toBe(9);
    const squares = new Map([...p.squares].map(([i, c]) => [i, p.promoted.has(i) ? `+${c}` : c]));
    expect(buildFen({ ...p, squares }, 'w - - 0 1')).toBe(fen);
  });
});
