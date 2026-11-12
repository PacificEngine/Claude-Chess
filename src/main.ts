import 'chessgroundx/assets/chessground.base.css';
import './ui/styles.css';
import './ui/pieces.css';
import { COI_FALLBACK_MS, coiReloadExpected } from './coi-reload';
import { startApp } from './ui/app';

declare global {
  interface Window {
    /** Set by index.html's coi-serviceworker config the moment it reloads the page. */
    coiReloading?: boolean;
  }
}

const root = document.querySelector<HTMLElement>('#app');
if (root) {
  if (!coiReloadExpected({ crossOriginIsolated: window.crossOriginIsolated, isSecureContext: window.isSecureContext, serviceWorker: navigator.serviceWorker })) {
    void startApp(root);
  } else {
    // The service worker is about to reload the page; start here only if that reload never comes.
    setTimeout(() => {
      if (!window.coiReloading) void startApp(root);
    }, COI_FALLBACK_MS);
  }
}
