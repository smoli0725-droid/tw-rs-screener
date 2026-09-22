import { sendNotification } from 'web-push-neo';
import { pushSendReady, vapidReady } from './alerts.js';

export { pushSendReady, vapidReady };

function vapidSubject(env) {
  const raw = String(env?.VAPID_SUBJECT || 'mailto:smoli0725@gmail.com').trim();
  if (!raw) return 'mailto:smoli0725@gmail.com';
  if (raw.startsWith('mailto:') || raw.startsWith('https://')) return raw;
  return `mailto:${raw}`;
}

export async function sendWebPush(env, row, payload) {
  const symbol = String(payload.symbol || '');
  const topic = /^[A-Za-z0-9_-]{1,32}$/.test(symbol) ? symbol : undefined;
  return sendNotification(
    {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth,
      },
    },
    JSON.stringify({
      title: payload.title,
      body: payload.body,
      symbol: payload.symbol,
      url: payload.url || '/',
    }),
    {
      vapidDetails: {
        subject: vapidSubject(env),
        publicKey: String(env.VAPID_PUBLIC_KEY).trim(),
        privateKey: String(env.VAPID_PRIVATE_KEY).trim(),
      },
      TTL: 60 * 60,
      urgency: 'high',
      topic,
    }
  );
}
