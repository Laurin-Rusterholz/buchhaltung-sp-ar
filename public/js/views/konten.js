import { api } from '../api.js';
import { escapeHtml, downloadFile, toCsv } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';
import { DEFAULT_KONTENPLAN } from '../defaults.js';
import { generateKontenplan, hasApiKey } from '../ai.js';

const TYP_LABEL = {
  aktiv: 'Aktiv',
  passiv: 'Passiv',
  ertrag: 'Ertrag',
  aufwand: 'Aufwand',
};

export default {
  async render(container) {
    let konten = await api.listKonten();
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));

    container.innerHTML = `
      <div class="page-header">
        <h2>Kontenplan</h2>
        <div class="actions">
          <button id="export-konten">CSV Export</button>
          <button class="ai" id="ai-konten">✨ AI-Vorschlag</button>
          <button id="reset-konten">Zurücksetzen…</button>
          <button class="primary" id="add-konto">+ Neues Konto</button>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen (Nummer/Bezeichnung)…" />
          <select id="filter-typ">
            <option value="">Alle Typen</option>
            <option value="aktiv">Aktiv</option>
            <option value="passiv">Passiv</option>
            <option value="ertrag">Ertrag</option>
            <option value="aufwand">Aufwand</option>
          </select>
          <div class="spacer"></div>
          <div class="muted small" id="count"></div>
        </div>
        <div class="table-wrap">
          <table class="data" id="konten-table">
            <thead>
              <tr><th>Nummer</th><th>Bezeichnung</th><th>Typ</th><th>Kategorie</th><th></th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = container.querySelector('tbody');
    const filter = container.querySelector('#filter');
    const filterTyp = container.querySelector('#filter-typ');
    const countEl = container.querySelector('#count');

    const renderRows = () => {
      const q = filter.value.toLowerCase();
      const typ = filterTyp.value;
      const rows = konten.filter((k) => {
        if (typ && k.typ !== typ) return false;
        if (q && !`${k.nummer} ${k.bezeichnung}`.toLowerCase().includes(q)) return false;
        return true;
      });
      countEl.textContent = `${rows.length} von ${konten.length}`;
      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="5" class="muted center">Keine Konten gefunden.</td></tr>'
        : rows.map((k) => `
          <tr>
            <td><strong>${escapeHtml(k.nummer)}</strong></td>
            <td>${escapeHtml(k.bezeichnung)}</td>
            <td><span class="badge muted">${TYP_LABEL[k.typ] || k.typ}</span></td>
            <td class="muted">${escapeHtml(k.kategorie || '')}</td>
            <td class="right">
              <button class="sm" data-edit="${escapeHtml(k.nummer)}">Bearbeiten</button>
              <button class="sm danger" data-delete="${escapeHtml(k.nummer)}">Löschen</button>
            </td>
          </tr>
        `).join('');
    };

    filter.oninput = renderRows;
    filterTyp.onchange = renderRows;
    renderRows();

    container.querySelector('#add-konto').onclick = () => openForm();
    container.querySelector('#export-konten').onclick = () => {
      const rows = konten.map((k) => [k.nummer, k.bezeichnung, k.typ, k.kategorie || '']);
      downloadFile('kontenplan.csv', toCsv(['Nummer', 'Bezeichnung', 'Typ', 'Kategorie'], rows), 'text/csv');
    };
    container.querySelector('#reset-konten').onclick = () => openReset();
    container.querySelector('#ai-konten').onclick = () => openAi();

    tbody.addEventListener('click', async (e) => {
      const editNr = e.target?.dataset?.edit;
      const deleteNr = e.target?.dataset?.delete;
      if (editNr) openForm(konten.find((k) => k.nummer === editNr));
      if (deleteNr) {
        if (!(await confirmDialog(`Konto ${deleteNr} wirklich löschen?`))) return;
        try {
          await api.deleteKonto(deleteNr);
          await reload();
          toast('Konto gelöscht', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    async function reload() {
      konten = await api.listKonten();
      konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
      renderRows();
    }

    function openForm(konto) {
      const isNew = !konto;
      const k = konto || { nummer: '', bezeichnung: '', typ: 'aktiv', kategorie: '' };
      const m = modal({
        title: isNew ? 'Neues Konto' : `Konto ${k.nummer} bearbeiten`,
        body: `
          <div class="form-grid">
            <div class="input-group">
              <label>Nummer</label>
              <input name="nummer" value="${escapeHtml(k.nummer)}" ${isNew ? '' : 'disabled'} />
            </div>
            <div class="input-group">
              <label>Typ</label>
              <select name="typ">
                <option value="aktiv" ${k.typ === 'aktiv' ? 'selected' : ''}>Aktiv</option>
                <option value="passiv" ${k.typ === 'passiv' ? 'selected' : ''}>Passiv</option>
                <option value="ertrag" ${k.typ === 'ertrag' ? 'selected' : ''}>Ertrag</option>
                <option value="aufwand" ${k.typ === 'aufwand' ? 'selected' : ''}>Aufwand</option>
              </select>
            </div>
            <div class="input-group full">
              <label>Bezeichnung</label>
              <input name="bezeichnung" value="${escapeHtml(k.bezeichnung)}" />
            </div>
            <div class="input-group full">
              <label>Kategorie (optional, z.B. "liquid", "forderungen")</label>
              <input name="kategorie" value="${escapeHtml(k.kategorie || '')}" />
            </div>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Speichern</button>`,
      });
      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('[data-save]').onclick = async () => {
        const data = {};
        m.bodyEl.querySelectorAll('[name]').forEach((el) => (data[el.name] = el.value.trim()));
        if (!data.nummer || !data.bezeichnung) { toast('Nummer und Bezeichnung sind Pflicht', 'error'); return; }
        try {
          if (isNew) await api.saveKonto(data);
          else await api.updateKonto(k.nummer, data);
          m.close();
          await reload();
          toast('Gespeichert', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }

    function openReset() {
      const m = modal({
        title: 'Kontenplan zurücksetzen',
        body: `
          <p>Was möchtest du tun? Diese Aktion ersetzt den aktuellen Kontenplan
          komplett – bestehende Buchungen bleiben, verweisen aber ggf. auf
          nicht mehr existierende Konten.</p>
          <div class="flex col gap-4 mt-4">
            <button data-action="defaults">📋 Schweizer Standard-Kontenplan laden (${DEFAULT_KONTENPLAN.length} Konten)</button>
            <button data-action="empty" class="danger">🗑️ Alle Konten löschen (komplett leer starten)</button>
          </div>
        `,
        footer: `<button data-cancel>Schliessen</button>`,
      });
      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.bodyEl.addEventListener('click', async (e) => {
        const action = e.target?.dataset?.action;
        if (!action) return;
        const ok = await confirmDialog(
          action === 'defaults'
            ? 'Aktuellen Kontenplan durch Standard-Kontenplan ersetzen?'
            : 'Wirklich ALLE Konten löschen?',
        );
        if (!ok) return;
        try {
          await api.replaceKontenplan(action === 'defaults' ? DEFAULT_KONTENPLAN.slice() : []);
          m.close();
          await reload();
          toast('Kontenplan zurückgesetzt', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    function openAi() {
      if (!hasApiKey()) {
        toast('Claude API Key fehlt – in Einstellungen hinterlegen', 'error');
        location.hash = 'einstellungen';
        return;
      }
      const m = modal({
        title: '✨ AI-Kontenplan generieren',
        body: `
          <p class="muted small">Beschreibe den Verein. Claude schlägt einen
          angepassten Schweizer Kontenplan vor.</p>
          <div class="input-group full">
            <label>Vereins-Beschreibung</label>
            <textarea id="ai-input" rows="5" placeholder="z.B. Politischer Verein der Sozialdemokratischen Partei Appenzell Ausserrhoden. Tätigkeiten: Wahlkampf, Veranstaltungen, Mitgliederversammlungen, Parteibeiträge an die Bundespartei…"></textarea>
          </div>
          <div id="ai-output" class="hidden"></div>
        `,
        footer: `
          <button data-cancel>Abbrechen</button>
          <button class="ai" id="ai-generate">✨ Generieren</button>
          <button class="primary hidden" id="ai-apply">Übernehmen (ersetzt aktuellen Kontenplan)</button>
        `,
      });

      const input = m.bodyEl.querySelector('#ai-input');
      const output = m.bodyEl.querySelector('#ai-output');
      const genBtn = m.footerEl.querySelector('#ai-generate');
      const applyBtn = m.footerEl.querySelector('#ai-apply');
      let suggestion = null;

      m.footerEl.querySelector('[data-cancel]').onclick = m.close;

      genBtn.onclick = async () => {
        const desc = input.value.trim();
        if (!desc) { toast('Bitte Vereins-Beschreibung eingeben', 'error'); return; }
        genBtn.disabled = true;
        output.classList.remove('hidden');
        output.innerHTML = '<div class="loader">Claude denkt nach…</div>';
        try {
          suggestion = await generateKontenplan(desc);
          output.innerHTML = `
            <h4>Vorschlag (${suggestion.length} Konten)</h4>
            <div class="table-wrap" style="max-height:300px;overflow:auto">
              <table class="data">
                <thead><tr><th>Nr</th><th>Bezeichnung</th><th>Typ</th><th>Kategorie</th></tr></thead>
                <tbody>
                  ${suggestion.map((k) => `<tr><td>${escapeHtml(k.nummer)}</td><td>${escapeHtml(k.bezeichnung)}</td><td>${escapeHtml(k.typ)}</td><td class="muted">${escapeHtml(k.kategorie || '')}</td></tr>`).join('')}
                </tbody>
              </table>
            </div>
          `;
          applyBtn.classList.remove('hidden');
        } catch (err) {
          output.innerHTML = `<div class="empty">Fehler: ${escapeHtml(err.message)}</div>`;
        }
        genBtn.disabled = false;
      };

      applyBtn.onclick = async () => {
        if (!suggestion) return;
        if (!(await confirmDialog(`Den aktuellen Kontenplan durch die ${suggestion.length} vorgeschlagenen Konten ersetzen?`))) return;
        try {
          await api.replaceKontenplan(suggestion);
          m.close();
          await reload();
          toast('Kontenplan übernommen', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  },
};
