import { api } from '../api.js';
import { state } from '../main.js';
import { escapeHtml } from '../utils.js';
import { toast } from '../components.js';

export default {
  async render(container) {
    const e = await api.getEinstellungen();

    container.innerHTML = `
      <div class="page-header">
        <h2>Einstellungen</h2>
      </div>

      <div class="card">
        <h3>Vereinsdaten</h3>
        <div class="form-grid">
          <div class="input-group"><label>Vereinsname</label><input name="name" value="${escapeHtml(e.name || '')}" /></div>
          <div class="input-group"><label>Untertitel</label><input name="untertitel" value="${escapeHtml(e.untertitel || '')}" /></div>
          <div class="input-group full"><label>Adresse</label><input name="adresse" value="${escapeHtml(e.adresse || '')}" /></div>
          <div class="input-group"><label>PLZ</label><input name="plz" value="${escapeHtml(e.plz || '')}" /></div>
          <div class="input-group"><label>Ort</label><input name="ort" value="${escapeHtml(e.ort || '')}" /></div>
          <div class="input-group"><label>Email</label><input name="email" type="email" value="${escapeHtml(e.email || '')}" /></div>
          <div class="input-group"><label>Telefon</label><input name="telefon" value="${escapeHtml(e.telefon || '')}" /></div>
          <div class="input-group"><label>Website</label><input name="website" value="${escapeHtml(e.website || '')}" /></div>
          <div class="input-group"><label>UID / Vereins-Nr</label><input name="uid" value="${escapeHtml(e.uid || '')}" /></div>
        </div>
      </div>

      <div class="card">
        <h3>Bankverbindung</h3>
        <div class="form-grid">
          <div class="input-group"><label>Bank</label><input name="bank" value="${escapeHtml(e.bank || '')}" /></div>
          <div class="input-group"><label>IBAN</label><input name="iban" value="${escapeHtml(e.iban || '')}" placeholder="CH00 0000 0000 0000 0000 0" /></div>
          <div class="input-group"><label>BIC</label><input name="bic" value="${escapeHtml(e.bic || '')}" /></div>
          <div class="input-group"><label>QR-IBAN</label><input name="qr_iban" value="${escapeHtml(e.qr_iban || '')}" /></div>
        </div>
      </div>

      <div class="card">
        <h3>Standardkonten</h3>
        <p class="muted small">Werden bei automatisch generierten Buchungen verwendet (z.B. Eröffnung).</p>
        <div class="form-grid">
          <div class="input-group"><label>Eigenkapital-Konto</label><input name="konto_eigenkapital" value="${escapeHtml(e.konto_eigenkapital || '')}" placeholder="z.B. 2800" /></div>
          <div class="input-group"><label>Jahresergebnis-Konto</label><input name="konto_ergebnis" value="${escapeHtml(e.konto_ergebnis || '')}" placeholder="z.B. 2900" /></div>
          <div class="input-group"><label>Mitgliederbeitrags-Konto</label><input name="konto_mitgliederbeitrag" value="${escapeHtml(e.konto_mitgliederbeitrag || '')}" placeholder="z.B. 3000" /></div>
          <div class="input-group"><label>Bank-Konto (Standard)</label><input name="konto_bank" value="${escapeHtml(e.konto_bank || '')}" placeholder="z.B. 1020" /></div>
        </div>
      </div>

      <div class="flex">
        <button class="primary" id="save">Speichern</button>
      </div>
    `;

    container.querySelector('#save').onclick = async () => {
      const data = {};
      container.querySelectorAll('[name]').forEach((el) => (data[el.name] = el.value.trim()));
      try {
        await api.saveEinstellungen(data);
        state.einstellungen = data;
        if (data.name) {
          document.querySelector('#brand').textContent = data.name;
          document.title = `Buchhaltung – ${data.name}`;
        }
        if (data.untertitel) document.querySelector('#brand-subtitle').textContent = data.untertitel;
        toast('Einstellungen gespeichert', 'success');
      } catch (err) { toast(err.message, 'error'); }
    };
  },
};
