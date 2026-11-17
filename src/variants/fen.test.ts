import { describe, expect, it } from 'vitest';
import { buildFen, parseFen, parseUci, uciSquares } from './fen';

describe('parseUci', () => {
  it('reads a board move, a promotion letter and a Seirawan gating letter', () => {
    expect(parseUci('e2e4')).toEqual({ from: 'e2', to: 'e4', suffix: '', drop: null });
    expect(parseUci('e7e8q')).toEqual({ from: 'e7', to: 'e8', suffix: 'q', drop: null });
    expect(parseUci('a10a9')).toEqual({ from: 'a10', to: 'a9', suffix: '', drop: null });
  });

  it('parseUci reads a drop and a + promotion', () => {
    expect(parseUci('B@a2')).toEqual({ from: null, to: 'a2', suffix: '', drop: 'B' });
    expect(parseUci('b2h8+')).toEqual({ from: 'b2', to: 'h8', suffix: '+', drop: null });
  });

  it('refuses text that is not a move', () => expect(parseUci('nonsense')).toBeNull());
});

describe('uciSquares', () => {
  it('splits a drop into no from-square and its to-square', () => expect(uciSquares('P@e5')).toEqual({ from: null, to: 'e5' }));
  it('ignores a + promotion', () => expect(uciSquares('b2h8+')).toEqual({ from: 'b2', to: 'h8' }));
});

describe('parseFen', () => {
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
