// Hintergrund-Analyse aller Inbox-Belege: sobald die App offen ist, läuft
// für jeden Beleg ohne KI-Vorschlag eine analyzeBelegFromUrl-Anfrage und
// das Ergebnis wird in der `inbox-state` Collection persistiert. Beim
// nächsten Öffnen ist alles schon ausgefüllt – keine Wartezeit.

import { api } from './api.js';
import { analyzeBelegFromUrl, hasApiKey } from './ai.js';

let _running = false;

// Listener für Status-Updates (z.B. ein Banner oder die Inbox-View)
const _listeners = new Set();
export function onPrefetchProgress(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function emit(status) {
  for (const fn of _listeners) {
    try { fn(status); } catch {}
  }
}

// Startet die Hintergrund-Analyse. Liefert sofort zurück (läuft async weiter).
// Verhindert doppelte parallele Läufe.
export function startInboxPrefetch({ silent = true } = {}) {
  if (_running) return;
  if (!hasApiKey()) return;
  _running = true;
  (async () => {
    let analyzed = 0;
    let skipped = 0;
    let failed = 0;
    try {
      // Buchungen aller verfügbaren Jahre laden – die KI lernt aus den
      // historischen Mustern (max. ~150 letzte Buchungen über alle Jahre,
      // begrenzt durch summarizeBuchungen).
      const jahre = await api.listJahre().catch(() => []);
      const allBuchungen = [];
      for (const j of jahre) {
        try {
          const b = await api.listBuchungen(j.jahr);
          allBuchungen.push(...b);
        } catch {}
      }
      const [portalBelege, konten, inboxState] = await Promise.all([
        api.fetchPortalBelege().catch(() => []),
        api.listKonten().catch(() => []),
        api.getInboxState().catch(() => ({})),
      ]);
      const todo = portalBelege.filter((p) => {
        if (!p.id || !p.firebaseUrl) return false;
        if (p.status === 'abgeschlossen') return false;
        const local = inboxState[p.id];
        // Schon analysiert? Skip.
        if (local?.aiResult) { skipped++; return false; }
        // Schon verbucht? Skip.
        if (local?.buchungId) { skipped++; return false; }
        return true;
      });
      if (todo.length === 0) {
        emit({ phase: 'done', analyzed: 0, total: 0 });
        return;
      }
      emit({ phase: 'start', total: todo.length });
      // Sequentiell um Rate-Limits zu schonen
      for (let i = 0; i < todo.length; i++) {
        const p = todo[i];
        emit({ phase: 'progress', current: i + 1, total: todo.length, beleg: p });
        try {
          const proxyUrl = api.belegProxyUrl(p.id);
          const res = await analyzeBelegFromUrl(proxyUrl, konten, allBuchungen);
          // Snapshot des Belegs für die Inbox: Draft auch direkt vorausfüllen,
          // damit das Pop-up beim Öffnen schon eine kohärente Vorschau zeigt.
          const draft = buildDraftFromAi(p, res);
          await api.saveInboxEntry(p.id, { aiResult: res, draft });
          analyzed++;
        } catch (err) {
          console.warn(`[Inbox-Prefetch] Beleg ${p.id} (${p.fileName || ''}) fehlgeschlagen:`, err);
          failed++;
        }
      }
      emit({ phase: 'done', analyzed, skipped, failed, total: todo.length });
    } catch (err) {
      console.warn('[Inbox-Prefetch] globaler Fehler:', err);
      emit({ phase: 'error', error: err.message });
    } finally {
      _running = false;
    }
  })();
}

// Baut aus Portal-Metadaten + KI-Ergebnis einen vollständigen Draft, der
// im Verbuchen-Pop-up direkt sichtbar ist.
function buildDraftFromAi(portal, ai) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    datum: ai?.datum || (portal.submittedAt ? portal.submittedAt.slice(0, 10) : today),
    beleg_nr: ai?.beleg_nr || '',
    beschreibung: ai?.beschreibung || (ai?.vendor ? String(ai.vendor) : (portal.title || '')),
    soll: ai?.konto_soll || '',
    haben: ai?.konto_haben || '',
    betrag: ai?.betrag || (Number(portal.amount) > 0 ? Number(portal.amount) : ''),
    bezahlt: !!portal.paid,
    faellig_am: ai?.faelligkeit || portal.dueDate || '',
  };
}

export function isPrefetchRunning() { return _running; }
