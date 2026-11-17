// `yarn tutorial:search`: finds lesson puzzles with exactly one solution and prints them as ready-to-paste
// Puzzle JSON. Run under Vitest (for the wasm rules), but outside the default `yarn test` include.
//   PIECE  a built-in type (wazir) or <variant>:<letter> (shako:c)
//   GOAL   mate1, mate2, capture1 or capture2
//   COUNT  how many to find (default 5)
//   SEED   the PRNG seed (default 1); the same seed finds the same puzzles
// The search stops after 60 s with whatever it found.
import { it } from 'vitest';
import { loadTestRules } from '../src/rules/test-rules';
import { type SearchGoal, searchPuzzles } from '../src/tutorial/search';

const TIME_LIMIT_MS = 60_000;

it('finds puzzles', async () => {
  const piece = process.env.PIECE;
  const goal = process.env.GOAL as SearchGoal | undefined;
  if (!piece || !goal) throw new Error('Set PIECE (a type or <variant>:<letter>) and GOAL (mate1, mate2, capture1 or capture2)');
  const count = Number(process.env.COUNT ?? 5);
  const seed = Number(process.env.SEED ?? 1);
  const rules = await loadTestRules();
  const started = Date.now();
  const found = searchPuzzles(rules, { piece, goal, count, seed, timeLimitMs: TIME_LIMIT_MS });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const summary = found.length
    ? `Found ${found.length} of ${count} ${goal} puzzles for ${piece} (seed ${seed}) in ${seconds} s.`
    : `None found: no ${goal} puzzle for ${piece} (seed ${seed}) within ${seconds} s. Try another SEED.`;
  // Written straight to stdout, so Vitest neither hides nor prefixes it.
  process.stdout.write(`\n${found.map((p) => JSON.stringify(p)).join(',\n')}\n\n${summary}\n`);
}, TIME_LIMIT_MS + 30_000);
