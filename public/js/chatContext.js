// Gemeinsame Helfer für den schwebenden Chat (chat.js) und die Chat-View
// (views/assistent.js): baut den Buchhaltungs-Snapshot als System-Kontext
// und enthält einen leichten Markdown-Renderer.

import { api } from './api.js';
import { state } from './main.js';
import { escapeHtml, formatChf } from './utils.js';

// Sehr leichtgewichtiger Markdown-Renderer.
export function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code}</pre>`);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/(^|\n)[*-] (.+)/g, '$1<li>$2</li>');
  html = html.replace(/(<li>.*?<\/li>(\s*<li>.*?<\/li>)*)/gs, '<ul>$1</ul>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// Kompakter Snapshot der Buchhaltung – wird als Cache-fähiger System-Block
// an Claude geschickt. Innerhalb einer Session bleibt der Snapshot identisch
// und wird via Prompt-Caching wiederverwendet (~90% Rabatt auf Folgefragen).
export async function buildSystemContext() {
  const jahr = state.aktuellesJahr;
  try {
    const [konten, buchungen, sektionen, rechnungen, einst, budget] = await Promise.all([
      api.listKonten(),
      api.listBuchungen(jahr),
      api.listSektionen(),
      api.listRechnungen(jahr),
      api.getEinstellungen(),
      api.getBudget(jahr).catch(() => null),
    ]);
    const lines = [];
    lines.push(`Verein: ${einst.name || '—'} (${einst.untertitel || ''})`);
    lines.push(`Aktuelles Geschäftsjahr: ${jahr}`);
    lines.push('');
    lines.push('## Kontenplan (Nr / Bezeichnung / Typ)');
    konten.sort((a, b) => a.nummer.localeCompare(b.nummer))
      .forEach((k) => lines.push(`- ${k.nummer} ${k.bezeichnung} [${k.typ}${k.kategorie ? '/' + k.kategorie : ''}]`));
    lines.push('');
    lines.push(`## Buchungen ${jahr} (gesamt ${buchungen.length})`);
    const recent = buchungen.slice().sort((a, b) => (b.datum || '').localeCompare(a.datum || '')).slice(0, 60);
    recent.forEach((b) => lines.push(`- ${b.datum} | ${b.beleg_nr || ''} | ${b.soll}→${b.haben} | CHF ${formatChf(b.betrag)} | ${b.beschreibung}${b.bezahlt ? ' [bezahlt]' : ''}`));
    if (buchungen.length > 60) lines.push(`(... ${buchungen.length - 60} weitere Buchungen)`);
    lines.push('');
    if (budget?.positionen?.length) {
      lines.push(`## Voranschlag (Budget) ${jahr}`);
      budget.positionen.forEach((p) => lines.push(`- ${p.konto}: CHF ${formatChf(p.betrag)} – ${p.notiz || ''}`));
      lines.push('');
    }
    lines.push(`## Rechnungen ${jahr} (${rechnungen.length})`);
    rechnungen.slice(0, 30).forEach((r) => lines.push(`- ${r.nummer} | ${r.datum} | ${r.empfaenger_name} | CHF ${formatChf(r.total)} | Status: ${r.status}${r.faellig_am ? ' | fällig ' + r.faellig_am : ''}`));
    lines.push('');
    lines.push(`## Sektionen (${sektionen.length})`);
    sektionen.forEach((s) => lines.push(`- ${s.name} | ${s.anzahl_mitglieder || 0} Mitglieder × CHF ${s.beitrag_pro_mitglied || 0} = CHF ${formatChf((s.anzahl_mitglieder || 0) * (s.beitrag_pro_mitglied || 0))}`));
    return lines.join('\n');
  } catch (e) {
    return `(Kontext konnte nicht geladen werden: ${e.message})`;
  }
}
