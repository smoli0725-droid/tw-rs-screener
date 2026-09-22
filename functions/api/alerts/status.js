import { json } from '../../_lib/cors.js';
import { vapidPublicKey } from '../../_lib/alerts.js';
import { upsertUser } from '../../_lib/db.js';

export async function onRequestGet({ request, env, data }) {
  try {
    await upsertUser(env.DB, data.userId);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ? AND alerts_enabled = 1`
    )
      .bind(data.userId)
      .first();
    const count = Number(row?.n || 0);
    return json(
      {
        configured: Boolean(vapidPublicKey(env)),
        publicKey: vapidPublicKey(env),
        subscriptionCount: count,
        alertsEnabled: count > 0,
      },
      200,
      request,
      env
    );
  } catch (err) {
    console.error('GET /api/alerts/status failed', err);
    return json({ error: 'Failed to load push status' }, 500, request, env);
  }
}
