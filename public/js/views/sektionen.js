// Sektionen-Verwaltung: jede Sektion mit Anzahl Mitglieder × Beitrag/Kopf.
// Ersetzt die frühere Mitglieder-Einzelverwaltung.

import { api } from '../api.js';
import { escapeHtml, formatChf, downloadFile, toCsv } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';

const STATUS_BADGE = {
  aktiv: 'success',
  inaktiv: 'muted',
};

export default {
  async render(container) {
    let sektionen = await api.listSektionen();

    const totalSektionen = sektionen.length;
    const aktive = sektionen.filter((s) => s.status === 'aktiv' || !s.status);
    const totalMitglieder = aktive.reduce((sum, s) => sum + Number(s.anzahl_mitglieder || 0), 0);
    const totalBeitrag = aktive.reduce((sum, s) => sum + Number(s.anzahl_mitglieder || 0) * Number(s.beitrag_pro_mitglied || 0), 0);

    container.innerHTML = `
      <div class="page-header">
        <h2>Sektionen</h2>
        <div class="actions">
          <button id="export-csv">CSV Export</button>
          <button class="primary" id="add">+ Neue Sektion</button>
        </div>
      </div>

      <div class="cards-grid">
        <div class="kpi"><div class="kpi-label">Sektionen aktiv</div><div class="kpi-value">${aktive.length}<span class="muted small"> / ${totalSektionen}</span></div></div>
        <div class="kpi"><div class="kpi-label">Mitglieder total</div><div class="kpi-value">${totalMitglieder}</div></div>
        <div class="kpi"><div class="kpi-label">Beitragssumme / Jahr</div><div class="kpi-value">CHF ${formatChf(totalBeitrag)}</div></div>
        <div class="kpi"><div class="kpi-label">Ø Beitrag / Mitglied</div><div class="kpi-value">CHF ${formatChf(totalMitglieder > 0 ? totalBeitrag / totalMitglieder : 0)}</div></div>
      </div>

      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen…" />
          <select id="filter-status">
            <option value="">Alle Status</option>
            <option value="aktiv">Aktiv</option>
            <option value="inaktiv">Inaktiv</option>
          </select>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Sektion</th>
                <th>Kontakt</th>
                <th>Adresse</th>
                <th class="num">Mitglieder</th>
                <th class="num">Beitrag/Kopf</th>
                <th class="num">Total CHF</th>
                <th>Status</th>
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
    const filterStatus = container.querySelector('#filter-status');

    const renderRows = () => {
      const q = filter.value.toLowerCase();
      const st = filterStatus.value;
      const rows = sektionen
        .filter((s) => {
          if (st && (s.status || 'aktiv') !== st) return false;
          if (q && !`${s.name} ${s.kontakt_name} ${s.ort}`.toLowerCase().includes(q)) return false;
          return true;
        })
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="8" class="muted center">Noch keine Sektionen erfasst.</td></tr>'
        : rows.map((s) => {
          const total = Number(s.anzahl_mitglieder || 0) * Number(s.beitrag_pro_mitglied || 0);
          return `
            <tr>
              <td><strong>${escapeHtml(s.name)}</strong></td>
              <td class="muted small">${escapeHtml(s.kontakt_name || '')}${s.kontakt_email ? '<br>' + escapeHtml(s.kontakt_email) : ''}</td>
              <td class="muted small">${escapeHtml(s.adresse || '')}<br>${escapeHtml(s.plz || '')} ${escapeHtml(s.ort || '')}</td>
              <td class="num">${s.anzahl_mitglieder || 0}</td>
              <td class="num">${formatChf(s.beitrag_pro_mitglied || 0)}</td>
              <td class="num bold">${formatChf(total)}</td>
              <td><span class="badge ${STATUS_BADGE[s.status || 'aktiv']}">${escapeHtml(s.status || 'aktiv')}</span></td>
              <td class="right">
                <button class="sm" data-edit="${escapeHtml(s.id)}">Bearbeiten</button>
                <button class="sm danger" data-delete="${escapeHtml(s.id)}">Löschen</button>
              </td>
            </tr>
          `;
        }).join('');
    };

    filter.oninput = renderRows;
    filterStatus.onchange = renderRows;
    renderRows();

    container.querySelector('#export-csv').onclick = () => {
      const rows = sektionen.map((s) => [
        s.name, s.kontakt_name || '', s.kontakt_email || '',
        s.adresse || '', s.plz || '', s.ort || '',
        s.anzahl_mitglieder || 0, s.beitrag_pro_mitglied || 0,
        Number(s.anzahl_mitglieder || 0) * Number(s.beitrag_pro_mitglied || 0),
        s.status || 'aktiv',
      ]);
      downloadFile('sektionen.csv', toCsv(
        ['Sektion', 'Kontakt', 'Email', 'Adresse', 'PLZ', 'Ort', 'Mitglieder', 'Beitrag/Kopf', 'Total CHF', 'Status'],
        rows,
      ), 'text/csv');
    };

    container.querySelector('#add').onclick = () => openForm();

    tbody.addEventListener('click', async (e) => {
      const editId = e.target?.dataset?.edit;
      const deleteId = e.target?.dataset?.delete;
      if (editId) openForm(sektionen.find((s) => s.id === editId));
      if (deleteId) {
        if (!(await confirmDialog('Sektion wirklich löschen?'))) return;
        try {
          await api.deleteSektion(deleteId);
          sektionen = await api.listSektionen();
          renderRows();
          toast('Gelöscht', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    function openForm(sektion) {
      const isNew = !sektion;
      const s = sektion || {
        name: '', kontakt_name: '', kontakt_email: '',
        adresse: '', plz: '', ort: '',
        anzahl_mitglieder: 0, beitrag_pro_mitglied: 80,
        status: 'aktiv', notizen: '',
      };
      const md = modal({
        title: isNew ? 'Neue Sektion' : `Sektion ${s.name}`,
        body: `
          <div class="form-grid">
            <div class="input-group full"><label>Sektionsname</label><input name="name" value="${escapeHtml(s.name)}" placeholder="z.B. SP Herisau" /></div>
            <div class="input-group"><label>Anzahl Mitglieder</label><input name="anzahl_mitglieder" type="number" min="0" step="1" value="${s.anzahl_mitglieder || 0}" /></div>
            <div class="input-group"><label>Beitrag pro Mitglied CHF</label><input name="beitrag_pro_mitglied" type="number" min="0" step="0.05" value="${s.beitrag_pro_mitglied || 0}" /></div>
            <div class="input-group full"><label>Kontaktperson</label><input name="kontakt_name" value="${escapeHtml(s.kontakt_name || '')}" placeholder="z.B. Präsident:in" /></div>
            <div class="input-group full"><label>Kontakt-Email</label><input name="kontakt_email" type="email" value="${escapeHtml(s.kontakt_email || '')}" /></div>
            <div class="input-group full"><label>Rechnungsadresse</label><input name="adresse" value="${escapeHtml(s.adresse || '')}" placeholder="Strasse + Nr" /></div>
            <div class="input-group"><label>PLZ</label><input name="plz" value="${escapeHtml(s.plz || '')}" /></div>
            <div class="input-group"><label>Ort</label><input name="ort" value="${escapeHtml(s.ort || '')}" /></div>
            <div class="input-group"><label>Status</label>
              <select name="status">
                <option value="aktiv" ${(s.status || 'aktiv') === 'aktiv' ? 'selected' : ''}>Aktiv</option>
                <option value="inaktiv" ${s.status === 'inaktiv' ? 'selected' : ''}>Inaktiv</option>
              </select>
            </div>
            <div class="input-group">
              <label>Total Beitrag / Jahr</label>
              <div id="total-preview" class="bold" style="padding:8px 0">CHF ${formatChf(Number(s.anzahl_mitglieder || 0) * Number(s.beitrag_pro_mitglied || 0))}</div>
            </div>
            <div class="input-group full"><label>Notizen</label><textarea name="notizen">${escapeHtml(s.notizen || '')}</textarea></div>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Speichern</button>`,
      });

      // Live-Update Total
      const update = () => {
        const anz = Number(md.bodyEl.querySelector('[name="anzahl_mitglieder"]').value || 0);
        const beitrag = Number(md.bodyEl.querySelector('[name="beitrag_pro_mitglied"]').value || 0);
        md.bodyEl.querySelector('#total-preview').textContent = `CHF ${formatChf(anz * beitrag)}`;
      };
      md.bodyEl.querySelector('[name="anzahl_mitglieder"]').oninput = update;
      md.bodyEl.querySelector('[name="beitrag_pro_mitglied"]').oninput = update;

      md.footerEl.querySelector('[data-cancel]').onclick = md.close;
      md.footerEl.querySelector('[data-save]').onclick = async () => {
        const data = {};
        md.bodyEl.querySelectorAll('[name]').forEach((el) => (data[el.name] = el.value.trim ? el.value.trim() : el.value));
        if (!data.name) { toast('Sektionsname ist Pflicht', 'error'); return; }
        try {
          if (isNew) await api.saveSektion(data);
          else await api.updateSektion(sektion.id, data);
          md.close();
          sektionen = await api.listSektionen();
          renderRows();
          toast('Gespeichert', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  },
};
