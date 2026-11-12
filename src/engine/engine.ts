// Engine adapter: talks UCI to Fairy-Stockfish running in a dedicated worker. No DOM or UI imports.
import type { ClockConfig, ClockState } from '../session/clock';
import sfJsUrl from 'fairy-stockfish-nnue.wasm/stockfish.js?url';
import sfWasmUrl from 'fairy-stockfish-nnue.wasm/stockfish.wasm?url';
import sfPthreadUrl from 'fairy-stockfish-nnue.wasm/stockfish.worker.js?url';
import type { FromEngine, ToEngine } from './engine-protocol';
import { levelOptions, type AiLevelId } from './levels';
import { goCommand, parseBestMove, searchTimeLimitMs } from './uci';

/** How long startup (worker, `uciok`, `readyok`), or a later `readyok`, may take before the engine counts as unavailable. */
export const ENGINE_STARTUP_TIMEOUT_MS = 15000;

/** How much longer than its time budget (movetime, or the side's remaining clock) a search may run before the engine counts as dead. */
export const ENGINE_SEARCH_MARGIN_MS = 5000;

export type EngineStatus = 'loading' | 'ready' | 'unavailable';

export interface SearchRequest {
  fen: string;
  moves: string[];
  level: AiLevelId;
  clock: ClockState | null;
  now: number;
  /** Increment config for the live clock; omit when there is no clock. */
  clockConfig?: ClockConfig;
}

export interface Engine {
  ready: Promise<void>;
  status(): EngineStatus;
  setVariant(name: string, ini?: string): Promise<void>;
  /**
   * Asks the engine to validate variants.ini text without loading it. Resolves with the problems it printed,
   * one per line; an empty array means the text is valid. Rejects only if the engine itself fails.
   */
  check(ini: string): Promise<string[]>;
  search(req: SearchRequest): Promise<string>;
  stop(): void;
  onLine(cb: (l: string) => void): void;
  /** Calls `cb` with the current status now, then on every change; `reason` says why the engine is unavailable. */
  onStatus(cb: (status: EngineStatus, reason?: string) => void): void;
  /** Fault injection into the real worker, for e2e only; undefined outside `--mode test` builds. */
  test?: EngineTestHooks;
}

export interface EngineTestHooks {
  /** Terminates the worker behind the adapter's back, as a silent wasm crash would. */
  killWorker(): void;
  /** Makes the worker throw an uncaught error, as a crash inside it would. */
  breakWorker(): void;
  /** The next search analyses this position instead of the requested one, to get a real unusable answer. */
  searchFenOnce(fen: string): void;
}

/**
 * `check` prints `Parsing variant: <name>` for every section it reads, valid or not, then one line per problem
 * (`Invalid option: <name>`, `pieceToCharTable - Missing piece type: <letter>`). Progress and `info string`
 * lines are not problems; every other non-empty line is.
 */
const isProblemLine = (line: string): boolean =>
  line !== '' && !line.startsWith('Parsing variant:') && !line.startsWith('info string');

