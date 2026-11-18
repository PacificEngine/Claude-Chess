import { describe, expect, it } from 'vitest';
import { duckSquaresOf, duckStepFen, duckSteps } from './duck';

describe('duckSteps', () => {
  it('groups the candidates by the piece move, each duck square paired with its full move', () => {
    const steps = duckSteps(['e2e4,e4a3', 'e2e4,e4h6', 'e2e3,e3a3']);
    expect([...steps.keys()]).toEqual(['e2e4', 'e2e3']);
    expect(steps.get('e2e4')).toEqual(new Map([['a3', 'e2e4,e4a3'], ['h6', 'e2e4,e4h6']]));
    expect(steps.get('e2e3')).toEqual(new Map([['a3', 'e2e3,e3a3']]));
  });

  it('keeps each promotion apart, so the promotion is chosen before the duck', () => {
    const steps = duckSteps(['a7a8q,a8b3', 'a7a8n,a8b3', 'a7a8q,a8c3']);
    expect([...steps.keys()]).toEqual(['a7a8q', 'a7a8n']);
    expect([...steps.get('a7a8q')!.keys()]).toEqual(['b3', 'c3']);
  });

  it('leaves out moves with no duck part, which need no duck step', () => {
    expect(duckSteps(['e2e4', 'e7e8q']).size).toBe(0);
  });
});

describe('duckSquaresOf', () => {
  it('finds every duck on the board, not just one', () => {
    expect(duckSquaresOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toEqual([]);
    expect(duckSquaresOf('4k3/8/8/3*4/8/8/8/*3K3 w - - 0 1')).toEqual(['a1', 'd5']);
  });
});

describe('duckStepFen', () => {
  it('shows the piece moved and the duck still where it stood', () => {
    const before = 'rnbqkbnr/pppp1ppp/8/4p3/3*4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2';
    // After e2e4 with the duck sent to h6.
    const after = 'rnbqkbnr/pppp1ppp/7*/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2';
    expect(duckStepFen(before, after).split(' ')[0]).toBe('rnbqkbnr/pppp1ppp/8/4p3/3*P3/8/PPPP1PPP/RNBQKBNR');
  });

  it('leaves the duck off the board on the first turn, when it has not come on yet', () => {
    const before = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const after = 'rnbqkbnr/pppppppp/7*/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(duckStepFen(before, after).split(' ')[0]).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR');
  });

  it('keeps the mover as the side to move, since the turn is not over', () => {
    const before = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const after = 'rnbqkbnr/pppppppp/7*/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(duckStepFen(before, after).split(' ').slice(1)).toEqual(before.split(' ').slice(1));
  });
});
