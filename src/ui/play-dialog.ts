// The Play dialog: variant (curated, or a saved editor setup), opponent (an AI level or hot-seat), the player's
// color, and the clock. It only collects choices; app.ts checks setups and turns choices into a GameSession.
import type { EngineStatus } from '../engine/engine';
import { AI_LEVELS, type AiLevelId } from '../engine/levels';
import { CLOCK_PRESETS, type ClockConfig } from '../session/clock';
import { CURATED_VARIANTS, type VariantId } from '../variants/catalog';

export type VariantChoice = { kind: 'curated'; id: VariantId } | { kind: 'setup'; id: string };

/** A setup the variant list offers: a saved one, or the one open in the editor. Names are the player's text. */
export interface SetupOption {
  id: string;
  name: string;
  blurb: string;
}

export interface PlayChoice {
  variant: VariantChoice;
  opponent: { kind: 'hotseat' } | { kind: 'ai'; level: AiLevelId };
  /** The human's color against the AI. Ignored for hot-seat. */
  color: 'white' | 'black' | 'random';
  clockConfig: ClockConfig;
}

/** The id under which the setup open in the editor is offered; saved setups use UUIDs. */
export const EDITOR_SETUP_ID = 'editor';

export interface PlayDialog {
  open(defaults: PlayChoice): void;
  setEngineStatus(status: EngineStatus, reason?: string): void;
  onStart(cb: (choice: PlayChoice) => void): void;
  /** The setups listed under "Saved setups". */
  setSetups(setups: SetupOption[]): void;
  /** Checks a chosen setup: resolves with the reasons it can't be played, empty when it can. Start waits for it. */
  onCheckSetup(cb: (id: string) => Promise<string[]>): void;
  /** Called with a setup's id when the player deletes it; omit to offer no Delete. */
  onDeleteSetup(cb: (id: string) => void): void;
  /** Called whenever the dialog closes, started or not. */
  onClose(cb: () => void): void;
}

const CUSTOM = 'Custom';
const SETUP_PREFIX = 'setup:';
const CHECKING = 'Checking setup…';
const MAX_CUSTOM_MINUTES = 180;
const MAX_CUSTOM_INCREMENT_S = 60;

// Props are plain DOM properties (textContent, value, ...); text always goes through textContent.
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props);
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const l = el('label', { className: 'field' });
  l.append(el('span', { textContent: label }), control);
  return l;
}

