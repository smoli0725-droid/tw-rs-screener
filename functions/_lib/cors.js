/** Origins allowed to call /api from a browser. Same-origin requests may omit Origin. */

const PROD_ORIGIN = 'https://tradingvenator.pages.dev';

function extraOrigins(env) {
  const raw = env?.ALLOWED_ORIGINS || '';
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  if (origin === PROD_ORIGIN) return true;
  if (extraOrigins(env).includes(origin)) return true;
  try {
    const u = new URL(origin);
    const localHost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return localHost && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch {
    return false;
  }
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && isAllowedOrigin(origin, env)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  const extra = corsHeaders(request, env);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function json(body, status, request, env) {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }),
    request,
    env
  );
}
