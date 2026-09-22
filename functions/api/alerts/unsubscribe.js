import { json } from '../../_lib/cors.js';
import { validEndpoint } from '../../_lib/alerts.js';

const MAX_BODY_BYTES = 8 * 1024;

export async function onRequestPost({ request, env, data }) {
  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_BODY_BYTES) {
    return json({ error: 'Payload too large' }, 413, request, env);
  }
  let body = {};
  const text = await request.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'Invalid JSON' }, 400, request, env);
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid JSON' }, 400, request, env);
  }
  const endpoint = body.endpoint != null ? String(body.endpoint).trim() : '';
  if (endpoint && !validEndpoint(endpoint)) {
    return json({ error: 'Invalid subscription' }, 400, request, env);
  }
  try {
    if (endpoint) {
      await env.DB.prepare(
        `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`
      )
        .bind(data.userId, endpoint)
        .run();
    } else {
      await env.DB.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`)
        .bind(data.userId)
        .run();
    }
    return json({ ok: true, alertsEnabled: false }, 200, request, env);
  } catch (err) {
    console.error('POST /api/alerts/unsubscribe failed', err);
    return json({ error: 'Failed to remove subscription' }, 500, request, env);
  }
}
