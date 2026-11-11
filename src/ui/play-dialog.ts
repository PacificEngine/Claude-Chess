// The Play dialog: variant, opponent (an AI level or hot-seat), the player's color, and the clock.
// It only collects choices; app.ts turns them into a GameSession.
import type { EngineStatus } from '../engine/engine';
import { AI_LEVELS, type AiLevelId } from '../engine/levels';
import { CLOCK_PRESETS, type ClockConfig } from '../session/clock';
import { CURATED_VARIANTS, type VariantId } from '../variants/catalog';

export interface PlayChoice {
  variant: VariantId;
  opponent: { kind: 'hotseat' } | { kind: 'ai'; level: AiLevelId };
  /** The human's color against the AI. Ignored for hot-seat. */
  color: 'white' | 'black' | 'random';
  clockConfig: ClockConfig;
}

export interface PlayDialog {
  open(defaults: PlayChoice): void;
  setEngineStatus(status: EngineStatus, reason?: string): void;
  onStart(cb: (choice: PlayChoice) => void): void;
  /** Called whenever the dialog closes, started or not. */
  onClose(cb: () => void): void;
}

const CUSTOM = 'Custom';
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
  for (const v of CURATED_VARIANTS) variant.append(el('option', { value: v.id, textContent: v.label }));
  const blurb = el('p', { className: 'blurb' });

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
  let aiUsable = true;

  const refresh = () => {
    blurb.textContent = CURATED_VARIANTS.find((v) => v.id === variant.value)?.blurb ?? '';
    colorField.hidden = opponent.value === 'hotseat';
    custom.hidden = clock.value !== CUSTOM;
  };
  variant.addEventListener('change', refresh);
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

  form.addEventListener('submit', () => {
    const level = opponent.value;
    startListener({
      variant: variant.value as VariantId,
      opponent: level === 'hotseat' ? { kind: 'hotseat' } : { kind: 'ai', level: level as AiLevelId },
      color: color.value as PlayChoice['color'],
      clockConfig: clockChoice(),
    });
  });

  return {
    open(d) {
      variant.value = d.variant;
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
      refresh();
      dialog.showModal();
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
