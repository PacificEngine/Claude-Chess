// Engine spike (plan Task 1). Answers the "verify in the first spike" list in
// docs/specs/chess/engine.md on a server that, like GitHub Pages, sends no COOP/COEP
// headers. Cross-origin isolation comes from coi-serviceworker, which the page's
// <script src="/coi-serviceworker.min.js"> registers before this module runs.
import loadFfish, { type FairyStockfish } from 'ffish-es6';
import ffishWasmUrl from 'ffish-es6/ffish.wasm?url';
import type { FromEngine, ToEngine } from './engine-worker';

const VARIANTS = ['chess', 'capablanca', 'grand', 'seirawan', 'amazon', 'shako', 'antichess', 'spartan', 'spikecustom'];
const INI_PATH = '/spike-variants.ini';
const SLOT_PROBE_MAX = 30;

// One Betza modifier per probe, each in a position where it changes what the piece `a`
// on a1 may do. `expected` is the set of a1 moves the modifier means in Betza notation.
const BETZA_PROBES: Record<string, { betza: string; fen: string; expected: string[] }> = {
  m: { betza: 'mR', fen: '4k3/8/8/8/8/8/p7/A3K3 w - - 0 1', expected: ['a1b1', 'a1c1', 'a1d1'] },
  c: { betza: 'cR', fen: '4k3/8/8/8/8/8/p7/A3K3 w - - 0 1', expected: ['a1a2'] },
  p: { betza: 'pR', fen: '4k3/8/8/8/8/p7/P7/A3K3 w - - 0 1', expected: ['a1a3', 'a1f1', 'a1g1', 'a1h1'] },
  g: { betza: 'gR', fen: '4k3/8/8/8/8/p7/P7/A3K3 w - - 0 1', expected: ['a1a3', 'a1f1'] },
  n: { betza: 'nN', fen: '4k3/8/8/8/8/8/P7/A3K3 w - - 0 1', expected: ['a1c2'] },
  // XBoard Betza: j on a slider = must skip the first square.
  j: {
    betza: 'jR',
    fen: '4k3/8/8/8/8/8/8/A3K3 w - - 0 1',
    expected: ['a1a3', 'a1a4', 'a1a5', 'a1a6', 'a1a7', 'a1a8', 'a1c1', 'a1d1'],
  },
};

function buildIni(): string {
  const sections = [
    // A knightrider on a 12x10 board: exercises the large-board build and a rider atom.
    `[spikecustom:chess]
maxFile = l
maxRank = 10
customPiece1 = a:NN
startFen = rnbqkbnra3/pppppppppppp/12/12/12/12/12/12/PPPPPPPPPPPP/RNBQKBNRA3 w - - 0 1`,
  ];
  for (let n = 1; n <= SLOT_PROBE_MAX; n++)
    sections.push(`[slot${n}:chess]\ncustomPiece${n} = a:W\nstartFen = 4k3/8/8/8/3A4/8/8/4K3 w - - 0 1`);
  for (const [mod, p] of Object.entries(BETZA_PROBES))
    sections.push(`[betza${mod}:chess]\ncustomPiece1 = a:${p.betza}\nstartFen = ${p.fen}`);
  return sections.join('\n\n') + '\n';
}

class Engine {
  private listeners = new Set<(line: string) => void>();

  private constructor(private worker: Worker) {
    worker.addEventListener('message', (e: MessageEvent<FromEngine>) => {
      if (e.data.type === 'line') for (const l of this.listeners) l(e.data.line);
    });
  }

