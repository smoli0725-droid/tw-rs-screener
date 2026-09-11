import { json } from '../_lib/cors.js';
import { getUserData, putUserData, upsertUser } from '../_lib/db.js';

const MAX_BODY_BYTES = 512 * 1024;

export async function onRequestGet({ request, env, data }) {
  try {
    await upsertUser(env.DB, data.userId);
    const payload = await getUserData(env.DB, data.userId);
    return json(
      {
        trades: Array.isArray(payload.trades) ? payload.trades : [],
        settings: payload.settings && typeof payload.settings === 'object' ? payload.settings : {},
        updated_at: payload.updated_at,
      },
      200,
      request,
      env
    );
  } catch (err) {
    console.error('GET /api/data failed', err);
    return json({ error: 'Failed to load data' }, 500, request, env);
  }
}

export async function onRequestPut({ request, env, data }) {
  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_BODY_BYTES) {
    return json({ error: 'Payload too large' }, 413, request, env);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, request, env);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Body must be an object with trades and settings' }, 400, request, env);
  }
  const trades = body.trades;
  const settings = body.settings;
  if (!Array.isArray(trades)) {
    return json({ error: 'trades must be an array' }, 400, request, env);
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return json({ error: 'settings must be an object' }, 400, request, env);
  }
  try {
    JSON.stringify({ trades, settings });
  } catch {
    return json({ error: 'Payload is not serializable' }, 400, request, env);
  }
  try {
    await upsertUser(env.DB, data.userId);
    const updated_at = await putUserData(env.DB, data.userId, trades, settings);
    return json({ ok: true, updated_at }, 200, request, env);
  } catch (err) {
    console.error('PUT /api/data failed', err);
    return json({ error: 'Failed to save data' }, 500, request, env);
  }
}
