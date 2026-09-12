import { requireUser } from '../_lib/auth.js';
import { isAllowedOrigin, json, withCors } from '../_lib/cors.js';

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
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  data.userId = auth.userId;
  const res = await next();
  return withCors(res, request, env);
}
