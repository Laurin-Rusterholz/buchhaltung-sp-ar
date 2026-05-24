import { api } from '../api.js';
import { state } from '../main.js';
import { formatChf, escapeHtml, formatDate } from '../utils.js';

export default {
  async render(container) {
    const jahr = state.aktuellesJahr;
    container.innerHTML = `
      <div class="page-header">
        <h2>Berichte ${jahr}</h2>
        <div class="actions">
          <select id="report-typ">
            <option value="bilanz">Bilanz</option>
            <option value="erfolg">Erfolgsrechnung</option>
            <option value="konto">Kontoauszug</option>
          </select>
          <select id="konto-select" class="hidden"></select>
          <button id="print" class="primary">Drucken / PDF</button>
        </div>
      </div>
      <div id="report-area"></div>
    `;

    const sel = container.querySelector('#report-typ');
    const kontoSelect = container.querySelector('#konto-select');
    const area = container.querySelector('#report-area');

    const konten = await api.listKonten();
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer));
    kontoSelect.innerHTML = konten.map((k) => `<option value="${escapeHtml(k.nummer)}">${escapeHtml(k.nummer)} ${escapeHtml(k.bezeichnung)}</option>`).join('');

    container.querySelector('#print').onclick = () => window.print();

    const draw = async () => {
      area.innerHTML = '<div class="loader">Lädt…</div>';
      const v = state.einstellungen || {};
      kontoSelect.classList.toggle('hidden', sel.value !== 'konto');
      try {
        if (sel.value === 'bilanz') {
          const b = await api.bilanz(jahr);
          area.innerHTML = renderBilanz(b, jahr, v);
        } else if (sel.value === 'erfolg') {
          const er = await api.erfolgsrechnung(jahr);
          area.innerHTML = renderErfolg(er, jahr, v);
        } else {
          const k = await api.kontoauszug(jahr, kontoSelect.value);
          area.innerHTML = renderKonto(k, jahr, v);
        }
      } catch (err) {
        area.innerHTML = `<div class="empty">Fehler: ${err.message}</div>`;
      }
    };

    sel.onchange = draw;
    kontoSelect.onchange = draw;
    draw();
  },
};

function reportHeader(title, jahr, v) {
  return `
    <div class="report-header">
      <h2>${escapeHtml(v.name || 'Verein')}</h2>
      <div>${escapeHtml(title)} – Geschäftsjahr ${jahr}</div>
      <div class="muted small">${escapeHtml(v.adresse || '')} ${escapeHtml(v.plz || '')} ${escapeHtml(v.ort || '')}</div>
    </div>
  `;
}

function renderBilanz(b, jahr, v) {
  const sec = (title, eintraege) => `
    <div class="report-section">
      <h3>${title}</h3>
      ${eintraege.map((e) => `
        <div class="report-line">
          <span>${escapeHtml(e.nummer)} ${escapeHtml(e.bezeichnung)}</span>
          <span>CHF ${formatChf(e.saldo)}</span>
        </div>
      `).join('')}
    </div>
  `;
  return `
    <div class="report">
      ${reportHeader('Bilanz', jahr, v)}
      <div class="report-cols">
        <div>
          ${sec('Aktiven', b.aktiven)}
          <div class="report-line grand-total"><span>Total Aktiven</span><span>CHF ${formatChf(b.total_aktiven)}</span></div>
        </div>
        <div>
          ${sec('Passiven', b.passiven)}
          <div class="report-line total"><span>Vereinsvermögen</span><span>CHF ${formatChf(b.eigenkapital)}</span></div>
          <div class="report-line"><span>Jahresergebnis</span><span>CHF ${formatChf(b.jahresergebnis)}</span></div>
          <div class="report-line grand-total"><span>Total Passiven</span><span>CHF ${formatChf(b.total_passiven)}</span></div>
        </div>
      </div>
    </div>
  `;
}

function renderErfolg(er, jahr, v) {
  const sec = (title, eintraege) => `
    <div class="report-section">
      <h3>${title}</h3>
      ${eintraege.map((e) => `
        <div class="report-line">
          <span>${escapeHtml(e.nummer)} ${escapeHtml(e.bezeichnung)}</span>
          <span>CHF ${formatChf(e.saldo)}</span>
        </div>
      `).join('')}
    </div>
  `;
  const ergebnis = er.total_ertrag - er.total_aufwand;
  return `
    <div class="report">
      ${reportHeader('Erfolgsrechnung', jahr, v)}
      ${sec('Ertrag', er.ertrag)}
      <div class="report-line total"><span>Total Ertrag</span><span>CHF ${formatChf(er.total_ertrag)}</span></div>
      ${sec('Aufwand', er.aufwand)}
      <div class="report-line total"><span>Total Aufwand</span><span>CHF ${formatChf(er.total_aufwand)}</span></div>
      <div class="report-line grand-total"><span>${ergebnis >= 0 ? 'Gewinn' : 'Verlust'}</span><span>CHF ${formatChf(ergebnis)}</span></div>
    </div>
  `;
}

function renderKonto(k, jahr, v) {
  return `
    <div class="report">
      ${reportHeader(`Kontoauszug ${k.nummer} ${k.bezeichnung}`, jahr, v)}
      <table class="data">
        <thead>
          <tr>
            <th>Datum</th><th>Beleg</th><th>Beschreibung</th>
            <th>Gegenkonto</th>
            <th class="num">Soll</th><th class="num">Haben</th><th class="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          ${k.zeilen.map((z) => `
            <tr>
              <td>${formatDate(z.datum)}</td>
              <td>${escapeHtml(z.beleg_nr || '')}</td>
              <td>${escapeHtml(z.beschreibung)}</td>
              <td class="muted">${escapeHtml(z.gegenkonto)}</td>
              <td class="num">${z.soll ? formatChf(z.soll) : ''}</td>
              <td class="num">${z.haben ? formatChf(z.haben) : ''}</td>
              <td class="num">${formatChf(z.saldo)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="4">Schlusssaldo</td>
            <td class="num">${formatChf(k.total_soll)}</td>
            <td class="num">${formatChf(k.total_haben)}</td>
            <td class="num">${formatChf(k.saldo)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}
