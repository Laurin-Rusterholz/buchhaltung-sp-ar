// Inbox: zeigt eingegangene Belege aus dem sp-ar-belege Portal.
// Pro Beleg ein Buchungsvorschlag (KI), den der Kassier prüft und verbucht.
// Der Beleg wird erst dann verbucht, wenn er bezahlt ist.

import { api } from '../api.js';
import { state, reloadJahre } from '../main.js';
import { escapeHtml, formatChf, formatDate, todayIso, parseHash } from '../utils.js';
import { modal, toast, confirmDialog, enhanceSelect } from '../components.js';
import { analyzeBelegFromUrl, hasApiKey } from '../ai.js';
import { startInboxPrefetch, onPrefetchProgress, isPrefetchRunning } from '../inboxPrefetch.js';

// Bestimmt den UI-Status eines Eintrags aus Portal-Status + lokalem Inbox-State.
function entryStatus(portal, local) {
  if (portal.status === 'abgeschlossen' || local?.buchungId) return 'abgeschlossen';
  if (local?.draft) return 'in-bearbeitung';
  return 'neu';
}

function statusBadge(status) {
  if (status === 'abgeschlossen') return '<span class="badge success">Verbucht</span>';
  if (status === 'in-bearbeitung') return '<span class="badge warning">In Bearbeitung</span>';
  return '<span class="badge muted">Neu</span>';
}

function paidBadge(paid) {
  return paid
    ? '<span class="badge success">Bezahlt</span>'
    : '<span class="badge danger">Offen</span>';
}

function fileIcon(mime, name = '') {
  if ((mime || '').startsWith('image/')) return '🖼️';
  if ((mime || '').includes('pdf') || /\.pdf$/i.test(name)) return '📄';
  return '📎';
}

