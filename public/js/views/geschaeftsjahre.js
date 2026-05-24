import { api } from '../api.js';
import { state, reloadJahre } from '../main.js';
import { escapeHtml, formatDate, currentYear } from '../utils.js';
import { modal, toast, confirmDialog } from '../components.js';

export default {
  async render(container) {
    let jahre = await api.listJahre();

    container.innerHTML = `
      <div class="page-header">
        <h2>Geschäftsjahre</h2>
        <div class="actions">
          <button class="primary" id="add">+ Neues Geschäftsjahr</button>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Jahr</th><th>Beginn</th><th>Ende</th><th>Status</th><th></th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    const tbody = container.querySelector('tbody');
    const renderRows = () => {
      const rows = jahre.slice().sort((a, b) => b.jahr - a.jahr);
      tbody.innerHTML = rows.length === 0
        ? '<tr><td colspan="5" class="muted center">Noch keine Geschäftsjahre angelegt.</td></tr>'
        : rows.map((j) => `
          <tr>
            <td><strong>${j.jahr}</strong></td>
            <td>${formatDate(j.beginn)}</td>
            <td>${formatDate(j.ende)}</td>
            <td>${j.geschlossen ? '<span class="badge danger">Geschlossen</span>' : '<span class="badge success">Offen</span>'}</td>
            <td class="right">
              ${j.geschlossen ? '' : `<button class="sm" data-close="${j.id}">Abschliessen</button>`}
              <button class="sm danger" data-delete="${j.id}">Löschen</button>
            </td>
          </tr>
        `).join('');
    };
    renderRows();

    container.querySelector('#add').onclick = () => openForm();

    tbody.addEventListener('click', async (e) => {
      const deleteId = e.target?.dataset?.delete;
      const closeId = e.target?.dataset?.close;
      if (closeId) {
        if (!(await confirmDialog('Geschäftsjahr wirklich abschliessen? Es können danach keine Buchungen mehr erfasst werden.', { confirmLabel: 'Abschliessen', danger: false }))) return;
        try {
          await api.schliessen(closeId);
          jahre = await api.listJahre();
          renderRows();
          toast('Abgeschlossen', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
      if (deleteId) {
        if (!(await confirmDialog('Geschäftsjahr wirklich löschen? Alle zugehörigen Buchungen werden ebenfalls entfernt.'))) return;
        try {
          await api.deleteJahr(deleteId);
          jahre = await api.listJahre();
          renderRows();
          await reloadJahre();
          toast('Gelöscht', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }
    });

    function openForm() {
      const j = { jahr: currentYear(), beginn: `${currentYear()}-01-01`, ende: `${currentYear()}-12-31` };
      const m = modal({
        title: 'Neues Geschäftsjahr',
        body: `
          <div class="form-grid">
            <div class="input-group"><label>Jahr</label><input name="jahr" type="number" min="2000" max="2100" value="${j.jahr}" /></div>
            <div class="input-group"></div>
            <div class="input-group"><label>Beginn</label><input name="beginn" type="date" value="${j.beginn}" /></div>
            <div class="input-group"><label>Ende</label><input name="ende" type="date" value="${j.ende}" /></div>
          </div>
        `,
        footer: `<button data-cancel>Abbrechen</button><button class="primary" data-save>Anlegen</button>`,
      });
      m.footerEl.querySelector('[data-cancel]').onclick = m.close;
      m.footerEl.querySelector('[data-save]').onclick = async () => {
        const data = {};
        m.bodyEl.querySelectorAll('[name]').forEach((el) => (data[el.name] = el.value));
        data.jahr = Number(data.jahr);
        try {
          await api.saveJahr(data);
          m.close();
          jahre = await api.listJahre();
          renderRows();
          await reloadJahre();
          toast('Geschäftsjahr angelegt', 'success');
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  },
};
