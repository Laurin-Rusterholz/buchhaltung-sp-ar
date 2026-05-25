// App-Einstieg: Lädt Einstellungen, Geschäftsjahre und startet den Router

import { api } from './api.js';
import { register, start, renderRoute } from './router.js';
import { $, currentYear } from './utils.js';
import { toast } from './components.js';
import { DEFAULT_EINSTELLUNGEN } from './defaults.js';
import { initChat } from './chat.js';
import { startInboxPrefetch } from './inboxPrefetch.js';

import dashboard from './views/dashboard.js';
import assistent from './views/assistent.js';
import inbox from './views/inbox.js';
import buchungen from './views/buchungen.js';
import konten from './views/konten.js';
import sektionen from './views/sektionen.js';
import rechnungen from './views/rechnungen.js';
import belege from './views/belege.js';
import vorlagen from './views/vorlagen.js';
import berichte from './views/berichte.js';
import voranschlag from './views/voranschlag.js';
import geschaeftsjahre from './views/geschaeftsjahre.js';
import einstellungen from './views/einstellungen.js';

// Globaler App-State (klein gehalten)
export const state = {
  einstellungen: { ...DEFAULT_EINSTELLUNGEN },
  jahre: [],
  aktuellesJahr: currentYear(),
  // Vorbefüllte Buchung (z.B. nach AI-Analyse eines Belegs)
  pendingBuchung: null,
};

function persistJahr(jahr) {
  state.aktuellesJahr = jahr;
  localStorage.setItem('aktuellesJahr', String(jahr));
}

function readPersistedJahr() {
  const v = Number(localStorage.getItem('aktuellesJahr'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function showSetupBanner(message) {
  if ($('#cors-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'cors-banner';
  banner.className = 'cors-banner';
  banner.innerHTML = `
    <div>
      <strong>⚠️ Firebase-Setup erforderlich.</strong>
      ${message}
      <a href="#einstellungen">Setup-Anleitung →</a>
    </div>
    <button class="ghost sm" id="cors-banner-close">×</button>
  `;
  document.body.prepend(banner);
  banner.querySelector('#cors-banner-close').onclick = () => banner.remove();
}

function renderJahrSelect() {
  const sel = $('#jahr-select');
  if (!state.jahre.length) {
    sel.innerHTML = `<option value="${state.aktuellesJahr}">${state.aktuellesJahr}</option>`;
  } else {
    sel.innerHTML = state.jahre
      .slice()
      .sort((a, b) => b.jahr - a.jahr)
      .map((j) => `<option value="${j.jahr}" ${j.jahr === state.aktuellesJahr ? 'selected' : ''}>${j.jahr}${j.geschlossen ? ' (geschl.)' : ''}</option>`)
      .join('');
  }
  sel.onchange = () => {
    persistJahr(Number(sel.value));
    renderRoute();
  };
}

async function bootstrap() {
  try {
    const [einst, jahre] = await Promise.all([
      api.getEinstellungen(),
      api.listJahre(),
    ]);
    state.einstellungen = einst;
    state.jahre = jahre;

    if (einst?.name) {
      $('#brand').textContent = einst.name;
      document.title = `Buchhaltung – ${einst.name}`;
    }
    if (einst?.untertitel) $('#brand-subtitle').textContent = einst.untertitel;

    const persisted = readPersistedJahr();
    const exists = jahre.find((j) => j.jahr === persisted);
    if (exists) state.aktuellesJahr = exists.jahr;
    else if (jahre.length) state.aktuellesJahr = jahre[jahre.length - 1].jahr;

    renderJahrSelect();

    // Im Hintergrund: erst nicht-synchronisierte Rechnungen ans Portal
    // nachsenden, dann den Status-Sync (bezahlt-Rückmeldungen aus Quantus
    // → Zahlungsbuchungen werden automatisch erstellt).
    api.retrySyncRechnungen()
      .catch((err) => console.warn('Rechnungs-Retry fehlgeschlagen:', err))
      .finally(() => {
        api.syncRechnungenFromPortal().then((res) => {
          if (res?.processed > 0) {
            toast(`${res.processed} Zahlungseingang/-eingänge automatisch verbucht`, 'success');
          }
        }).catch((err) => console.warn('Rechnungs-Sync fehlgeschlagen:', err));
      });
  } catch (err) {
    console.error(err);
    if (err?.code === 'firestore/disabled') {
      showSetupBanner('Firestore ist im Projekt <code>jupidu-36804</code> noch nicht aktiviert.');
    } else if (err?.code === 'firestore/permission' || err?.code === 'firestore/auth') {
      showSetupBanner('Firestore Security Rules sperren den Zugriff.');
    } else {
      toast(`Initialisierung fehlgeschlagen: ${err.message}`, 'error');
    }
  }
}

export async function reloadJahre() {
  state.jahre = await api.listJahre();
  if (!state.jahre.find((j) => j.jahr === state.aktuellesJahr)) {
    state.aktuellesJahr = state.jahre[state.jahre.length - 1]?.jahr || currentYear();
  }
  renderJahrSelect();
}

// Routen registrieren
register('dashboard', dashboard);
register('assistent', assistent);
register('inbox', inbox);
register('buchungen', buchungen);
register('konten', konten);
register('sektionen', sektionen);
register('rechnungen', rechnungen);
register('belege', belege);
register('vorlagen', vorlagen);
register('voranschlag', voranschlag);
register('berichte', berichte);
register('geschaeftsjahre', geschaeftsjahre);
register('einstellungen', einstellungen);

bootstrap().then(() => {
  start();
  initChat();
  // Hintergrund-KI: alle neuen Belege ohne KI-Vorschlag werden direkt analysiert
  // und das Ergebnis wird in Firestore persistiert. Beim nächsten Öffnen der
  // Inbox sind die Vorschläge schon da.
  setTimeout(() => startInboxPrefetch(), 1500);
  // Alle 5 Min nachschauen, ob neue Belege eingetroffen sind.
  setInterval(() => startInboxPrefetch(), 5 * 60 * 1000);
});
