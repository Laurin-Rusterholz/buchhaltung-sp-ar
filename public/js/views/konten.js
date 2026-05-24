import { api } from '../api.js';
import { escapeHtml, downloadFile, toCsv } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';

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

    const renderRows = () => {
      const q = filter.value.toLowerCase();
      const typ = filterTyp.value;
      const rows = konten.filter((k) => {
        if (typ && k.typ !== typ) return false;
        if (q && !`${k.nummer} ${k.bezeichnung}`.toLowerCase().includes(q)) return false;
        return true;
      });
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

    tbody.addEventListener('click', async (e) => {
      const editNr = e.target?.dataset?.edit;
      const deleteNr = e.target?.dataset?.delete;
      if (editNr) openForm(konten.find((k) => k.nummer === editNr));
      if (deleteNr) {
        if (!(await confirmDialog(`Konto ${deleteNr} wirklich löschen?`))) return;
        try {
          await api.deleteKonto(deleteNr);
          konten = await api.listKonten();
          konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
          renderRows();
          toast('Konto gelöscht', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });

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
        const inputs = m.bodyEl.querySelectorAll('[name]');
        const data = {};
        inputs.forEach((el) => (data[el.name] = el.value.trim()));
        if (!data.nummer || !data.bezeichnung) {
          toast('Nummer und Bezeichnung sind Pflicht', 'error');
          return;
        }
        try {
          if (isNew) await api.saveKonto(data);
          else await api.updateKonto(k.nummer, data);
          m.close();
          konten = await api.listKonten();
          konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
          renderRows();
          toast('Gespeichert', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }
  },
};
