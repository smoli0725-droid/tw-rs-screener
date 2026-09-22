import { json } from '../../_lib/cors.js';
import { parseSubscription, vapidReady } from '../../_lib/alerts.js';
import { nowIso, upsertUser } from '../../_lib/db.js';

const MAX_BODY_BYTES = 16 * 1024;

export async function onRequestPost({ request, env, data }) {
  if (!vapidReady(env)) {
    return json({ error: 'Push is not configured', configured: false }, 503, request, env);
  }
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
  const parsed = parseSubscription(body);
  if (parsed.error) return json({ error: parsed.error }, 400, request, env);

  const ua = String(request.headers.get('user-agent') || '').slice(0, 300) || null;
  const ts = nowIso();
  try {
    await upsertUser(env.DB, data.userId);
    await env.DB.prepare(
      `INSERT INTO push_subscriptions
         (user_id, endpoint, p256dh, auth, user_agent, alerts_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         alerts_enabled = 1,
         updated_at = excluded.updated_at`
    )
      .bind(
        data.userId,
        parsed.subscription.endpoint,
        parsed.subscription.p256dh,
        parsed.subscription.auth,
        ua,
        ts,
        ts
      )
      .run();
    return json({ ok: true, alertsEnabled: true }, 200, request, env);
  } catch (err) {
    console.error('POST /api/alerts/subscribe failed', err);
    return json({ error: 'Failed to save subscription' }, 500, request, env);
  }
}
