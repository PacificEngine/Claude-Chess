import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { generateVariant } from './generator';
import { reachFrom } from './reach';
import type { SetupSpec } from './setup';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

describe('reachFrom', () => {
  it('matches the designer probe for a rook on d4', () => {
    const r = reachFrom(rules, 'chess', '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1', 'd4');
    expect(r.moves).toEqual(
      ['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'd6', 'd7', 'd8', 'e4', 'f4', 'g4', 'h4'].sort(),
    );
    expect(r.captures).toEqual([]);
  });

  it('lists capture-only squares for a cannon', () => {
    const fen = 'k7/8/3p4/8/3C4/8/8/7K w - - 0 1';
    const spec: SetupSpec = {
      base: 'chess',
      files: 8,
      ranks: 8,
      pieces: { k: 'king', p: 'pawn', n: 'knight', c: 'cannon' },
      fen,
      castling: false,
      promotion: { rank: 'last', pieceTypes: [] },
    };
    const { name, ini } = generateVariant(spec);
    if (!rules.knows(name)) rules.loadConfig(ini);
    const r = reachFrom(rules, name, fen, 'd4');
    expect(r.moves).toEqual(['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'e4', 'f4', 'g4', 'h4']);
    expect(r.captures).toEqual(['d7', 'd8']);
  });

  it('matches the designer preview for a designed cannon', () => {
    // The designer preview board, built here because variants code must not import UI modules.
    const fen = 'k7/8/1p1p1p2/8/3Z1p2/8/8/7K w - - 0 1';
    const spec: SetupSpec = {
      base: 'chess',
      files: 8,
      ranks: 8,
      pieces: { k: 'king', p: 'pawn', n: 'knight' },
      designed: { z: { id: 'preview', betza: 'mRcpR', art: null } },
      fen,
      castling: false,
      promotion: { rank: 'last', pieceTypes: [] },
    };
    const { name, ini } = generateVariant(spec);
    if (!rules.knows(name)) rules.loadConfig(ini);
    // The designer test's expectation for 'mRcpR'.
    expect(reachFrom(rules, name, fen, 'd4')).toEqual({
      moves: ['a4', 'b4', 'c4', 'd1', 'd2', 'd3', 'd5', 'e4'],
      captures: ['d7', 'd8', 'g4', 'h4'],
    });
  });

  it('refuses an empty square, or a piece of the side not to move', () => {
    const fen = '4k3/8/8/8/3R4/8/8/4K3 w - - 0 1';
    expect(() => reachFrom(rules, 'chess', fen, 'd5')).toThrow('No piece on d5');
    expect(() => reachFrom(rules, 'chess', fen.replace(' w ', ' b '), 'd4')).toThrow('The piece on d4 is not the side to move');
  });
});