export function createEngine(): Engine {
  let status: EngineStatus = 'loading';
  let failure: Error | null = null;
  const lineListeners = new Set<(line: string) => void>();
  const statusListeners = new Set<(status: EngineStatus, reason?: string) => void>();
  /** Everyone waiting for an output line; a failure rejects them all so no request hangs. */
  const waiters = new Set<{ match(line: string): void; fail(e: Error): void }>();
  let worker: Worker | null = null;
  let iniCount = 0;
  const writeIni = (ini: string) => {
    const path = `/variants-${iniCount++}.ini`;
    send({ type: 'writeFile', path, text: ini });
    return path;
  };
  let fenOverride: string | null = null;
  let rejectReady: (e: Error) => void = () => {};
  let startupTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (msg: ToEngine) => worker?.postMessage(msg);
  const cmd = (line: string) => send({ type: 'cmd', line });
  const setStatus = (next: EngineStatus) => {
    status = next;
    for (const l of statusListeners) l(status, failure?.message);
  };

  /** Resolves with the first output line matching `done`; rejects if the engine fails first. */
  const waitFor = (done: (line: string) => boolean): Promise<string> =>
    new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      const waiter = {
        match(line: string) {
          if (!done(line)) return;
          waiters.delete(waiter);
          resolve(line);
        },
        fail(e: Error) {
          waiters.delete(waiter);
          reject(e);
        },
      };
      waiters.add(waiter);
    });

  /**
   * Marks the engine unavailable for good, at startup or later (spec: no automatic retry; reloading retries):
   * stops the worker and rejects `ready` and every pending wait, so the request chain settles.
   */
  const fail = (cause: unknown) => {
    if (failure) return;
    failure = cause instanceof Error ? cause : new Error(String(cause));
    clearTimeout(startupTimer);
    worker?.terminate();
    console.error('Engine unavailable:', failure);
    rejectReady(failure);
    for (const w of [...waiters]) w.fail(failure);
    setStatus('unavailable');
  };

  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    let started = false;
    startupTimer = setTimeout(
      () => fail(new Error(`engine did not answer uciok/readyok within ${ENGINE_STARTUP_TIMEOUT_MS} ms`)),
      ENGINE_STARTUP_TIMEOUT_MS,
    );
    try {
      worker = new Worker(new URL('./engine-worker.ts', import.meta.url));
      // Absolute, because the worker would otherwise resolve them against its own location.
      const abs = (url: string) => new URL(url, self.location.href).href;
      send({ type: 'init', urls: { js: abs(sfJsUrl), wasm: abs(sfWasmUrl), pthread: abs(sfPthreadUrl) } });
    } catch (err) {
      fail(err);
      return;
    }
    worker.addEventListener('error', (e) => fail(new Error(`engine worker error: ${e.message}`)));
    worker.addEventListener('messageerror', () => fail(new Error('engine worker sent an unreadable message')));
    worker.addEventListener('message', (e: MessageEvent<FromEngine>) => {
      const msg = e.data;
      if (msg.type === 'line') {
        for (const l of lineListeners) l(msg.line);
        for (const w of [...waiters]) w.match(msg.line);
      } else if (msg.type === 'error') {
        fail(new Error(msg.message));
      } else if (!started) {
        started = true;
        const uciok = waitFor((l) => l === 'uciok');
        cmd('uci');
        uciok
          .then(() => {
            const readyok = waitFor((l) => l === 'readyok');
            cmd('isready');
            return readyok;
          })
          .then(() => {
            clearTimeout(startupTimer);
            setStatus('ready');
            resolve();
          }, () => {}); // a failure has already rejected `ready`
      }
    });
  });
  // Callers that never await `ready` must not trigger an unhandled rejection.
  ready.catch(() => {});

  // Everything that touches the engine runs through this chain: UCI allows one search at a time.
  let tail: Promise<unknown> = Promise.resolve();
  let searching = false;
  let latestSearch = 0;
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = tail
      .then(() => ready)
      .then(() => {
        if (failure) throw failure;
        return job();
      });
    tail = run.catch(() => {});
    return run;
  };

  /** Waits for `readyok`; a worker that never answers counts as dead, like at startup. */
  const sync = async () => {
    const readyok = waitFor((l) => l === 'readyok');
    const deadline = setTimeout(
      () => fail(new Error(`engine did not answer readyok within ${ENGINE_STARTUP_TIMEOUT_MS} ms`)),
      ENGINE_STARTUP_TIMEOUT_MS,
    );
    cmd('isready');
    try {
      await readyok;
    } finally {
      clearTimeout(deadline);
    }
  };

  return {
    ready,
    status: () => status,
    setVariant(name, ini) {
      if (searching) cmd('stop');
      return enqueue(async () => {
        if (ini !== undefined) {
          cmd(`setoption name VariantPath value ${writeIni(ini)}`);
        }
        cmd(`setoption name UCI_Variant value ${name}`);
        await sync();
      });
    },
    check(ini) {
      return enqueue(async () => {
        const lines: string[] = [];
        // `check` prints its problems and no terminator, so `readyok` after `isready` marks the end.
        const readyok = waitFor((l) => (l === 'readyok' ? true : (lines.push(l), false)));
        const deadline = setTimeout(
          () => fail(new Error(`engine did not answer readyok within ${ENGINE_STARTUP_TIMEOUT_MS} ms`)),
          ENGINE_STARTUP_TIMEOUT_MS,
        );
        cmd(`check ${writeIni(ini)}`);
        cmd('isready');
        try {
          await readyok;
        } finally {
          clearTimeout(deadline);
        }
        return lines.map((l) => l.trim()).filter(isProblemLine);
      });
    },
    search(req) {
      const id = ++latestSearch;
      if (searching) cmd('stop');
      return enqueue(async () => {
        for (const line of levelOptions(req.level)) cmd(line);
        const fen = fenOverride ?? req.fen;
        const moves = fenOverride === null ? req.moves : [];
        fenOverride = null;
        cmd(`position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
        const best = waitFor((l) => l.startsWith('bestmove'));
        searching = true;
        const limit = searchTimeLimitMs(req.level, req.clock, req.now, req.clockConfig ?? null) + ENGINE_SEARCH_MARGIN_MS;
        // A worker that dies silently (a wasm abort, say) sends nothing: only a deadline can notice.
        const watchdog = setTimeout(() => fail(new Error(`engine did not answer bestmove within ${limit} ms`)), limit);
        cmd(goCommand(req.level, req.clock, req.now, req.clockConfig ?? null));
        // A newer search arrived while this one waited its turn: do not let this one run to the end.
        if (id !== latestSearch) cmd('stop');
        try {
          const line = await best;
          const move = parseBestMove(line);
          if (move === null) throw new Error(`Engine found no move: ${line}`);
          return move;
        } finally {
          clearTimeout(watchdog);
          searching = false;
        }
      });
    },
    stop() {
      cmd('stop');
    },
    onLine(cb) {
      lineListeners.add(cb);
    },
    onStatus(cb) {
      statusListeners.add(cb);
      cb(status, failure?.message);
    },
    ...(import.meta.env.MODE === 'test' && {
      test: {
        killWorker: () => worker?.terminate(),
        // Writing into a directory that does not exist throws inside the worker's message handler, uncaught.
        breakWorker: () => send({ type: 'writeFile', path: '/no/such/dir/variants.ini', text: '' }),
        searchFenOnce: (fen: string) => {
          fenOverride = fen;
        },
      },
    }),
  };
}
