import { json } from '../../_lib/cors.js';
import {
  deliverAlerts,
  loadSubscriptions,
  normalizeAlert,
  secretsMatch,
} from '../../_lib/alerts.js';
import { pushSendReady, sendWebPush } from '../../_lib/webpush.js';

const MAX_BODY_BYTES = 16 * 1024;

export async function onRequestPost({ request, env }) {
  if (!pushSendReady(env)) {
    return json({ error: 'Push is not configured', configured: false }, 503, request, env);
  }
  const provided = request.headers.get('X-Alert-Push-Secret') || '';
  if (!(await secretsMatch(provided, env.ALERT_PUSH_SECRET))) {
    return json({ error: 'Unauthorized' }, 401, request, env);
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
  const parsed = normalizeAlert(body, env);
  if (parsed.error) return json({ error: parsed.error }, 400, request, env);

  try {
    const { rows, fanout } = await loadSubscriptions(env.DB, parsed.alert.userIds);
    const result = await deliverAlerts(env.DB, rows, parsed.alert, (row, payload) =>
      sendWebPush(env, row, payload)
    );
    return json(
      {
        ok: true,
        fanout,
        matched: rows.length,
        sent: result.sent,
        removed: result.removed,
        failed: result.failed,
      },
      200,
      request,
      env
    );
  } catch (err) {
    console.error('POST /api/alerts/push failed', err);
    return json({ error: 'Failed to send push' }, 500, request, env);
  }
}
