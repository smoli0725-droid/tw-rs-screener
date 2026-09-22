import { requireUser } from '../_lib/auth.js';
import { isAllowedOrigin, json, withCors } from '../_lib/cors.js';

function isWatcherPush(request) {
  if (request.method !== 'POST') return false;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/alerts/push';
}

export async function onRequest(context) {
  const { request, next, env, data } = context;
  const origin = request.headers.get('Origin');
  if (origin && !isAllowedOrigin(origin, env)) {
    return json({ error: 'Origin not allowed' }, 403, request, env);
  }
  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }), request, env);
  }
  if (!env.DB) {
    return json(
      { error: 'D1 database is not bound. Create the DB and set D1_DATABASE_ID.' },
      503,
      request,
      env
    );
  }
  // The laptop watcher is not a Clerk user. POST /api/alerts/push checks
  // X-Alert-Push-Secret itself. Every other /api route still requires Clerk.
  if (!isWatcherPush(request)) {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    data.userId = auth.userId;
  }
  const res = await next();
  return withCors(res, request, env);
}
