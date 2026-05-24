export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, { status });
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function pathSegments(req, prefix) {
  const url = new URL(req.url);
  let p = url.pathname;
  const idx = p.indexOf(`/${prefix}`);
  if (idx >= 0) p = p.slice(idx + prefix.length + 1);
  return p.split('/').filter(Boolean);
}

export function param(req, name) {
  return new URL(req.url).searchParams.get(name);
}
