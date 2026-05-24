// App-Einstieg: Lädt Einstellungen, Geschäftsjahre und startet den Router

import { api } from './api.js';
import { register, start, renderRoute } from './router.js';
import { $, currentYear } from './utils.js';
import { toast } from './components.js';
import { DEFAULT_EINSTELLUNGEN } from './defaults.js';

import dashboard from './views/dashboard.js';
import buchungen from './views/buchungen.js';
import konten from './views/konten.js';
import mitglieder from './views/mitglieder.js';
import rechnungen from './views/rechnungen.js';
import belege from './views/belege.js';
import berichte from './views/berichte.js';
import geschaeftsjahre from './views/geschaeftsjahre.js';
import einstellungen from './views/einstellungen.js';

// Globaler App-State (klein gehalten)
export const state = {
  einstellungen: { ...DEFAULT_EINSTELLUNGEN },
  jahre: [],
  aktuellesJahr: currentYear(),
};

function persistJahr(jahr) {
  state.aktuellesJahr = jahr;
  localStorage.setItem('aktuellesJahr', String(jahr));
}

function readPersistedJahr() {
  const v = Number(localStorage.getItem('aktuellesJahr'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function showCorsBanner() {
  if ($('#cors-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'cors-banner';
  banner.className = 'cors-banner';
  banner.innerHTML = `
    <div>
      <strong>⚠️ Firebase Storage CORS nicht konfiguriert.</strong>
      Daten können nicht geladen werden, bis CORS auf dem Bucket
      <code>jupidu-36804.firebasestorage.app</code> erlaubt ist.
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
  } catch (err) {
    console.error(err);
    if (err?.code === 'firebase/cors') {
      showCorsBanner();
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
register('buchungen', buchungen);
register('konten', konten);
register('mitglieder', mitglieder);
register('rechnungen', rechnungen);
register('belege', belege);
register('berichte', berichte);
register('geschaeftsjahre', geschaeftsjahre);
register('einstellungen', einstellungen);

bootstrap().then(() => start());
