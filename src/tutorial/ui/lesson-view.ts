// The lesson panel (layout A): the title and track, the step markers, the step's heading and instruction, the
// feedback line, and Hint, Restart, Next and All lessons. It renders what the tutorial tells it and holds no
// lesson state. Every text is set with textContent: lesson text is never HTML.

export type StepState = 'done' | 'current' | 'todo';

export interface LessonViewState {
  title: string;
  /** The track's name, e.g. "Chess basics". */
  track: string;
  steps: { title: string; state: StepState }[];
  /** The step on screen; its marker is the current one even when it is done. */
  current: number;
  /** e.g. "See it", "Strategy 1 of 2" or "Puzzle 1 of 4". */
  heading: string;
  instruction: string;
  feedback: string;
  canHint: boolean;
  canRestart: boolean;
  canNext: boolean;
  /** "Next", or "Next lesson" once the lesson's last puzzle is solved. */
  nextLabel: string;
}

export interface LessonViewHandlers {
  step(index: number): void;
  hint(): void;
  restart(): void;
  next(): void;
  all(): void;
}

export interface LessonView {
  render(s: LessonViewState): void;
}

function button(label: string, testid: string, onClick: () => void, className = 'secondary'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.dataset.testid = testid;
  b.addEventListener('click', onClick);
  return b;
}

export function createLessonView(host: HTMLElement, handlers: LessonViewHandlers): LessonView {
  const panel = document.createElement('aside');
  panel.className = 'lesson-panel';
  const track = document.createElement('div');
  track.className = 'lesson-track';
  const title = document.createElement('h2');
  title.className = 'lesson-title';
  title.dataset.testid = 'lesson-title';
  const markers = document.createElement('ol');
  markers.className = 'lesson-steps';
  const heading = document.createElement('h3');
  heading.className = 'lesson-heading';
  heading.dataset.testid = 'lesson-heading';
  const instruction = document.createElement('p');
  instruction.className = 'lesson-instruction';
  instruction.dataset.testid = 'lesson-instruction';
  const feedback = document.createElement('p');
  feedback.className = 'lesson-feedback';
  feedback.dataset.testid = 'lesson-feedback';
  feedback.setAttribute('role', 'status');
  const hint = button('Hint', 'lesson-hint', () => handlers.hint());
  const restart = button('Restart', 'lesson-restart', () => handlers.restart());
  const next = button('Next', 'lesson-next', () => handlers.next(), '');
  const all = button('All lessons', 'lesson-all', () => handlers.all());
  const buttons = document.createElement('div');
  buttons.className = 'lesson-buttons';
  buttons.append(hint, restart, next);
  panel.append(track, title, markers, heading, instruction, feedback, buttons, all);
  host.append(panel);

  return {
    render(s) {
      track.textContent = s.track;
      title.textContent = s.title;
      markers.replaceChildren(
        ...s.steps.map((step, i) => {
          const li = document.createElement('li');
          const marker = button(step.title, `step-${i}`, () => handlers.step(i), 'lesson-step');
          marker.dataset.state = step.state;
          if (i === s.current) marker.setAttribute('aria-current', 'step');
          li.append(marker);
          return li;
        }),
      );
      heading.textContent = s.heading;
      instruction.textContent = s.instruction;
      feedback.textContent = s.feedback;
      hint.disabled = !s.canHint;
      restart.disabled = !s.canRestart;
      next.disabled = !s.canNext;
      next.textContent = s.nextLabel;
    },
  };
}
