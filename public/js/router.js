// Einfacher Hash-Router mit Query-Parameter-Support

import { $, $$, parseHash } from './utils.js';

const routes = {};

export function register(name, view) {
  routes[name] = view;
}

function currentRoute() {
  return parseHash().route;
}

export async function renderRoute() {
  const { route, params } = parseHash();
  const view = routes[route];
  const container = $('#view');

  $$('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === route);
  });

  if (!view) {
    container.innerHTML = `<div class="empty">Unbekannte Ansicht: ${route}</div>`;
    return;
  }
  container.innerHTML = '<div class="loader">Lädt…</div>';
  try {
    await view.render(container, params);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty">Fehler beim Laden: ${err.message}</div>`;
  }
}

export function start() {
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

export function navigate(route) {
  location.hash = route;
}
