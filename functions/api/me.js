import { json } from '../_lib/cors.js';
import { getUserData, upsertUser } from '../_lib/db.js';

export async function onRequestGet({ request, env, data }) {
  try {
    const user = await upsertUser(env.DB, data.userId);
    const payload = await getUserData(env.DB, data.userId);
    return json(
      {
        id: user.id,
        plan: user.plan || 'free',
        plan_expires_at: user.plan_expires_at,
        created_at: user.created_at,
        trades: Array.isArray(payload.trades) ? payload.trades : [],
        settings: payload.settings && typeof payload.settings === 'object' ? payload.settings : {},
        updated_at: payload.updated_at,
      },
      200,
      request,
      env
    );
  } catch (err) {
    console.error('GET /api/me failed', err);
    return json({ error: 'Failed to load profile' }, 500, request, env);
  }
}
