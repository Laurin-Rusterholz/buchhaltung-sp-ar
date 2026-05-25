// Hilfsfunktionen: Formatierung, IDs, DOM-Helpers

export function formatChf(value) {
  const n = Number(value || 0);
  return n.toLocaleString('de-CH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatChfSigned(value) {
  const n = Number(value || 0);
  const s = formatChf(Math.abs(n));
  return n < 0 ? `-${s}` : s;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-CH');
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function currentYear() {
  return new Date().getFullYear();
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function h(html, target) {
  if (typeof target === 'string') target = document.querySelector(target);
  if (target) target.innerHTML = html;
  return html;
}

export function on(selector, event, handler, root = document) {
  root.querySelectorAll(selector).forEach((el) => el.addEventListener(event, handler));
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function downloadFile(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(';')];
  for (const row of rows) lines.push(row.map(csvEscape).join(';'));
  return '﻿' + lines.join('\n');
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Hash-URL parsen: "#route?key=value&other=x" → { route, params }
export function parseHash(hash = location.hash) {
  const raw = (hash || '').replace(/^#/, '');
  const [route, qs] = raw.split('?');
  const params = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      const [k, v] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { route: route || 'dashboard', params };
}
