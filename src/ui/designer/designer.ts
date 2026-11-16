// The piece designer screen: wires the model to the view, registers each design's preview setup (after a short
// pause, so typing Betza doesn't send the engine a definition per key), and keeps the piece library
// (chess.pieces). It opens from the editor and closes back to it; the setup being edited never changes here.
// Saving new moves or art for a piece that saved setups or the game use asks first: "Update everywhere" rewrites
// their copies (through the app), "Save as new piece" leaves them, and the original, as they were.
import type { Engine } from '../../engine/engine';
import { type DesignedPiece, savePieces } from '../../persistence/pieces';
import type { Store } from '../../persistence/store';
import type { Rules } from '../../rules/types';
import { registerSetup } from '../../variants/registry';
import { type BetzaResult, CANNOT_MOVE, DesignerModel, uniqueById, upsertPiece } from './designer-model';
import { canMove, previewSpec, type Reach, reachOf } from './designer-preview';
import { createDesignerView } from './designer-view';

export const PREVIEW_DELAY_MS = 300;
export const CHECKING = 'Checking…';
const SAVE_REFUSED = "The piece couldn't be saved: the browser refused to store it.";

export interface DesignerDeps {
  rules: Rules;
  engine: Engine | null;
  store: Store;
  /** The library as loaded from storage. */
  initial: DesignedPiece[];
  /** The library changed: a piece was saved or deleted. */
  changed(pieces: readonly DesignedPiece[]): void;
  /** True when a saved setup or the game in progress holds a copy of the library piece `id`. */
  inUse(id: string): boolean;
  /**
   * "Update everywhere": rewrites the copies of `piece` in saved setups and the game in progress. Resolves to
   * the reasons something couldn't be updated (it then keeps the piece as it was), or none.
   */
  updateCopies(piece: DesignedPiece): Promise<string[]>;
  /** The player closed the designer: show the editor again. */
  closed(): void;
}

export interface Designer {
  /** Opens on a library piece to edit, or a new piece (null). */
  open(piece: DesignedPiece | null): void;
  /** Hides it without telling the editor (the editor is closing too). */
  hide(): void;
  isOpen(): boolean;
  pieces(): readonly DesignedPiece[];
}

/** What the preview found for one Betza: where it goes, or why it can't be shown. */
type Verdict = { ok: true; reach: Reach } | { ok: false; problems: string[]; disabled: boolean };

const squares = (n: number) => `${n} square${n === 1 ? '' : 's'}`;

function describe(r: Reach): string {
  const { moves, captures } = r;
  if (moves.length && captures.length) return `This piece can move to ${squares(moves.length)}, and capture on ${captures.length} more.`;
  if (moves.length) return `This piece can move to ${squares(moves.length)}.`;
  return `This piece can capture on ${squares(captures.length)}.`;
}