  static start(timeoutMs = 15000): Promise<Engine> {
    const worker = new Worker(new URL('./engine-worker.ts', import.meta.url));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('engine worker did not start')), timeoutMs);
      worker.addEventListener('message', function onReady(e: MessageEvent<FromEngine>) {
        if (e.data.type === 'line') return;
        clearTimeout(timer);
        worker.removeEventListener('message', onReady);
        if (e.data.type === 'ready') resolve(new Engine(worker));
        else reject(new Error(e.data.message));
      });
      worker.addEventListener('error', (e) => reject(new Error(`engine worker error: ${e.message}`)));
    });
  }

  private post(msg: ToEngine) {
    this.worker.postMessage(msg);
  }

  writeFile(path: string, text: string) {
    this.post({ type: 'writeFile', path, text });
  }

  send(...lines: string[]) {
    for (const line of lines) this.post({ type: 'cmd', line });
  }

  /** Sends `lines`, then resolves with every output line up to and including the first that matches `done`. */
  request(lines: string[], done: (line: string) => boolean, timeoutMs = 15000): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const seen: string[] = [];
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`timeout waiting after: ${lines.join(' | ')}`));
      }, timeoutMs);
      const listener = (line: string) => {
        seen.push(line);
        if (!done(line)) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(seen);
      };
      this.listeners.add(listener);
      this.send(...lines);
    });
  }

  async bestmove(variant: string, go: string): Promise<string> {
    const out = await this.request(
      [`setoption name UCI_Variant value ${variant}`, 'ucinewgame', 'position startpos', go],
      (l) => l.startsWith('bestmove'),
    );
    return out[out.length - 1].split(' ')[1];
  }

  terminate() {
    this.worker.terminate();
  }
}

function spinOption(uciLines: string[], name: string) {
  const line = uciLines.find((l) => l.startsWith(`option name ${name} type spin`));
  const num = (key: string) => Number(line?.match(new RegExp(`${key} (-?\\d+)`))?.[1]);
  return { default: num('default'), min: num('min'), max: num('max') };
}

function ffishMovesFrom(ffish: FairyStockfish, variant: string, square: string): string[] {
  const board = new ffish.Board(variant);
  try {
    return board.legalMoves().split(' ').filter((m) => m.startsWith(square)).sort();
  } finally {
    board.delete();
  }
}