export default {
  async render(container, params = {}) {
    container.innerHTML = `
      <div class="page-header">
        <h2>Inbox – Eingegangene Belege</h2>
        <div class="actions">
          <button id="refresh">↻ Aktualisieren</button>
          <button id="prefetch" class="ai">✨ KI-Vorschläge generieren</button>
          <button id="upload" class="primary">+ Beleg hochladen</button>
        </div>
      </div>
      <div id="prefetch-banner" class="ai-result hidden"></div>
      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen…" />
          <select id="filter-status">
            <option value="offen">Offen + In Bearbeitung</option>
            <option value="alle">Alle</option>
            <option value="neu">Nur Neu</option>
            <option value="in-bearbeitung">Nur in Bearbeitung</option>
            <option value="abgeschlossen">Nur Verbucht</option>
          </select>
          <div class="spacer"></div>
          <div class="muted small" id="count"></div>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Eingang</th>
                <th>Titel / Einreicher</th>
                <th class="num">Betrag CHF</th>
                <th>Fällig</th>
                <th>Bezahlt</th>
                <th>Status</th>
                <th>Beleg</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="rows"></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = container.querySelector('#rows');
    const filter = container.querySelector('#filter');
    const filterStatus = container.querySelector('#filter-status');
    const countEl = container.querySelector('#count');
    const refreshBtn = container.querySelector('#refresh');

    let portalBelege = [];
    let inboxState = {};

    async function loadAll() {
      tbody.innerHTML = '<tr><td colspan="8" class="muted center">Lädt Belege vom Portal…</td></tr>';
      try {
        const [belege, st] = await Promise.all([
          api.fetchPortalBelege(),
          api.getInboxState(),
        ]);
        portalBelege = belege;
        inboxState = st || {};
        renderRows();
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="muted center">Fehler beim Laden: ${escapeHtml(err.message)}</td></tr>`;
      }
    }

    function renderRows() {
      const q = filter.value.toLowerCase();
      const sf = filterStatus.value;
      const entries = portalBelege.map((p) => {
        const local = inboxState[p.id] || null;
        const st = entryStatus(p, local);
        return { portal: p, local, status: st };
      });
      const filtered = entries.filter((e) => {
        if (sf === 'offen' && e.status === 'abgeschlossen') return false;
        if (sf === 'neu' && e.status !== 'neu') return false;
        if (sf === 'in-bearbeitung' && e.status !== 'in-bearbeitung') return false;
        if (sf === 'abgeschlossen' && e.status !== 'abgeschlossen') return false;
        if (q) {
          const text = `${e.portal.title || ''} ${e.portal.name || ''} ${e.portal.fileName || ''} ${e.portal.comment || ''}`.toLowerCase();
          if (!text.includes(q)) return false;
        }
        return true;
      });

      countEl.textContent = `${filtered.length} von ${portalBelege.length}`;
      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="muted center">Keine Belege in dieser Sicht.</td></tr>';
        return;
      }
      tbody.innerHTML = filtered.map(({ portal: p, local, status }) => {
        const eingang = p.submittedAt || p.createdAt;
        const draftAmount = local?.draft?.betrag ?? p.amount;
        const draftDue = local?.draft?.faellig_am || p.dueDate || '';
        const paid = local?.draft?.bezahlt ?? p.paid;
        const fileLink = p.firebaseUrl && p.firebaseUrl.startsWith('http')
          ? `<a href="${escapeHtml(p.firebaseUrl)}" target="_blank" rel="noopener">${fileIcon(p.fileType, p.fileName)} ${escapeHtml(p.fileName || 'Beleg')}</a>`
          : '<span class="muted small">—</span>';
        return `
          <tr class="row-clickable" data-open-row="${escapeHtml(p.id)}">
            <td>${escapeHtml(formatDate(eingang))}</td>
            <td>
              <strong>${escapeHtml(p.title || p.fileName || 'Beleg')}</strong>
              ${p.name && p.name !== 'Unbekannt' ? `<div class="muted small">${escapeHtml(p.name)}</div>` : ''}
              ${p.comment ? `<div class="muted small">${escapeHtml(p.comment)}</div>` : ''}
            </td>
            <td class="num">${draftAmount ? formatChf(draftAmount) : '<span class="muted small">—</span>'}</td>
            <td>${draftDue ? escapeHtml(formatDate(draftDue)) : '<span class="muted small">—</span>'}</td>
            <td>${paidBadge(paid)}</td>
            <td>${statusBadge(status)}</td>
            <td>${fileLink}</td>
            <td class="right">
              <button class="sm primary" data-open="${escapeHtml(p.id)}">${status === 'abgeschlossen' ? 'Ansehen' : 'Verbuchen'}</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    filter.oninput = renderRows;
    filterStatus.onchange = renderRows;
    refreshBtn.onclick = loadAll;

    // Prefetch-Banner: zeigt Fortschritt der Hintergrund-KI-Analyse
    const prefetchBanner = container.querySelector('#prefetch-banner');
    const prefetchBtn = container.querySelector('#prefetch');
    function setBanner(html) {
      if (html) { prefetchBanner.innerHTML = html; prefetchBanner.classList.remove('hidden'); }
      else prefetchBanner.classList.add('hidden');
    }
    const offProgress = onPrefetchProgress((s) => {
      if (s.phase === 'start') {
        setBanner(`✨ KI analysiert ${s.total} Beleg${s.total === 1 ? '' : 'e'} im Hintergrund…`);
      } else if (s.phase === 'progress') {
        setBanner(`✨ KI: Beleg ${s.current} / ${s.total} – <em>${escapeHtml(s.beleg?.title || s.beleg?.fileName || '…')}</em>`);
      } else if (s.phase === 'done') {
        if (s.analyzed > 0) {
          setBanner(`✓ ${s.analyzed} neue KI-Vorschläge erstellt.`);
          setTimeout(() => setBanner(''), 4000);
          loadAll();  // mit den neuen aiResult anzeigen
        } else {
          setBanner('');
        }
      } else if (s.phase === 'error') {
        setBanner(`<span style="color:var(--color-danger)">KI-Hintergrund-Fehler: ${escapeHtml(s.error)}</span>`);
      }
    });
    // Cleanup: kein Memory-Leak wenn man die View verlässt
    container.addEventListener('view-unmount', () => offProgress(), { once: true });

    prefetchBtn.onclick = () => {
      if (isPrefetchRunning()) { toast('KI läuft schon im Hintergrund…', 'info'); return; }
      startInboxPrefetch();
    };

    container.querySelector('#upload').onclick = () => openUploadForm();
    // Beim Öffnen der Inbox direkt einen Lauf anstossen (falls neue Belege da sind)
    setTimeout(() => startInboxPrefetch(), 300);

    tbody.addEventListener('click', async (e) => {
      // Klick auf den Verbuchen-Button (Standardfall)
      const openId = e.target?.dataset?.open;
      if (openId) { await openEntry(openId); return; }
      // Klick irgendwo in der Zeile → ebenfalls öffnen, aber nicht wenn auf
      // den Datei-Link geklickt wurde (der soll separat im neuen Tab aufgehen).
      if (e.target.closest('a')) return;
      const row = e.target.closest('[data-open-row]');
      if (row) await openEntry(row.dataset.openRow);
    });

    // Direkt-Upload eines neuen Belegs aus der Buchhaltung. Lädt die Datei
    // in Firebase Storage und registriert sie im sp-ar-belege Portal,
    // sodass sie wie ein extern eingereichter Beleg in der Inbox erscheint.
    function openUploadForm() {
      const today = todayIso();
      const m = modal({
        title: '📥 Beleg direkt hochladen',
        body: `
          <p class="muted small">Datei wird in den gemeinsamen Beleg-Pool hochgeladen
          und erscheint anschliessend in der Inbox. Die KI analysiert den Beleg
          automatisch im Hintergrund.</p>
          <div class="form-grid">
            <div class="input-group full">
              <label>Datei (PDF, JPG, PNG, …) <span style="color:var(--color-danger)">*</span></label>
              <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.heic,.webp" />
            </div>
            <div class="input-group full">
              <label>Titel / Beleg-Bezeichnung</label>
              <input name="title" placeholder="z.B. Druckkosten Flyer (leer = Dateiname)" />
            </div>
            <div class="input-group">
              <label>Einreicher / Notiz</label>
              <input name="submitter" placeholder="z.B. Kassier direkt" />
            </div>
            <div class="input-group">
              <label>Betrag CHF (optional)</label>
              <input name="amount" type="number" step="0.05" min="0" placeholder="Optional" />
            </div>
            <div class="input-group">
              <label>Fällig am (optional)</label>
              <input name="dueDate" type="date" />
            </div>
            <div class="input-group">
              <label class="flex center gap-4" style="cursor:pointer;padding-top:8px">
                <input name="paid" type="checkbox" style="width:auto" />
                <span>Bereits bezahlt</span>
              </label>
            </div>
            <div class="input-group full">
              <label>Kommentar (optional)</label>
              <textarea name="comment" placeholder="Zusätzliche Hinweise…"></textarea>
            </div>
            <div class="input-group full">
              <div id="upload-progress" class="muted small hidden">
                Lädt hoch… <span id="upload-pct">0%</span>
              </div>
            </div>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Hochladen</button>`,
      });
      const fileInput = m.bodyEl.querySelector('[name="file"]');
      const progressEl = m.bodyEl.querySelector('#upload-progress');
      const pctEl = m.bodyEl.querySelector('#upload-pct');
      const saveBtn = m.footerEl.querySelector('[data-save]');

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      saveBtn.onclick = async () => {
        const file = fileInput.files?.[0];
        if (!file) { toast('Bitte Datei wählen', 'error'); return; }
        if (file.size > 50 * 1024 * 1024) { toast('Datei zu gross (max. 50 MB)', 'error'); return; }
        const meta = {
          title: m.bodyEl.querySelector('[name="title"]').value.trim(),
          name: m.bodyEl.querySelector('[name="submitter"]').value.trim(),
          amount: m.bodyEl.querySelector('[name="amount"]').value,
          dueDate: m.bodyEl.querySelector('[name="dueDate"]').value,
          paid: m.bodyEl.querySelector('[name="paid"]').checked,
          comment: m.bodyEl.querySelector('[name="comment"]').value.trim(),
        };
        saveBtn.disabled = true;
        progressEl.classList.remove('hidden');
        try {
          const res = await api.uploadBelegToPortal(file, meta, (p) => {
            pctEl.textContent = `${Math.round(p * 100)}%`;
          });
          toast('Beleg hochgeladen – KI analysiert im Hintergrund.', 'success');
          m.close();
          // Neu laden, damit der Beleg in der Liste erscheint
          await loadAll();
          // Direkt das Verbuchen-Pop-up öffnen – Prefetch startet im
          // Hintergrund, der KI-Vorschlag erscheint im Pop-up sobald fertig.
          startInboxPrefetch();
          setTimeout(() => openEntry(res.id), 300);
        } catch (err) {
          toast('Upload fehlgeschlagen: ' + err.message, 'error');
          saveBtn.disabled = false;
          progressEl.classList.add('hidden');
        }
      };
    }

    async function openEntry(spArId) {
      const portal = portalBelege.find((p) => p.id === spArId);
      if (!portal) { toast('Beleg nicht (mehr) im Portal vorhanden', 'error'); return; }
      const local = inboxState[spArId] || null;

      // Bereits verbucht? → die echte Buchung anzeigen
      if (local?.buchungId && local?.buchungJahr) {
        openBuchungAnsicht(portal, local);
        return;
      }

      // Inbox-Buchung erstellen / bearbeiten
      await openVerbuchenForm(portal, local);
    }

    // Pop-up für noch nicht verbuchte Inbox-Belege:
    // KI füllt automatisch, User editiert, "Speichern" (Draft) oder "Verbuchen" (echte Buchung).
    async function openVerbuchenForm(portal, local) {
      const spArId = portal.id;
      const konten = await api.listKonten();
      konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
      const kontoMap = new Map(konten.map((k) => [k.nummer, k]));

      const initialDraft = local?.draft || {
        datum: portal.submittedAt ? portal.submittedAt.slice(0, 10) : todayIso(),
        beleg_nr: '',
        beschreibung: portal.title || '',
        soll: '',
        haben: '',
        betrag: Number(portal.amount) > 0 ? Number(portal.amount) : '',
        bezahlt: !!portal.paid,
        faellig_am: portal.dueDate || '',
      };
      let aiResult = local?.aiResult || null;

      const optionsKonten = konten
        .map((k) => `<option value="${escapeHtml(k.nummer)}">${escapeHtml(k.nummer)} ${escapeHtml(k.bezeichnung)}</option>`)
        .join('');

      const fileLinkInline = portal.firebaseUrl && portal.firebaseUrl.startsWith('http')
        ? `<a href="${escapeHtml(portal.firebaseUrl)}" target="_blank" rel="noopener">${fileIcon(portal.fileType, portal.fileName)} ${escapeHtml(portal.fileName || 'Beleg')} öffnen</a>`
        : '<span class="muted small">Keine Datei verfügbar</span>';

      const m = modal({
        title: 'Buchungsvorschlag aus Inbox',
        body: `
          <div class="ai-result mb-4" id="ai-info" style="display:${hasApiKey() ? 'block' : 'none'}">
            <span id="ai-status">${aiResult ? 'KI-Analyse aus Cache geladen.' : 'KI analysiert Beleg…'}</span>
          </div>
          ${!hasApiKey() ? '<div class="ai-hint muted small mb-4">Hinweis: Kein Claude API-Key in den Einstellungen → KI-Vorschläge sind deaktiviert.</div>' : ''}

          <div class="card" style="background:var(--color-bg);margin-bottom:16px">
            <div class="flex between center" style="margin-bottom:6px">
              <strong>Beleg aus sp-ar-belege</strong>
              ${paidBadge(!!portal.paid)}
            </div>
            <div class="small muted">Eingereicht ${escapeHtml(formatDate(portal.submittedAt || portal.createdAt))}${portal.name && portal.name !== 'Unbekannt' ? ` von ${escapeHtml(portal.name)}` : ''}</div>
            <div style="margin-top:6px">${fileLinkInline}</div>
            ${portal.comment ? `<div class="small muted" style="margin-top:6px">Kommentar: ${escapeHtml(portal.comment)}</div>` : ''}
          </div>

          <div class="form-grid">
            <div class="input-group">
              <label>Datum</label>
              <input name="datum" type="date" value="${escapeHtml(initialDraft.datum || '')}" />
            </div>
            <div class="input-group">
              <label>Beleg-Nr</label>
              <input name="beleg_nr" value="${escapeHtml(initialDraft.beleg_nr || '')}" placeholder="z.B. 2025-001" />
            </div>
            <div class="input-group full">
              <label>Beschreibung</label>
              <input name="beschreibung" value="${escapeHtml(initialDraft.beschreibung || '')}" />
            </div>
            <div class="input-group">
              <label>Soll-Konto</label>
              <select name="soll"><option value="">— wählen —</option>${optionsKonten}</select>
            </div>
            <div class="input-group">
              <label>Haben-Konto</label>
              <select name="haben"><option value="">— wählen —</option>${optionsKonten}</select>
            </div>
            <div class="input-group">
              <label>Betrag CHF</label>
              <input name="betrag" type="number" step="0.05" min="0" value="${escapeHtml(initialDraft.betrag ?? '')}" />
            </div>
            <div class="input-group">
              <label>Fällig am</label>
              <input name="faellig_am" type="date" value="${escapeHtml(initialDraft.faellig_am || '')}" />
            </div>
            <div class="input-group full">
              <label class="flex center gap-4" style="cursor:pointer">
                <input name="bezahlt" type="checkbox" style="width:auto" ${initialDraft.bezahlt ? 'checked' : ''} />
                <span><strong>Bezahlt</strong> – nur dann kann verbucht (= abgeschlossen) werden.</span>
              </label>
            </div>
          </div>
        `,
        footer: `
          <button data-cancel>Abbrechen</button>
          <button data-save>Zwischenspeichern</button>
          <button class="primary" data-verbuchen ${initialDraft.bezahlt ? '' : 'disabled'}>Verbuchen (Buchung erstellen)</button>
        `,
      });

      // Selects nach dem Einfügen setzen
      m.bodyEl.querySelector('[name="soll"]').value = initialDraft.soll || '';
      m.bodyEl.querySelector('[name="haben"]').value = initialDraft.haben || '';

      // Selects zu durchsuchbaren Comboboxes aufwerten – User kann nach
      // Nummer ODER Bezeichnung tippen.
      enhanceSelect(m.bodyEl.querySelector('[name="soll"]'), { placeholder: 'Soll-Konto suchen…' });
      enhanceSelect(m.bodyEl.querySelector('[name="haben"]'), { placeholder: 'Haben-Konto suchen…' });

      const aiInfo = m.bodyEl.querySelector('#ai-info');
      const aiStatus = m.bodyEl.querySelector('#ai-status');
      const bezahltCb = m.bodyEl.querySelector('[name="bezahlt"]');
      const verbuchenBtn = m.footerEl.querySelector('[data-verbuchen]');
      const saveBtn = m.footerEl.querySelector('[data-save]');

      bezahltCb.onchange = () => {
        verbuchenBtn.disabled = !bezahltCb.checked;
      };

      function applyAi(result) {
        if (!result) return;
        const fields = m.bodyEl;
        // Nur leere Felder mit KI-Daten füllen, sonst die User-Werte respektieren
        const setIfEmpty = (name, value) => {
          const el = fields.querySelector(`[name="${name}"]`);
          if (!el || value == null || value === '') return;
          if (el.tagName === 'SELECT') {
            if (!el.value) el.value = String(value);
          } else if (el.type === 'checkbox') {
            // Nichts – Bezahlt-Status kommt aus sp-ar-belege, nicht aus AI
          } else if (!el.value) {
            el.value = value;
          }
        };
        setIfEmpty('datum', result.datum);
        setIfEmpty('beleg_nr', result.beleg_nr);
        setIfEmpty('beschreibung', result.beschreibung || (result.vendor ? `${result.vendor}` : ''));
        if (result.betrag && !fields.querySelector('[name="betrag"]').value) {
          fields.querySelector('[name="betrag"]').value = result.betrag;
        }
        if (result.faelligkeit && !fields.querySelector('[name="faellig_am"]').value) {
          fields.querySelector('[name="faellig_am"]').value = result.faelligkeit;
        }
        if (result.konto_soll && kontoMap.get(result.konto_soll) && !fields.querySelector('[name="soll"]').value) {
          fields.querySelector('[name="soll"]').value = result.konto_soll;
        }
        if (result.konto_haben && kontoMap.get(result.konto_haben) && !fields.querySelector('[name="haben"]').value) {
          fields.querySelector('[name="haben"]').value = result.konto_haben;
        }
      }

      // Historische Buchungen für die KI (lernt aus den Mustern) – aus allen
      // Geschäftsjahren zusammengezogen.
      async function loadHistoricBuchungen() {
        const jahre = await api.listJahre().catch(() => []);
        const all = [];
        for (const j of jahre) {
          try { all.push(...(await api.listBuchungen(j.jahr))); } catch {}
        }
        return all;
      }

      // KI sofort beim Öffnen ausführen, falls noch nicht im Cache
      if (hasApiKey() && portal.firebaseUrl && portal.firebaseUrl.startsWith('http')) {
        if (aiResult) {
          applyAi(aiResult);
          aiStatus.innerHTML = `KI-Analyse aus Cache: <strong>${escapeHtml(aiResult.vendor || aiResult.beschreibung || '—')}</strong>${aiResult.ist_einnahme ? ' (Einnahme)' : ' (Ausgabe)'}.`;
        } else {
          aiStatus.textContent = 'KI analysiert Beleg (mit Buchungs-Historie als Kontext)…';
          loadHistoricBuchungen().then((buchungen) =>
            analyzeBelegFromUrl(api.belegProxyUrl(spArId), konten, buchungen)
          )
            .then(async (res) => {
              aiResult = res;
              applyAi(res);
              const tags = [];
              if (res.vendor) tags.push(`Anbieter: <strong>${escapeHtml(res.vendor)}</strong>`);
              if (res.betrag) tags.push(`Betrag: <strong>CHF ${escapeHtml(formatChf(res.betrag))}</strong>`);
              if (res.konto_soll) tags.push(`Soll: <strong>${escapeHtml(res.konto_soll)} ${escapeHtml(kontoMap.get(res.konto_soll)?.bezeichnung || '')}</strong>`);
              if (res.konto_haben) tags.push(`Haben: <strong>${escapeHtml(res.konto_haben)} ${escapeHtml(kontoMap.get(res.konto_haben)?.bezeichnung || '')}</strong>`);
              aiStatus.innerHTML = '✓ KI-Vorschlag: ' + tags.join(' · ');
              try { await api.saveInboxEntry(spArId, { aiResult: res }); } catch (e) { console.warn(e); }
            })
            .catch((err) => {
              aiStatus.innerHTML = `<span style="color:var(--color-danger)">KI-Fehler: ${escapeHtml(err.message)}</span>`;
            });
        }
      } else if (!portal.firebaseUrl) {
        aiInfo.style.display = 'none';
      }

      function readDraft() {
        const fields = m.bodyEl;
        return {
          datum: fields.querySelector('[name="datum"]').value,
          beleg_nr: fields.querySelector('[name="beleg_nr"]').value.trim(),
          beschreibung: fields.querySelector('[name="beschreibung"]').value.trim(),
          soll: fields.querySelector('[name="soll"]').value,
          haben: fields.querySelector('[name="haben"]').value,
          betrag: Number(fields.querySelector('[name="betrag"]').value) || 0,
          bezahlt: fields.querySelector('[name="bezahlt"]').checked,
          faellig_am: fields.querySelector('[name="faellig_am"]').value || '',
        };
      }

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;

      saveBtn.onclick = async () => {
        const draft = readDraft();
        saveBtn.disabled = true;
        try {
          await api.saveInboxEntry(spArId, { draft, aiResult });
          inboxState[spArId] = { ...(inboxState[spArId] || {}), draft, aiResult };
          renderRows();
          toast('Zwischengespeichert', 'success');
          m.close();
        } catch (err) {
          toast(err.message, 'error');
          saveBtn.disabled = false;
        }
      };

      verbuchenBtn.onclick = async () => {
        const draft = readDraft();
        if (!draft.bezahlt) {
          toast('Verbuchen nur möglich wenn Bezahlt-Häkchen gesetzt ist.', 'error');
          return;
        }
        if (!draft.datum || !draft.beschreibung || !draft.soll || !draft.haben || !draft.betrag) {
          toast('Bitte alle Pflichtfelder ausfüllen.', 'error');
          return;
        }
        if (draft.soll === draft.haben) {
          toast('Soll und Haben dürfen nicht identisch sein.', 'error');
          return;
        }
        // Wenn aktuelles Jahr geschlossen ist, müssen wir das ändern - aber wir
        // verlassen uns auf die Validierung in api.saveBuchung.
        const jahrInUse = state.aktuellesJahr;
        verbuchenBtn.disabled = true;
        saveBtn.disabled = true;
        try {
          const externalBeleg = portal.firebaseUrl ? {
            spArId: portal.id,
            fileName: portal.fileName || null,
            fileType: portal.fileType || null,
            fileSize: portal.fileSize || null,
            fileUrl: portal.firebaseUrl,
            firebasePath: portal.firebasePath || null,
          } : null;
          const buchung = await api.saveBuchung(jahrInUse, {
            ...draft,
            externalBeleg,
          });
          await api.saveInboxEntry(spArId, {
            draft,
            aiResult,
            buchungId: buchung.id,
            buchungJahr: jahrInUse,
            verbuchtAm: new Date().toISOString(),
          });
          inboxState[spArId] = {
            ...(inboxState[spArId] || {}),
            draft,
            aiResult,
            buchungId: buchung.id,
            buchungJahr: jahrInUse,
            verbuchtAm: new Date().toISOString(),
          };
          // Sync mit Portal → markiert dort abgeschlossen → Quantus erkennt es beim nächsten Poll
          try {
            const buchungUrl = `${location.origin}${location.pathname}#inbox?beleg=${encodeURIComponent(spArId)}`;
            await api.markPortalBeleg(spArId, {
              status: 'abgeschlossen',
              buchungId: buchung.id,
              buchungJahr: jahrInUse,
              buchungBezahlt: true,
              buchungUrl,
            });
          } catch (err) {
            console.warn('Portal-Sync fehlgeschlagen:', err);
            toast('Hinweis: Sync zum Portal fehlgeschlagen (Buchung trotzdem gespeichert).', 'error');
          }
          toast('Buchung verbucht – Quantus-Aufgabe wird abgeschlossen.', 'success');
          m.close();
          renderRows();
        } catch (err) {
          toast('Fehler: ' + err.message, 'error');
          verbuchenBtn.disabled = !readDraft().bezahlt;
          saveBtn.disabled = false;
        }
      };
    }

    // Pop-up zum Ansehen einer bereits verbuchten Inbox-Buchung.
    async function openBuchungAnsicht(portal, local) {
      const konten = await api.listKonten();
      const kontoMap = new Map(konten.map((k) => [k.nummer, k]));
      const list = await api.listBuchungen(local.buchungJahr);
      const buchung = list.find((b) => b.id === local.buchungId);
      if (!buchung) {
        toast('Verbuchte Buchung nicht mehr gefunden – Inbox-Eintrag zurücksetzen?', 'error');
        const reset = await confirmDialog('Inbox-Eintrag zurücksetzen?', { confirmLabel: 'Zurücksetzen', danger: true });
        if (reset) {
          await api.saveInboxEntry(portal.id, { buchungId: null, buchungJahr: null, verbuchtAm: null });
          inboxState[portal.id] = { ...(inboxState[portal.id] || {}), buchungId: null, buchungJahr: null, verbuchtAm: null };
          renderRows();
        }
        return;
      }

      const fileLinkInline = portal.firebaseUrl && portal.firebaseUrl.startsWith('http')
        ? `<a href="${escapeHtml(portal.firebaseUrl)}" target="_blank" rel="noopener">${fileIcon(portal.fileType, portal.fileName)} ${escapeHtml(portal.fileName || 'Beleg')} öffnen</a>`
        : '<span class="muted small">Keine Datei verfügbar</span>';

      const m = modal({
        title: `Verbuchte Buchung – ${local.buchungJahr}`,
        body: `
          <div class="card" style="background:var(--color-bg);margin-bottom:16px">
            <div class="flex between center" style="margin-bottom:6px">
              <strong>Beleg aus sp-ar-belege</strong>
              ${paidBadge(buchung.bezahlt)}
            </div>
            <div class="small muted">Eingereicht ${escapeHtml(formatDate(portal.submittedAt || portal.createdAt))}${portal.name && portal.name !== 'Unbekannt' ? ` von ${escapeHtml(portal.name)}` : ''}</div>
            <div style="margin-top:6px">${fileLinkInline}</div>
          </div>

          <div class="form-grid">
            <div class="input-group"><label>Datum</label><div>${escapeHtml(formatDate(buchung.datum))}</div></div>
            <div class="input-group"><label>Beleg-Nr</label><div>${escapeHtml(buchung.beleg_nr || '—')}</div></div>
            <div class="input-group full"><label>Beschreibung</label><div>${escapeHtml(buchung.beschreibung)}</div></div>
            <div class="input-group"><label>Soll</label><div>${escapeHtml(buchung.soll)} ${escapeHtml(kontoMap.get(buchung.soll)?.bezeichnung || '')}</div></div>
            <div class="input-group"><label>Haben</label><div>${escapeHtml(buchung.haben)} ${escapeHtml(kontoMap.get(buchung.haben)?.bezeichnung || '')}</div></div>
            <div class="input-group"><label>Betrag CHF</label><div>${formatChf(buchung.betrag)}</div></div>
            <div class="input-group"><label>Fällig am</label><div>${buchung.faellig_am ? escapeHtml(formatDate(buchung.faellig_am)) : '—'}</div></div>
            <div class="input-group full"><label>Verbucht am</label><div>${escapeHtml(formatDate(local.verbuchtAm))}</div></div>
          </div>
        `,
        footer: `
          <button data-cancel>Schliessen</button>
          <button class="primary" data-goto>In Buchungen öffnen</button>
        `,
      });
      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('[data-goto]').onclick = () => {
        m.close();
        // Springe ins Buchungsjahr und filtere auf diese Buchung
        if (state.aktuellesJahr !== local.buchungJahr) {
          localStorage.setItem('aktuellesJahr', String(local.buchungJahr));
        }
        location.hash = `buchungen?id=${encodeURIComponent(local.buchungId)}`;
      };
    }

    await loadAll();

    // Deep-Link: Falls ?beleg=<id> in URL, Pop-up direkt öffnen
    const targetId = params?.beleg;
    if (targetId) {
      // Warte bis Belege geladen, dann öffnen
      setTimeout(() => openEntry(targetId), 100);
    }
  },
};
