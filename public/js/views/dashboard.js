import { api } from '../api.js';
import { state } from '../main.js';
import { formatChf, formatDate, escapeHtml } from '../utils.js';

export default {
  async render(container) {
    const jahr = state.aktuellesJahr;
    const [buchungen, konten, sektionen, rechnungen, er, bilanz] = await Promise.all([
      api.listBuchungen(jahr),
      api.listKonten(),
      api.listSektionen(),
      api.listRechnungen(jahr),
      api.erfolgsrechnung(jahr).catch(() => null),
      api.bilanz(jahr).catch(() => null),
    ]);

    const kontoMap = new Map(konten.map((k) => [k.nummer, k]));
    const liquideKonten = konten.filter((k) => k.kategorie === 'liquid');
    const liquiditaet = liquideKonten.reduce((sum, k) => sum + saldoAktiv(k.nummer, buchungen), 0);

    const totalErtrag = er?.total_ertrag || 0;
    const totalAufwand = er?.total_aufwand || 0;
    const ergebnis = totalErtrag - totalAufwand;

    const offeneRechnungen = rechnungen.filter((r) => r.status === 'offen');
    const offenSum = offeneRechnungen.reduce((s, r) => s + Number(r.total || 0), 0);

    const letzteBuchungen = buchungen.slice().sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 10);

    container.innerHTML = `
      <div class="page-header">
        <h2>Dashboard ${jahr}</h2>
      </div>

      <div class="cards-grid">
        <div class="kpi">
          <div class="kpi-label">Liquidität</div>
          <div class="kpi-value">CHF ${formatChf(liquiditaet)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Ertrag</div>
          <div class="kpi-value positive">CHF ${formatChf(totalErtrag)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Aufwand</div>
          <div class="kpi-value negative">CHF ${formatChf(totalAufwand)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Ergebnis</div>
          <div class="kpi-value ${ergebnis >= 0 ? 'positive' : 'negative'}">CHF ${formatChf(ergebnis)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Sektionen / Mitglieder</div>
          <div class="kpi-value">${sektionen.filter((s) => (s.status || 'aktiv') === 'aktiv').length} <span class="muted small">/ ${sektionen.filter((s) => (s.status || 'aktiv') === 'aktiv').reduce((sum, s) => sum + Number(s.anzahl_mitglieder || 0), 0)}</span></div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Offene Rechnungen</div>
          <div class="kpi-value">${offeneRechnungen.length} <span class="muted small">CHF ${formatChf(offenSum)}</span></div>
        </div>
      </div>

      <div class="card">
        <h3>Liquide Konten</h3>
        ${liquideKonten.length === 0 ? '<div class="muted">Keine liquiden Konten angelegt.</div>' : `
          <table class="data">
            <thead><tr><th>Konto</th><th>Bezeichnung</th><th class="num">Saldo</th></tr></thead>
            <tbody>
              ${liquideKonten.map((k) => `
                <tr>
                  <td>${escapeHtml(k.nummer)}</td>
                  <td>${escapeHtml(k.bezeichnung)}</td>
                  <td class="num">CHF ${formatChf(saldoAktiv(k.nummer, buchungen))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      <div class="card">
        <h3>Letzte Buchungen</h3>
        ${letzteBuchungen.length === 0 ? '<div class="muted">Noch keine Buchungen erfasst.</div>' : `
          <table class="data">
            <thead>
              <tr><th>Datum</th><th>Beleg</th><th>Beschreibung</th><th>Soll</th><th>Haben</th><th class="num">Betrag</th></tr>
            </thead>
            <tbody>
              ${letzteBuchungen.map((b) => `
                <tr>
                  <td>${formatDate(b.datum)}</td>
                  <td>${escapeHtml(b.beleg_nr || '')}</td>
                  <td>${escapeHtml(b.beschreibung)}</td>
                  <td><span class="muted small">${escapeHtml(b.soll)}</span> ${escapeHtml(kontoMap.get(b.soll)?.bezeichnung || '')}</td>
                  <td><span class="muted small">${escapeHtml(b.haben)}</span> ${escapeHtml(kontoMap.get(b.haben)?.bezeichnung || '')}</td>
                  <td class="num">${formatChf(b.betrag)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `}
      </div>

      ${bilanz ? `
        <div class="card">
          <h3>Bilanzsumme</h3>
          <div class="flex between">
            <div>
              <div class="muted small">Aktiven</div>
              <div class="bold">CHF ${formatChf(bilanz.total_aktiven)}</div>
            </div>
            <div>
              <div class="muted small">Passiven</div>
              <div class="bold">CHF ${formatChf(bilanz.total_passiven)}</div>
            </div>
            <div>
              <div class="muted small">Vereinsvermögen</div>
              <div class="bold">CHF ${formatChf(bilanz.eigenkapital)}</div>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  },
};

function saldoAktiv(kontoNr, buchungen) {
  let sum = 0;
  for (const b of buchungen) {
    if (b.soll === kontoNr) sum += Number(b.betrag);
    if (b.haben === kontoNr) sum -= Number(b.betrag);
  }
  return sum;
}
