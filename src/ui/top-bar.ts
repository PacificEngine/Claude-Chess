// The top bar: Play, Tutorial, Editor and Settings. The tutorial arrives in a later plan, so it is disabled.
export interface TopBarHandlers {
  play(): void;
  editor(): void;
  settings(): void;
}

export function createTopBar(host: HTMLElement, handlers: TopBarHandlers): void {
  const bar = document.createElement('header');
  bar.className = 'top-bar';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = 'Chess';
  const nav = document.createElement('nav');
  const button = (id: string, text: string, onClick?: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.testid = `top-${id}`;
    b.textContent = text;
    if (onClick) b.addEventListener('click', onClick);
    else {
      b.disabled = true;
      b.title = 'Coming soon';
    }
    nav.append(b);
  };
  button('play', 'Play', handlers.play);
  button('tutorial', 'Tutorial');
  button('editor', 'Editor', handlers.editor);
  button('settings', 'Settings', handlers.settings);
  bar.append(title, nav);
  host.append(bar);
}