export function createPlayDialog(host: HTMLElement): PlayDialog {
  const dialog = el('dialog', { className: 'play-dialog' });
  dialog.dataset.testid = 'play-dialog';
  const form = el('form', { method: 'dialog' });

  const variant = el('select', { id: 'play-variant' });
  const curatedGroup = el('optgroup', { label: 'Variants' });
  for (const v of CURATED_VARIANTS) curatedGroup.append(el('option', { value: v.id, textContent: v.label }));
  const setupGroup = el('optgroup', { label: 'Saved setups' });
  variant.append(curatedGroup, setupGroup);
  const blurb = el('p', { className: 'blurb' });
  const setupStatus = el('p', { className: 'setup-status' });
  setupStatus.dataset.testid = 'setup-status';
  setupStatus.setAttribute('aria-live', 'polite');
  const deleteSetup = el('button', { type: 'button', className: 'secondary small', textContent: 'Delete setup' });
  deleteSetup.dataset.testid = 'delete-setup';
  // Deleting asks first, inline: the question names the setup (the player's text, via textContent).
  const deleteConfirm = el('div', { className: 'delete-confirm' });
  deleteConfirm.dataset.testid = 'delete-confirm';
  const deleteQuestion = el('span');
  const deleteYes = el('button', { type: 'button', className: 'small', textContent: 'Yes, delete' });
  deleteYes.dataset.testid = 'delete-setup-yes';
  const deleteNo = el('button', { type: 'button', className: 'secondary small', textContent: 'No' });
  deleteNo.dataset.testid = 'delete-setup-no';
  deleteConfirm.append(deleteQuestion, deleteYes, deleteNo);
  deleteConfirm.hidden = true;

  const opponent = el('select', { id: 'play-opponent' });
  opponent.append(el('option', { value: 'hotseat', textContent: 'Hot-seat (two players)' }));
  const aiGroup = el('optgroup');
  for (const level of AI_LEVELS) {
    const elo = level.elo === null ? 'full strength' : `~${level.elo}`;
    aiGroup.append(el('option', { value: level.id, textContent: `AI: ${level.label} (${elo})` }));
  }
  opponent.append(aiGroup);
  const engineStatus = el('p', { className: 'engine-status' });
  engineStatus.dataset.testid = 'engine-status';

  const color = el('select', { id: 'play-color' });
  for (const [value, text] of [['white', 'White'], ['black', 'Black'], ['random', 'Random']]) {
    color.append(el('option', { value, textContent: text }));
  }
  const colorField = field('You play', color);

  const clock = el('select', { id: 'play-clock' });
  for (const p of [...CLOCK_PRESETS.map((p) => p.label), CUSTOM]) clock.append(el('option', { value: p, textContent: p }));
  const minutes = el('input', { id: 'play-minutes', type: 'number', min: '1', max: String(MAX_CUSTOM_MINUTES), value: '10' });
  const increment = el('input', { id: 'play-increment', type: 'number', min: '0', max: String(MAX_CUSTOM_INCREMENT_S), value: '0' });
  const custom = el('div', { className: 'custom-clock' });
  custom.append(field('Minutes', minutes), field('Increment (s)', increment));

  const start = el('button', { type: 'submit', textContent: 'Start', value: 'start' });
  const cancel = el('button', { type: 'button', textContent: 'Cancel', className: 'secondary' });
  const actions = el('div', { className: 'actions' });
  actions.append(cancel, start);

  form.append(
    el('h2', { textContent: 'New game' }),
    field('Variant', variant),
    blurb,
    setupStatus,
    deleteSetup,
    deleteConfirm,
    field('Opponent', opponent),
    engineStatus,
    colorField,
    field('Clock', clock),
    custom,
    actions,
  );
  dialog.append(form);
  host.append(dialog);

  let startListener: (c: PlayChoice) => void = () => {};
  let closeListener: () => void = () => {};
  let checkListener: (id: string) => Promise<string[]> = async () => [];
  let deleteListener: ((id: string) => void) | null = null;
  let aiUsable = true;
  let setups: SetupOption[] = [];
  /** Bumped by every new setup choice, so a slower earlier check can't overwrite a later one. */
  let checkToken = 0;
  let setupBlocked = false;

  const chosenSetup = (): SetupOption | undefined =>
    variant.value.startsWith(SETUP_PREFIX) ? setups.find((x) => SETUP_PREFIX + x.id === variant.value) : undefined;

  const refresh = () => {
    const setup = chosenSetup();
    blurb.textContent = setup ? setup.blurb : (CURATED_VARIANTS.find((v) => v.id === variant.value)?.blurb ?? '');
    const deletable = !!setup && !!deleteListener && setup.id !== EDITOR_SETUP_ID;
    if (!deletable) deleteConfirm.hidden = true;
    deleteSetup.hidden = !deletable || !deleteConfirm.hidden;
    colorField.hidden = opponent.value === 'hotseat';
    custom.hidden = clock.value !== CUSTOM;
    start.disabled = setupBlocked;
  };

  /** A chosen setup is registered (the engine may need to check it) before Start is allowed. */
  const checkChosen = () => {
    const token = ++checkToken;
    const setup = chosenSetup();
    setupStatus.classList.remove('error');
    if (!setup) {
      setupBlocked = false;
      setupStatus.textContent = '';
      return refresh();
    }
    setupBlocked = true;
    setupStatus.textContent = CHECKING;
    refresh();
    void checkListener(setup.id).then(
      (problems) => {
        if (token !== checkToken) return;
        setupBlocked = problems.length > 0;
        setupStatus.textContent = problems.join(' ');
        setupStatus.classList.toggle('error', setupBlocked);
        refresh();
      },
      (e: unknown) => {
        if (token !== checkToken) return;
        setupStatus.textContent = `This setup couldn't be checked: ${e instanceof Error ? e.message : String(e)}`;
        setupStatus.classList.add('error');
        refresh();
      },
    );
  };

  const fillSetups = () => {
    const chosen = variant.value;
    setupGroup.replaceChildren(...setups.map((x) => el('option', { value: SETUP_PREFIX + x.id, textContent: x.name })));
    setupGroup.hidden = setups.length === 0;
    variant.value = chosen;
    if (variant.value !== chosen) variant.value = CURATED_VARIANTS[0]!.id;
  };

  deleteSetup.addEventListener('click', () => {
    const setup = chosenSetup();
    if (!setup) return;
    deleteQuestion.textContent = `Delete “${setup.name}”?`;
    deleteConfirm.hidden = false;
    refresh();
  });
  deleteNo.addEventListener('click', () => {
    deleteConfirm.hidden = true;
    refresh();
  });
  deleteYes.addEventListener('click', () => {
    const setup = chosenSetup();
    deleteConfirm.hidden = true;
    if (setup && deleteListener) deleteListener(setup.id);
    refresh();
  });
  variant.addEventListener('change', () => {
    deleteConfirm.hidden = true;
    checkChosen();
  });
  opponent.addEventListener('change', refresh);
  clock.addEventListener('change', refresh);
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => closeListener());

  const clockChoice = (): ClockConfig => {
    if (clock.value !== CUSTOM) return CLOCK_PRESETS.find((p) => p.label === clock.value)?.config ?? null;
    const m = Math.min(MAX_CUSTOM_MINUTES, Math.max(1, Number(minutes.value) || 1));
    const s = Math.min(MAX_CUSTOM_INCREMENT_S, Math.max(0, Number(increment.value) || 0));
    return { baseMs: m * 60000, incrementMs: s * 1000 };
  };

  form.addEventListener('submit', (e) => {
    if (setupBlocked) {
      e.preventDefault();
      return;
    }
    const level = opponent.value;
    const setup = chosenSetup();
    startListener({
      variant: setup ? { kind: 'setup', id: setup.id } : { kind: 'curated', id: variant.value as VariantId },
      opponent: level === 'hotseat' ? { kind: 'hotseat' } : { kind: 'ai', level: level as AiLevelId },
      color: color.value as PlayChoice['color'],
      clockConfig: clockChoice(),
    });
  });

  return {
    open(d) {
      deleteConfirm.hidden = true;
      variant.value = d.variant.kind === 'setup' ? SETUP_PREFIX + d.variant.id : d.variant.id;
      if (!variant.value) variant.value = CURATED_VARIANTS[0]!.id; // a setup that has since been deleted
      opponent.value = d.opponent.kind === 'ai' && aiUsable ? d.opponent.level : 'hotseat';
      color.value = d.color;
      const preset = CLOCK_PRESETS.find(
        (p) => p.config?.baseMs === d.clockConfig?.baseMs && p.config?.incrementMs === d.clockConfig?.incrementMs,
      );
      clock.value = preset ? preset.label : CUSTOM;
      if (!preset && d.clockConfig) {
        minutes.value = String(Math.round(d.clockConfig.baseMs / 60000));
        increment.value = String(Math.round(d.clockConfig.incrementMs / 1000));
      }
      checkChosen();
      dialog.showModal();
    },
    setSetups(next) {
      setups = next;
      const before = variant.value;
      fillSetups();
      if (dialog.open && variant.value !== before) checkChosen();
      else refresh();
    },
    onCheckSetup(cb) {
      checkListener = cb;
    },
    onDeleteSetup(cb) {
      deleteListener = cb;
      refresh();
    },
    setEngineStatus(status, reason) {
      aiUsable = status !== 'unavailable';
      for (const option of aiGroup.querySelectorAll('option')) option.disabled = !aiUsable;
      if (!aiUsable && opponent.value !== 'hotseat') opponent.value = 'hotseat';
      const labels: Record<EngineStatus, string> = {
        loading: 'Engine loading…',
        ready: 'Engine ready',
        unavailable: 'Engine unavailable',
      };
      aiGroup.label = `AI (${labels[status]})`;
      engineStatus.classList.toggle('error', !aiUsable);
      engineStatus.textContent =
        status === 'unavailable'
          ? `Engine unavailable: ${reason ?? 'it failed to start'}. AI opponents are off; hot-seat still works. Reload the page to retry.`
          : status === 'loading'
            ? 'Engine loading… You can start an AI game now; the AI moves once it is ready.'
            : 'Engine ready';
      refresh();
    },
    onStart(cb) {
      startListener = cb;
    },
    onClose(cb) {
      closeListener = cb;
    },
  };
}
