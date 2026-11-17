import { describe, expect, it } from 'vitest';
import { choiceLabel, pieceName } from './choice-dialog';

describe('choiceLabel', () => {
  it("names Shogi's two choices Promote and Don't promote", () => {
    expect(choiceLabel('shogi', '+')).toBe('Promote');
    expect(choiceLabel('shogi', '')).toBe("Don't promote");
  });

  it('keeps the other variants\' labels', () => {
    expect(choiceLabel('seirawan', '')).toBe('Nothing');
    expect(choiceLabel('seirawan', 'h')).toBe('Hawk');
    expect(choiceLabel('grand', '')).toBe('No promotion');
    expect(choiceLabel('chess', 'q')).toBe('Queen');
  });
});

describe('pieceName', () => {
  it("names Xiangqi's pieces as the game does", () => {
    expect([...'kabnrcp'].map((l) => pieceName('xiangqi', l))).toEqual([
      'General', 'Advisor', 'Elephant', 'Horse', 'Chariot', 'Cannon', 'Soldier',
    ]);
  });

  it("names Shogi's pieces as the game does, not by their built-in types (Shogi Pawn)", () => {
    expect([...'krbgsnlp'].map((l) => pieceName('shogi', l))).toEqual([
      'King', 'Rook', 'Bishop', 'Gold General', 'Silver General', 'Knight', 'Lance', 'Pawn',
    ]);
  });

  it("names Shogi's promoted rook and bishop as the game does, and the other promoted pieces Promoted …", () => {
    expect(pieceName('shogi', '+r')).toBe('Dragon King');
    expect(pieceName('shogi', '+B')).toBe('Dragon Horse');
    expect(pieceName('shogi', '+p')).toBe('Promoted Pawn');
    expect(pieceName('shogi', '+s')).toBe('Promoted Silver General');
  });

  it("keeps Seirawan's Hawk and Elephant", () => {
    expect(pieceName('seirawan', 'h')).toBe('Hawk');
    expect(pieceName('seirawan', 'e')).toBe('Elephant');
  });
});