export function createDesigner(host: HTMLElement, deps: DesignerDeps): Designer {
  const { rules, engine, store } = deps;
  let pieces: DesignedPiece[] = uniqueById(deps.initial);
  const section = document.createElement('section');
  section.className = 'designer layout';
  section.dataset.testid = 'designer';
  section.hidden = true;
  host.append(section);

  let model = DesignerModel.create();
  let notice = '';
  /** Save is waiting for "Update everywhere" or "Save as new piece". */
  let choosing = false;
  /** An "Update everywhere" is still being checked: another save now would race it. */
  let updating = false;
  /** Verdicts by Betza: a design's preview is worked out once (the variant can't be registered twice anyway). */
  const verdicts = new Map<string, Verdict>();
  /** The Betza being previewed, while its check is pending. */
  let pending: string | null = null;
  let token = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const view = createDesignerView(section, {
    name(text) {
      model.name = text;
      edited();
    },
    letter(letter) {
      model.letter = letter;
      edited();
    },
    addMove() {
      model.addComponent();
      edited();
    },
    removeMove(i) {
      model.removeComponent(i);
      edited();
    },
    updateMove(i, patch) {
      model.updateComponent(i, patch);
      edited();
    },
    combine(type, on) {
      model.setCombine(type, on); // false at the cap: the box is drawn unticked again
      edited();
    },
    advanced(betza) {
      model.setAdvanced(betza);
      edited();
    },
    art(id) {
      model.art = id;
      edited();
    },
    save,
    change,
    delete: remove,
    close() {
      hide();
      deps.closed();
    },
  });

  function edited(): void {
    notice = '';
    choosing = false; // the question was about the design as it was
    // Built once per edit: building it orders its parts, a search.
    const result = model.betza();
    schedule(result);
    draw(result);
  }

  /** Previews the design's Betza after a pause, unless it is already known or already pending. */
  function schedule({ betza }: BetzaResult): void {
    if (betza === null || verdicts.has(betza) || betza === pending) {
      if (betza !== pending) {
        // A pending check for Betza the player has since changed is stale.
        pending = null;
        ++token;
        clearTimeout(timer);
      }
      return;
    }
    const t = ++token;
    pending = betza;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void preview(betza).then((verdict) => {
        // Kept even when stale: it still holds if the player comes back to this Betza. An unavailable engine
        // never comes back, so its verdict holds too.
        verdicts.set(betza, verdict);
        if (t !== token) return;
        pending = null;
        draw();
      });
    }, PREVIEW_DELAY_MS);
  }

  async function preview(betza: string): Promise<Verdict> {
    try {
      // A loading engine is worth waiting for; a failed one is reported by registerSetup.
      if (engine) await engine.ready.catch(() => {});
      const registered = await registerSetup(rules, engine, previewSpec(betza));
      if (!registered.ok) return { ok: false, problems: registered.problems, disabled: !engine || engine.status() !== 'ready' };
      return { ok: true, reach: reachOf(rules, registered.name) };
    } catch (e) {
      console.error('Piece preview failed:', e);
      return { ok: false, problems: [`The piece couldn't be checked: ${e instanceof Error ? e.message : String(e)}`], disabled: false };
    }
  }

  function draw(result: BetzaResult = model.betza()): void {
    const problems = model.problems(result);
    const verdict = result.betza === null ? undefined : verdicts.get(result.betza);
    let status = '';
    let reach: Reach | null = null;
    let disabled = false;
    if (result.betza !== null) {
      if (!verdict) status = CHECKING;
      else if (!verdict.ok) {
        problems.push(...verdict.problems);
        disabled = verdict.disabled;
      } else if (!canMove(verdict.reach)) problems.push(CANNOT_MOVE);
      else {
        reach = verdict.reach;
        status = describe(verdict.reach);
      }
    }
    view.render({
      model,
      betza: result.betza ?? '',
      problems,
      status,
      reach,
      disabled,
      canSave: problems.length === 0 && reach !== null && !updating,
      notice,
      choosing,
    });
  }

  /** Save is enabled: no problems, and the preview found somewhere to go. */
  function saveable(result: BetzaResult): boolean {
    const verdict = result.betza === null ? undefined : verdicts.get(result.betza);
    return model.problems(result).length === 0 && verdict?.ok === true && canMove(verdict.reach);
  }

  function save(): void {
    const result = model.betza();
    if (updating || !saveable(result)) return; // Save is disabled then
    const original = model.id === null ? undefined : pieces.find((p) => p.id === model.id);
    const piece = model.toPiece(model.id ?? crypto.randomUUID(), Date.now(), result);
    // A new name or letter changes no setup's rules (copies keep their letters), so only moves and art ask.
    if (original && (original.betza !== piece.betza || original.art !== piece.art) && deps.inUse(original.id)) {
      choosing = true;
      return draw(result);
    }
    if (keep(piece)) notice = `Saved “${piece.name}”.`;
    draw(result);
  }

  function change(choice: 'everywhere' | 'new' | null): void {
    if (!choosing) return;
    choosing = false;
    const result = model.betza();
    if (choice === null || !saveable(result)) return draw(result);
    if (choice === 'new') {
      // A new id: the library entry the setups' copies came from stays as it was.
      const piece = model.toPiece(crypto.randomUUID(), Date.now(), result);
      if (keep(piece)) notice = `Saved “${piece.name}” as a new piece.`;
      return draw(result);
    }
    const piece = model.toPiece(model.id!, Date.now(), result);
    if (!keep(piece)) return draw(result);
    notice = 'Updating the setups and the game that use it…';
    updating = true;
    draw(result);
    const m = model;
    void deps
      .updateCopies(piece)
      .catch((e: unknown) => [e instanceof Error ? e.message : String(e)])
      .then((problems) => {
        updating = false;
        if (m !== model) return draw(); // another piece was opened meanwhile
        notice = problems.length
          ? `Saved “${piece.name}”, but not everything that uses it could be updated: ${problems.join(' ')}`
          : `Saved “${piece.name}” and updated the setups and the game that use it.`;
        draw();
      });
  }

  /** Puts `piece` in the library and storage; false (with the notice set) when the browser refused. */
  function keep(piece: DesignedPiece): boolean {
    const next = upsertPiece(pieces, piece);
    if (!savePieces(store, next)) {
      notice = SAVE_REFUSED;
      return false;
    }
    pieces = next;
    model.id = piece.id;
    deps.changed(pieces);
    return true;
  }

  function remove(): void {
    if (model.id === null) return;
    const id = model.id;
    const next = pieces.filter((p) => p.id !== id);
    if (!savePieces(store, next)) {
      notice = "The piece couldn't be deleted: the browser refused to store the change.";
      return draw();
    }
    pieces = next;
    deps.changed(pieces);
    hide();
    deps.closed();
  }

  function hide(): void {
    section.hidden = true;
    ++token;
    pending = null;
    clearTimeout(timer);
  }

  return {
    open(piece) {
      model = piece ? DesignerModel.fromPiece(piece) : DesignerModel.create();
      notice = '';
      choosing = false;
      section.hidden = false;
      view.load(model);
      const result = model.betza();
      schedule(result);
      draw(result);
    },
    hide,
    isOpen: () => !section.hidden,
    pieces: () => pieces,
  };
}
