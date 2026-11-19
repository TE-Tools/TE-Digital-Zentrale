import { render } from 'preact';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/tokens.css';
import './styles/basis.css';
import './styles/rahmen.css';
import './styles/bausteine.css';
import './styles/anmeldung.css';
import { App } from './App';

render(<App />, document.getElementById('app')!);

// Service Worker (PWA): nur im Produktions-Build registrieren
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void import('workbox-window').then(({ Workbox }) => {
    const wb = new Workbox('/sw.js');
    // Neue Version übernommen → einmal neu laden, damit alle Geräte denselben Stand zeigen
    wb.addEventListener('controlling', (e) => {
      if (e.isUpdate) location.reload();
    });
    void wb.register();
  });
}
