import { beforeAll, describe, expect, it } from 'vitest';
import { loadTestRules } from '../rules/test-rules';
import type { Rules } from '../rules/types';
import { CURATED_VARIANTS } from './catalog';
import { BUILTIN_PIECES, type PieceType, pieceTypeByName, typesOfVariant } from './piece-types';

let rules: Rules;
beforeAll(async () => {
  rules = await loadTestRules();
});

// The black pawn on e5 gives capture-only (clobber) and hurdle (janggiCannon) pieces a move. The black king
// sits on h8, off every line through d5, so no probe starts by giving check.
const probeFen = (p: PieceType) => `7k/8/8/3${p.letter.toUpperCase()}p3/8/8/8/K7 w - - 0 1`;

// A variant name can't be redefined in ffish, so each probe gets its own name and is loaded once per run.
const loadedProbes = new Set<string>();
function probeVariant(p: PieceType): string {
  const name = `probe_${p.type}`;
  if (!loadedProbes.has(name)) {
    rules.loadConfig(`[${name}:chess]\n${p.type} = ${p.letter}\nstartFen = ${probeFen(p)}\n`);
    loadedProbes.add(name);
  }
  return name;
}

describe('built-in piece catalog', () => {
  it('offers every Fairy-Stockfish built-in piece so the editor palette is complete', () =>
    expect(BUILTIN_PIECES.length).toBeGreaterThanOrEqual(30));

  it('names each type once, so the palette has no duplicate entries', () =>
    expect(new Set(BUILTIN_PIECES.map((p) => p.type)).size).toBe(BUILTIN_PIECES.length));

  it('marks only the king royal', () =>
    expect(BUILTIN_PIECES.filter((p) => p.royal).map((p) => p.type)).toEqual(['king']));

  it('gives every piece a plain-English name', () => {
    expect(pieceTypeByName('fersAlfil').name).toBe('Fers-Alfil');
    expect(pieceTypeByName('dragonHorse').name).toBe('Dragon Horse');
    for (const p of BUILTIN_PIECES) expect(p.name, p.type).toMatch(/^[A-Z][A-Za-z]*([ -][A-Z][A-Za-z]*)*$/);
  });

  it('rejects an unknown type name instead of inventing one', () =>
    expect(() => pieceTypeByName('dabbaba')).toThrow(/Unknown piece type/));

  it('lets each built-in piece move, so none is a dead entry', () => {
    for (const p of BUILTIN_PIECES.filter((p) => !p.royal)) {
      const game = rules.newGame(probeVariant(p), probeFen(p));
      try {
        expect(game.legalMovesFrom('d5').length, p.type).toBeGreaterThan(0);
      } finally {
        game.dispose();
      }
    }
  });
});

describe('typesOfVariant', () => {
  it('knows which piece type each curated variant uses for each letter', () => {
    expect(typesOfVariant(rules, 'capablanca').get('a')).toBe('archbishop');
    expect(typesOfVariant(rules, 'shako').get('c')).toBe('cannon');
  });

  it('maps the standard chess set to the standard types', () =>
    expect(Object.fromEntries(typesOfVariant(rules, 'chess'))).toEqual({
      p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
    }));

  it('reads pieces in hand as well as pieces on the board', () => {
    const seirawan = typesOfVariant(rules, 'seirawan');
    expect(seirawan.get('h')).toBe('archbishop');
    expect(seirawan.get('e')).toBe('chancellor');
  });

  it("calls a piece the base variant defines itself 'inherited'", () => {
    const spartan = typesOfVariant(rules, 'spartan');
    expect(spartan.get('h')).toBe('inherited'); // hoplite
    expect(spartan.get('w')).toBe('archbishop'); // warlord
    expect(spartan.get('g')).toBe('bers'); // general
    expect(spartan.get('k')).toBe('commoner'); // Spartan kings are pseudo-royal commoners, two may stand
  });

  it('tells a non-royal king-mover from the king', () =>
    expect(typesOfVariant(rules, 'antichess').get('k')).toBe('commoner'));

  it('recognises every built-in type, so no two of them look alike to the mapper', () => {
    for (const p of BUILTIN_PIECES.filter((p) => !p.royal)) {
      expect(typesOfVariant(rules, probeVariant(p)).get(p.letter), p.type).toBe(p.type);
    }
  });

  it('maps every letter of every curated variant to a built-in type or inherited', () => {
    const allowed = new Set([...BUILTIN_PIECES.map((p) => p.type), 'inherited']);
    for (const v of CURATED_VARIANTS) {
      const types = typesOfVariant(rules, v.engineName);
      expect(types.size, v.engineName).toBeGreaterThan(0);
      for (const [letter, type] of types) expect(allowed, `${v.engineName} ${letter}`).toContain(type);
    }
  });
});
