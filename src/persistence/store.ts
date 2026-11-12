export type StoreKey = 'chess.game' | 'chess.settings' | 'chess.setups' | 'chess.pieces' | 'chess.tutorial';

export type Migrations = Record<number, (old: unknown) => unknown>;

export interface LoadResult<T> {
  data: T | null;
  problem: 'corrupt' | null;
}

export interface Store {
  available: boolean;
  load<T>(key: StoreKey, version: number, migrations: Migrations, validate: (d: unknown) => d is T): LoadResult<T>;
  save(key: StoreKey, version: number, data: unknown): boolean;
  /** Moves the stored value to `<key>.corrupt`, for data `load` accepted that a later, slower check refused. */
  quarantine(key: StoreKey): void;
}

export interface Settings {
  highlightLegal: boolean;
  boardTheme: string;
  pieceSet: string;
  sound: boolean;
}

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  highlightLegal: true,
  boardTheme: 'brown',
  pieceSet: 'default',
  sound: true,
};

export function isSettings(d: unknown): d is Settings {
  if (typeof d !== 'object' || d === null) return false;
  const s = d as Record<string, unknown>;
  return (
    typeof s.highlightLegal === 'boolean' &&
    typeof s.boardTheme === 'string' &&
    typeof s.pieceSet === 'string' &&
    typeof s.sound === 'boolean'
  );
}

interface Envelope {
  version: number;
  data: unknown;
}

function isEnvelope(d: unknown): d is Envelope {
  if (typeof d !== 'object' || d === null) return false;
  const e = d as Record<string, unknown>;
  return typeof e.version === 'number' && Number.isInteger(e.version) && 'data' in e;
}

function isUsable(storage: Storage): boolean {
  try {
    storage.getItem('chess.probe');
    return true;
  } catch {
    // Access can throw (e.g. SecurityError in private mode): treat as no storage.
    return false;
  }
}

export function createStore(storage: Storage | null): Store {
  const backing = storage !== null && isUsable(storage) ? storage : null;

  // Keep the raw value for inspection and drop the live key so the next load starts clean.
  function moveToCorrupt(key: StoreKey, raw: string): void {
    if (backing === null) return;
    try {
      backing.setItem(`${key}.corrupt`, raw);
      backing.removeItem(key);
    } catch {
      // Best effort: the caller still gets the corrupt report.
    }
  }

  function migrate(env: Envelope, version: number, migrations: Migrations): unknown {
    let data = env.data;
    for (let v = env.version; v < version; v++) {
      const step = migrations[v];
      if (step === undefined) throw new Error(`no migration from version ${v}`);
      data = step(data);
    }
    return data;
  }

  return {
    available: backing !== null,

    load<T>(key: StoreKey, version: number, migrations: Migrations, validate: (d: unknown) => d is T): LoadResult<T> {
      if (backing === null) return { data: null, problem: null };
      let raw: string | null;
      try {
        raw = backing.getItem(key);
      } catch {
        return { data: null, problem: null };
      }
      if (raw === null) return { data: null, problem: null };

      try {
        const parsed: unknown = JSON.parse(raw);
        if (isEnvelope(parsed) && parsed.version <= version) {
          const data = migrate(parsed, version, migrations);
          if (validate(data)) return { data, problem: null };
        }
      } catch {
        // Unparseable JSON or a failed migration: fall through to corrupt.
      }
      moveToCorrupt(key, raw);
      return { data: null, problem: 'corrupt' };
    },

    quarantine(key) {
      if (backing === null) return;
      let raw: string | null = null;
      try {
        raw = backing.getItem(key);
      } catch {
        // Unreadable now: nothing to keep.
      }
      if (raw !== null) moveToCorrupt(key, raw);
    },

    save(key, version, data) {
      if (backing === null) return false;
      try {
        backing.setItem(key, JSON.stringify({ version, data }));
        return true;
      } catch {
        // QuotaExceededError or any other storage failure.
        return false;
      }
    },
  };
}