async function runSpike() {
  const ini = buildIni();

  // --- ffish.js (rules) ---
  const ffish = await loadFfish({ locateFile: () => ffishWasmUrl });
  // variants() is empty until the library initialises, which the first Board does.
  new ffish.Board('chess').delete();
  const ffishBuiltIn = ffish.variants().split(' ');
  ffish.loadVariantConfig(ini);
  const ffishVariants = ffish.variants().split(' ');

  const ffishSlots = [];
  for (let n = 1; n <= SLOT_PROBE_MAX; n++) if (ffishMovesFrom(ffish, `slot${n}`, 'd4').length) ffishSlots.push(n);

  const betza: Record<string, { moves: string[]; supported: boolean }> = {};
  for (const [mod, p] of Object.entries(BETZA_PROBES)) {
    const moves = ffishMovesFrom(ffish, `betza${mod}`, 'a1');
    betza[mod] = { moves, supported: moves.join(' ') === [...p.expected].sort().join(' ') };
  }

  const ffishLegalMoveCount: Record<string, number> = {};
  for (const v of VARIANTS) {
    const b = new ffish.Board(v);
    ffishLegalMoveCount[v] = b.numberLegalMoves();
    b.delete();
  }

  // The exact method names later tasks will rely on, exercised on a real game end.
  const fools = new ffish.Board('chess');
  const sanG1f3 = fools.sanMove('g1f3');
  fools.pushMoves('f2f3 e7e5 g2g4 d8h4');
  const ffishApi = {
    sanMove_g1f3: sanG1f3,
    result_foolsMate: fools.result(),
    isGameOver_foolsMate: fools.isGameOver(),
    insufficientMaterial_KNvK: (() => {
      const b = new ffish.Board('chess', '8/8/8/4k3/8/8/8/4K2N w - - 0 1');
      const r = { isInsufficientMaterial: b.isInsufficientMaterial(), hasInsufficientMaterialWhite: b.hasInsufficientMaterial(true) };
      b.delete();
      return r;
    })(),
  };
  fools.delete();

  // --- Fairy-Stockfish (engine) ---
  const engine = await Engine.start();
  try {
    const uci = await engine.request(['uci'], (l) => l === 'uciok');
    await engine.request(['isready'], (l) => l === 'readyok');
    const engineVariants = uci.find((l) => l.startsWith('option name UCI_Variant'))?.split(' var ').slice(1) ?? [];

    engine.writeFile(INI_PATH, ini);
    // `check` validates a variants file and reports problems on stderr (which the
    // listener also receives); isready marks the end of its output.
    const check = (await engine.request([`check ${INI_PATH}`, 'isready'], (l) => l === 'readyok')).slice(0, -1);
    await engine.request([`setoption name VariantPath value ${INI_PATH}`, 'isready'], (l) => l === 'readyok');
    // Loading the same names a second time is refused, so generated variants need fresh names.
    const reload = (await engine.request([`load ${INI_PATH}`, 'isready'], (l) => l === 'readyok')).slice(0, -1);

    const engineSlots = [];
    for (let n = 1; n <= SLOT_PROBE_MAX; n++) if (!check.includes(`Invalid option: customPiece${n}`)) engineSlots.push(n);

    const bestmove: Record<string, string> = {};
    for (const v of VARIANTS) bestmove[v] = await engine.bestmove(v, 'go movetime 200');

    const engineBetza: Record<string, string> = {};
    for (const mod of Object.keys(BETZA_PROBES)) engineBetza[mod] = await engine.bestmove(`betza${mod}`, 'go depth 4');

    // Does UCI_Elo change play outside standard chess? Repeat a short Grand search at
    // the weakest and at full strength and compare the chosen moves.
    const eloRuns = async (limit: boolean, elo: number) => {
      engine.send(`setoption name UCI_LimitStrength value ${limit}`, `setoption name UCI_Elo value ${elo}`);
      const moves = [];
      for (let i = 0; i < 6; i++) moves.push(await engine.bestmove('grand', 'go movetime 150'));
      return moves;
    };
    const grandElo500 = await eloRuns(true, 500);
    const grandFull = await eloRuns(false, 1350);

    // Threaded search: does Threads > 1 work on this page?
    engine.send(`setoption name Threads value 2`);
    const threads2Bestmove = await engine.bestmove('chess', 'go movetime 200');

    const report = {
      crossOriginIsolated: self.crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      hardwareConcurrency: navigator.hardwareConcurrency,
      engineId: uci.find((l) => l.startsWith('id name'))?.slice(8),
      ffishInfo: ffish.info(),
      uciElo: spinOption(uci, 'UCI_Elo'),
      threadsOption: spinOption(uci, 'Threads'),
      hashOption: spinOption(uci, 'Hash'),
      engineVariantsIncludeSpartan: engineVariants.includes('spartan'),
      ffishVariantsIncludeSpartan: ffishBuiltIn.includes('spartan'),
      // Fairy-Stockfish's src/variants.ini has no [spartan] section: spartan is built in.
      spartanLoadedFromIni: false,
      ffishLoadedSpikecustom: ffishVariants.includes('spikecustom'),
      bestmove,
      ffishLegalMoveCount,
      customPieceSlots: { ffish: ffishSlots, engine: engineSlots },
      betza,
      engineBetza,
      engineCheckOutput: check,
      engineReloadOutput: reload,
      grandElo500,
      grandFull,
      threads2Bestmove,
      ffishApi,
    };
    const out = document.getElementById('out');
    if (out) out.textContent = JSON.stringify(report, null, 2);
    return report;
  } finally {
    engine.terminate();
  }
}

export type SpikeReport = Awaited<ReturnType<typeof runSpike>>;

declare global {
  interface Window {
    runSpike: () => Promise<SpikeReport>;
  }
}
window.runSpike = runSpike;
