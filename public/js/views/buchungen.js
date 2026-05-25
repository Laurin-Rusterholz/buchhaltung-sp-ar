import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml, formatChf, formatDate, todayIso, downloadFile, toCsv, parseHash } from '../utils.js';
import { modal, toast, confirmDialog, enhanceSelect } from '../components.js';
import { suggestBuchung, hasApiKey } from '../ai.js';

export default {
  async render(container, params = {}) {
    const jahr = state.aktuellesJahr;
    let [buchungen, konten, belege] = await Promise.all([
      api.listBuchungen(jahr),
      api.listKonten(),
      api.listBelege(),
    ]);
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
    const kontoMap = new Map(konten.map((k) => [k.nummer, k]));
    const belegMap = new Map(belege.map((b) => [b.id, b]));

    container.innerHTML = `
      <div class="page-header">
        <h2>Buchungen ${jahr}</h2>
        <div class="actions">
          <button id="export-csv">CSV Export</button>
          <button class="primary" id="add-buchung">+ Neue Buchung</button>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen…" />
          <select id="filter-konto">
            <option value="">Alle Konten</option>
            ${konten.map((k) => `<option value="${escapeHtml(k.nummer)}">${escapeHtml(k.nummer)} ${escapeHtml(k.bezeichnung)}</option>`).join('')}
          </select>
          <div class="spacer"></div>
          <div class="muted small" id="summe"></div>
        </div>
        <div class="table-wrap">
          <table class="data" id="tab">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Beleg-Nr</th>
                <th>Beschreibung</th>
                <th>Soll</th>
                <th>Haben</th>
                <th class="num">Betrag CHF</th>
                <th>Fällig</th>
                <th>Bezahlt</th>
                <th>Beleg</th>
                <th></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = container.querySelector('tbody');
    const filter = container.querySelector('#filter');
    const filterKonto = container.querySelector('#filter-konto');
    const summe = container.querySelector('#summe');

    const renderRows = () => {
      const q = filter.value.toLowerCase();
      const kontoNr = filterKonto.value;
      const rows = buchungen
        .filter((b) => {
          if (kontoNr && b.soll !== kontoNr && b.haben !== kontoNr) return false;
          if (q) {
            const text = `${b.datum} ${b.beleg_nr || ''} ${b.beschreibung} ${b.soll} ${b.haben}`.toLowerCase();
            if (!text.includes(q)) return false;
          }
          return true;
        })
        .sort((a, b) => b.datum.localeCompare(a.datum) || (b.beleg_nr || '').localeCompare(a.beleg_nr || ''));

      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="10" class="muted center">Keine Buchungen vorhanden.</td></tr>'
        : rows.map((b) => {
          const belegUrl = b.externalBeleg?.fileUrl || belegMap.get(b.beleg_id)?.url || '';
          const belegName = b.externalBeleg?.fileName || belegMap.get(b.beleg_id)?.dateiname || '';
          return `
          <tr ${b.id === params?.id ? 'style="background:rgba(200,16,46,.07)"' : ''}>
            <td>${formatDate(b.datum)}</td>
            <td>${escapeHtml(b.beleg_nr || '')}</td>
            <td>${escapeHtml(b.beschreibung)}</td>
            <td>${escapeHtml(b.soll)} <span class="muted small">${escapeHtml(kontoMap.get(b.soll)?.bezeichnung || '')}</span></td>
            <td>${escapeHtml(b.haben)} <span class="muted small">${escapeHtml(kontoMap.get(b.haben)?.bezeichnung || '')}</span></td>
            <td class="num">${formatChf(b.betrag)}</td>
            <td>${b.faellig_am ? escapeHtml(formatDate(b.faellig_am)) : ''}</td>
            <td>
              <label class="flex center gap-4" style="cursor:pointer">
                <input type="checkbox" data-toggle-paid="${escapeHtml(b.id)}" ${b.bezahlt ? 'checked' : ''} style="width:auto" />
                <span class="badge ${b.bezahlt ? 'success' : 'danger'}">${b.bezahlt ? 'Ja' : 'Nein'}</span>
              </label>
            </td>
            <td>${belegUrl ? `<a href="${escapeHtml(belegUrl)}" target="_blank" rel="noopener" title="${escapeHtml(belegName)}">Öffnen</a>` : ''}</td>
            <td class="right">
              <button class="sm" data-edit="${escapeHtml(b.id)}">Bearbeiten</button>
              <button class="sm danger" data-delete="${escapeHtml(b.id)}">Löschen</button>
            </td>
          </tr>
        `;}).join('');

      const sumChf = rows.reduce((s, r) => s + Number(r.betrag), 0);
      summe.textContent = `${rows.length} Buchung${rows.length === 1 ? '' : 'en'} · Summe CHF ${formatChf(sumChf)}`;
    };

    filter.oninput = renderRows;
    filterKonto.onchange = renderRows;
    renderRows();

    container.querySelector('#export-csv').onclick = () => {
      const rows = buchungen
        .slice()
        .sort((a, b) => a.datum.localeCompare(b.datum))
        .map((b) => [b.datum, b.beleg_nr || '', b.beschreibung, b.soll, b.haben, b.betrag]);
      downloadFile(`buchungen-${jahr}.csv`, toCsv(['Datum', 'Beleg-Nr', 'Beschreibung', 'Soll', 'Haben', 'Betrag CHF'], rows), 'text/csv');
    };

    container.querySelector('#add-buchung').onclick = () => openForm();

    // Falls eine vorbefüllte Buchung wartet (z.B. nach AI-Beleg-Analyse) → Formular öffnen
    if (state.pendingBuchung) {
      const pending = state.pendingBuchung;
      state.pendingBuchung = null;
      openForm(null, pending);
    }

    tbody.addEventListener('click', async (e) => {
      const editId = e.target?.dataset?.edit;
      const deleteId = e.target?.dataset?.delete;
      if (editId) openForm(buchungen.find((b) => b.id === editId));
      if (deleteId) {
        if (!(await confirmDialog('Buchung wirklich löschen?'))) return;
        try {
          await api.deleteBuchung(jahr, deleteId);
          buchungen = await api.listBuchungen(jahr);
          renderRows();
          toast('Gelöscht', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });

    // Toggle "Bezahlt" direkt aus der Tabelle (+ Sync zum sp-ar-belege Portal,
    // wenn die Buchung aus dem externen Portal stammt → Quantus-Aufgabe wird abgeschlossen).
    tbody.addEventListener('change', async (e) => {
      const toggleId = e.target?.dataset?.togglePaid;
      if (!toggleId) return;
      const checked = e.target.checked;
      const buchung = buchungen.find((b) => b.id === toggleId);
      if (!buchung) return;
      try {
        await api.updateBuchung(jahr, toggleId, { bezahlt: checked });
        if (buchung.externalBeleg?.spArId) {
          try {
            await api.markPortalBeleg(buchung.externalBeleg.spArId, {
              status: checked ? 'abgeschlossen' : 'importiert',
              buchungBezahlt: checked,
            });
          } catch (err) { console.warn('Portal-Sync fehlgeschlagen:', err); }
        }
        buchungen = await api.listBuchungen(jahr);
        renderRows();
        toast(checked ? 'Als bezahlt markiert' : 'Bezahlt-Häkchen entfernt', 'success');
      } catch (err) {
        toast(err.message, 'error');
        e.target.checked = !checked;
      }
    });

    function openForm(buchung, prefill) {
      const isNew = !buchung;
      const b = buchung || {
        datum: prefill?.datum || todayIso(),
        beleg_nr: prefill?.beleg_nr || '',
        beschreibung: prefill?.beschreibung || '',
        soll: prefill?.soll || '',
        haben: prefill?.haben || '',
        betrag: prefill?.betrag || '',
        beleg_id: prefill?.beleg_id || '',
        faellig_am: prefill?.faellig_am || '',
        bezahlt: prefill?.bezahlt === true,
      };
      const optionsKonten = konten
        .map((k) => `<option value="${escapeHtml(k.nummer)}">${escapeHtml(k.nummer)} ${escapeHtml(k.bezeichnung)}</option>`)
        .join('');
      const optionsBelege = `<option value="">— kein Beleg —</option>` +
        belege.map((bl) => `<option value="${escapeHtml(bl.id)}">${escapeHtml(bl.bezeichnung || bl.dateiname)}</option>`).join('');

      const m = modal({
        title: isNew ? 'Neue Buchung' : 'Buchung bearbeiten',
        body: `
          <div class="form-grid">
            <div class="input-group">
              <label>Datum</label>
              <input name="datum" type="date" value="${escapeHtml(b.datum)}" />
            </div>
            <div class="input-group">
              <label>Beleg-Nr</label>
              <input name="beleg_nr" value="${escapeHtml(b.beleg_nr || '')}" placeholder="z.B. 2025-001" />
            </div>
            <div class="input-group full">
              <label>Beschreibung</label>
              <input name="beschreibung" value="${escapeHtml(b.beschreibung)}" />
              ${hasApiKey() ? '<div class="ai-hint"><button type="button" class="ai sm" data-ai-suggest>✨ Konten + Betrag vorschlagen</button><span id="ai-status" class="muted small"></span></div>' : '<div class="ai-hint muted small">AI-Vorschläge: Claude Key in Einstellungen hinterlegen</div>'}
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
              <input name="betrag" type="number" step="0.05" min="0" value="${escapeHtml(b.betrag)}" />
            </div>
            <div class="input-group">
              <label>Fällig am</label>
              <input name="faellig_am" type="date" value="${escapeHtml(b.faellig_am || '')}" />
            </div>
            <div class="input-group">
              <label>Beleg-Verknüpfung</label>
              <select name="beleg_id">${optionsBelege}</select>
            </div>
            <div class="input-group full">
              <label class="flex center gap-4" style="cursor:pointer">
                <input name="bezahlt" type="checkbox" style="width:auto" ${b.bezahlt ? 'checked' : ''} />
                <span>Bezahlt${b.externalBeleg ? ' (synchronisiert mit Quantus-Aufgabe)' : ''}</span>
              </label>
            </div>
            ${b.externalBeleg?.fileUrl ? `<div class="input-group full"><label>Externer Beleg</label><div><a href="${escapeHtml(b.externalBeleg.fileUrl)}" target="_blank" rel="noopener">📄 ${escapeHtml(b.externalBeleg.fileName || 'Beleg')} öffnen</a></div></div>` : ''}
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Speichern</button>`,
      });
      // Set selects
      m.bodyEl.querySelector('[name="soll"]').value = b.soll;
      m.bodyEl.querySelector('[name="haben"]').value = b.haben;
      m.bodyEl.querySelector('[name="beleg_id"]').value = b.beleg_id || '';

      // Selects zu durchsuchbaren Comboboxes aufwerten – User kann Konto-
      // Nummer oder Bezeichnung tippen.
      enhanceSelect(m.bodyEl.querySelector('[name="soll"]'), { placeholder: 'Soll-Konto suchen…' });
      enhanceSelect(m.bodyEl.querySelector('[name="haben"]'), { placeholder: 'Haben-Konto suchen…' });

      // AI-Vorschlag
      const aiBtn = m.bodyEl.querySelector('[data-ai-suggest]');
      if (aiBtn) {
        const aiStatus = m.bodyEl.querySelector('#ai-status');
        aiBtn.onclick = async () => {
          const beschr = m.bodyEl.querySelector('[name="beschreibung"]').value.trim();
          if (!beschr) { toast('Erst Beschreibung eingeben', 'error'); return; }
          aiBtn.disabled = true;
          aiStatus.textContent = '· denkt nach…';
          try {
            const aktBetrag = Number(m.bodyEl.querySelector('[name="betrag"]').value) || null;
            const result = await suggestBuchung({
              beschreibung: beschr,
              betrag: aktBetrag,
              datum: m.bodyEl.querySelector('[name="datum"]').value,
              konten,
              // Bisherige Buchungen des aktuellen Jahres als Lern-Kontext
              buchungen,
            });
            if (kontoMap.get(result.soll)) m.bodyEl.querySelector('[name="soll"]').value = result.soll;
            if (kontoMap.get(result.haben)) m.bodyEl.querySelector('[name="haben"]').value = result.haben;
            if (result.betrag) m.bodyEl.querySelector('[name="betrag"]').value = result.betrag;
            if (result.beschreibung) m.bodyEl.querySelector('[name="beschreibung"]').value = result.beschreibung;
            aiStatus.innerHTML = `· ${escapeHtml(result.begruendung || 'übernommen')}`;
          } catch (err) {
            aiStatus.textContent = `· Fehler: ${err.message}`;
            toast(err.message, 'error');
          }
          aiBtn.disabled = false;
        };
      }

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('[data-save]').onclick = async () => {
        const data = {};
        m.bodyEl.querySelectorAll('[name]').forEach((el) => {
          if (el.type === 'checkbox') data[el.name] = el.checked;
          else data[el.name] = el.value.trim();
        });
        data.betrag = Number(data.betrag);
        if (!data.datum || !data.beschreibung || !data.soll || !data.haben || !data.betrag) {
          toast('Bitte alle Pflichtfelder ausfüllen', 'error'); return;
        }
        if (data.soll === data.haben) {
          toast('Soll und Haben dürfen nicht identisch sein', 'error'); return;
        }
        try {
          const prevBezahlt = !isNew ? !!b.bezahlt : null;
          if (isNew) await api.saveBuchung(jahr, data);
          else await api.updateBuchung(jahr, b.id, data);
          // Falls externer Beleg verknüpft und Bezahlt-Status geändert: Portal informieren
          if (!isNew && b.externalBeleg?.spArId && prevBezahlt !== data.bezahlt) {
            try {
              await api.markPortalBeleg(b.externalBeleg.spArId, {
                status: data.bezahlt ? 'abgeschlossen' : 'importiert',
                buchungBezahlt: data.bezahlt,
              });
            } catch (err) { console.warn('Portal-Sync fehlgeschlagen:', err); }
          }
          m.close();
          buchungen = await api.listBuchungen(jahr);
          renderRows();
          toast('Gespeichert', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }
  },
};
