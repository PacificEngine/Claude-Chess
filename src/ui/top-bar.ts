// The top bar: Play, Tutorial, Editor and Settings. Tutorial and Editor arrive in later plans, so they are disabled.
export interface TopBarHandlers {
  play(): void;
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
  button('editor', 'Editor');
  button('settings', 'Settings', handlers.settings);
  bar.append(title, nav);
  host.append(bar);
}
