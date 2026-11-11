// AI strength levels. Elo values sit inside Fairy-Stockfish's UCI_Elo range (500-2850).
export type AiLevelId = 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'expert' | 'max';

// Per-move thinking time when no clock runs. Longer for stronger levels.
const MOVETIME_BEGINNER_MS = 300;
const MOVETIME_NOVICE_MS = 500;
const MOVETIME_INTERMEDIATE_MS = 800;
const MOVETIME_ADVANCED_MS = 1200;
const MOVETIME_EXPERT_MS = 2000;
const MOVETIME_MAX_MS = 3000;

export interface AiLevel {
  id: AiLevelId;
  label: string;
  /** null means full strength. */
  elo: number | null;
  movetimeMs: number;
}

export const AI_LEVELS: readonly AiLevel[] = [
  { id: 'beginner', label: 'Beginner', elo: 800, movetimeMs: MOVETIME_BEGINNER_MS },
  { id: 'novice', label: 'Novice', elo: 1100, movetimeMs: MOVETIME_NOVICE_MS },
  { id: 'intermediate', label: 'Intermediate', elo: 1400, movetimeMs: MOVETIME_INTERMEDIATE_MS },
  { id: 'advanced', label: 'Advanced', elo: 1700, movetimeMs: MOVETIME_ADVANCED_MS },
  { id: 'expert', label: 'Expert', elo: 2000, movetimeMs: MOVETIME_EXPERT_MS },
  { id: 'max', label: 'Max', elo: null, movetimeMs: MOVETIME_MAX_MS },
];

export function levelById(id: AiLevelId): AiLevel {
  const level = AI_LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown AI level: ${id}`);
  return level;
}

/** The `setoption` lines that set the engine's strength for a level. */
export function levelOptions(id: AiLevelId): string[] {
  const { elo } = levelById(id);
  return elo === null
    ? ['setoption name UCI_LimitStrength value false']
    : ['setoption name UCI_LimitStrength value true', `setoption name UCI_Elo value ${elo}`];
}
