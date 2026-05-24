import { api } from '../api.js';
import { escapeHtml, formatChf, formatDate, downloadFile, toCsv } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';

const STATUS_BADGE = {
  aktiv: 'success',
  passiv: 'muted',
  ausgetreten: 'danger',
};

export default {
  async render(container) {
    let mitglieder = await api.listMitglieder();

    container.innerHTML = `
      <div class="page-header">
        <h2>Mitglieder</h2>
        <div class="actions">
          <button id="export-csv">CSV Export</button>
          <button class="primary" id="add">+ Neues Mitglied</button>
        </div>
      </div>

      <div class="cards-grid">
        <div class="kpi"><div class="kpi-label">Aktiv</div><div class="kpi-value">${mitglieder.filter((m) => m.status === 'aktiv').length}</div></div>
        <div class="kpi"><div class="kpi-label">Passiv</div><div class="kpi-value">${mitglieder.filter((m) => m.status === 'passiv').length}</div></div>
        <div class="kpi"><div class="kpi-label">Ausgetreten</div><div class="kpi-value">${mitglieder.filter((m) => m.status === 'ausgetreten').length}</div></div>
        <div class="kpi"><div class="kpi-label">Beitrag/Jahr</div><div class="kpi-value">CHF ${formatChf(mitglieder.filter((m) => m.status === 'aktiv').reduce((s, m) => s + Number(m.beitrag || 0), 0))}</div></div>
      </div>

      <div class="card">
        <div class="toolbar">
          <input type="search" id="filter" placeholder="Suchen…" />
          <select id="filter-status">
            <option value="">Alle Status</option>
            <option value="aktiv">Aktiv</option>
            <option value="passiv">Passiv</option>
            <option value="ausgetreten">Ausgetreten</option>
          </select>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th>Nr</th><th>Name</th><th>Adresse</th><th>Kontakt</th><th>Eintritt</th>
                <th class="num">Beitrag CHF</th><th>Status</th><th></th>
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
      const rows = mitglieder
        .filter((m) => {
          if (st && m.status !== st) return false;
          if (q && !`${m.nummer} ${m.vorname} ${m.nachname} ${m.email}`.toLowerCase().includes(q)) return false;
          return true;
        })
        .sort((a, b) => (a.nachname || '').localeCompare(b.nachname || ''));

      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="8" class="muted center">Keine Mitglieder gefunden.</td></tr>'
        : rows.map((m) => `
          <tr>
            <td>${escapeHtml(m.nummer || '')}</td>
            <td><strong>${escapeHtml(m.nachname || '')}</strong>, ${escapeHtml(m.vorname || '')}</td>
            <td class="muted small">${escapeHtml(m.strasse || '')}<br>${escapeHtml(m.plz || '')} ${escapeHtml(m.ort || '')}</td>
            <td class="muted small">${escapeHtml(m.email || '')}<br>${escapeHtml(m.telefon || '')}</td>
            <td>${formatDate(m.eintritt)}</td>
            <td class="num">${formatChf(m.beitrag || 0)}</td>
            <td><span class="badge ${STATUS_BADGE[m.status] || 'muted'}">${escapeHtml(m.status || '')}</span></td>
            <td class="right">
              <button class="sm" data-edit="${escapeHtml(m.id)}">Bearbeiten</button>
              <button class="sm danger" data-delete="${escapeHtml(m.id)}">Löschen</button>
            </td>
          </tr>
        `).join('');
    };

    filter.oninput = renderRows;
    filterStatus.onchange = renderRows;
    renderRows();

    container.querySelector('#export-csv').onclick = () => {
      const rows = mitglieder.map((m) => [
        m.nummer || '', m.vorname || '', m.nachname || '', m.strasse || '',
        m.plz || '', m.ort || '', m.email || '', m.telefon || '',
        m.eintritt || '', m.austritt || '', m.kategorie || '', m.beitrag || 0, m.status || '',
      ]);
      downloadFile('mitglieder.csv', toCsv(
        ['Nr', 'Vorname', 'Nachname', 'Strasse', 'PLZ', 'Ort', 'Email', 'Telefon', 'Eintritt', 'Austritt', 'Kategorie', 'Beitrag', 'Status'],
        rows,
      ), 'text/csv');
    };

    container.querySelector('#add').onclick = () => openForm();

    tbody.addEventListener('click', async (e) => {
      const editId = e.target?.dataset?.edit;
      const deleteId = e.target?.dataset?.delete;
      if (editId) openForm(mitglieder.find((m) => m.id === editId));
      if (deleteId) {
        if (!(await confirmDialog('Mitglied wirklich löschen?'))) return;
        try {
          await api.deleteMitglied(deleteId);
          mitglieder = await api.listMitglieder();
          renderRows();
          toast('Gelöscht', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    function openForm(mitglied) {
      const isNew = !mitglied;
      const m = mitglied || {
        nummer: '', vorname: '', nachname: '', strasse: '', plz: '', ort: '',
        email: '', telefon: '', eintritt: '', austritt: '', kategorie: '', beitrag: 0, status: 'aktiv', notizen: '',
      };
      const md = modal({
        title: isNew ? 'Neues Mitglied' : `${m.vorname} ${m.nachname}`,
        body: `
          <div class="form-grid">
            <div class="input-group"><label>Mitglieds-Nr</label><input name="nummer" value="${escapeHtml(m.nummer || '')}" /></div>
            <div class="input-group"><label>Status</label>
              <select name="status">
                <option value="aktiv" ${m.status === 'aktiv' ? 'selected' : ''}>Aktiv</option>
                <option value="passiv" ${m.status === 'passiv' ? 'selected' : ''}>Passiv</option>
                <option value="ausgetreten" ${m.status === 'ausgetreten' ? 'selected' : ''}>Ausgetreten</option>
              </select>
            </div>
            <div class="input-group"><label>Vorname</label><input name="vorname" value="${escapeHtml(m.vorname || '')}" /></div>
            <div class="input-group"><label>Nachname</label><input name="nachname" value="${escapeHtml(m.nachname || '')}" /></div>
            <div class="input-group full"><label>Strasse</label><input name="strasse" value="${escapeHtml(m.strasse || '')}" /></div>
            <div class="input-group"><label>PLZ</label><input name="plz" value="${escapeHtml(m.plz || '')}" /></div>
            <div class="input-group"><label>Ort</label><input name="ort" value="${escapeHtml(m.ort || '')}" /></div>
            <div class="input-group"><label>Email</label><input name="email" type="email" value="${escapeHtml(m.email || '')}" /></div>
            <div class="input-group"><label>Telefon</label><input name="telefon" value="${escapeHtml(m.telefon || '')}" /></div>
            <div class="input-group"><label>Eintritt</label><input name="eintritt" type="date" value="${escapeHtml(m.eintritt || '')}" /></div>
            <div class="input-group"><label>Austritt</label><input name="austritt" type="date" value="${escapeHtml(m.austritt || '')}" /></div>
            <div class="input-group"><label>Kategorie</label><input name="kategorie" value="${escapeHtml(m.kategorie || '')}" placeholder="z.B. Erwachsen, Lehrling" /></div>
            <div class="input-group"><label>Beitrag CHF/Jahr</label><input name="beitrag" type="number" step="0.05" min="0" value="${escapeHtml(m.beitrag || 0)}" /></div>
            <div class="input-group full"><label>Notizen</label><textarea name="notizen">${escapeHtml(m.notizen || '')}</textarea></div>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Speichern</button>`,
      });
      md.footerEl.querySelector('[data-cancel]').onclick = md.close;
      md.footerEl.querySelector('[data-save]').onclick = async () => {
        const data = {};
        md.bodyEl.querySelectorAll('[name]').forEach((el) => (data[el.name] = el.value.trim()));
        data.beitrag = Number(data.beitrag || 0);
        if (!data.nachname && !data.vorname) {
          toast('Vorname oder Nachname ist Pflicht', 'error'); return;
        }
        try {
          if (isNew) await api.saveMitglied(data);
          else await api.updateMitglied(mitglied.id, data);
          md.close();
          mitglieder = await api.listMitglieder();
          renderRows();
          toast('Gespeichert', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  },
};
