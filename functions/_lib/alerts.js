import { isAllowedOrigin } from './cors.js';

const SYMBOL_RE = /^[0-9A-Za-z]{1,12}$/;
const USER_ID_RE = /^[A-Za-z0-9_]{1,80}$/;
const KEY_RE = /^[A-Za-z0-9_\-+/=]{16,256}$/;
const MAX_SUBSCRIBERS = 500;
const MAX_USER_IDS = 50;

export function vapidReady(env) {
  const pub = String(env?.VAPID_PUBLIC_KEY || '').trim();
  const priv = String(env?.VAPID_PRIVATE_KEY || '').trim();
  if (!pub || !priv) return false;
  if (pub.includes('VAPID_PUBLIC_KEY') || priv.includes('VAPID_PRIVATE_KEY')) return false;
  return true;
}

export function pushSendReady(env) {
  const secret = String(env?.ALERT_PUSH_SECRET || '').trim();
  if (!secret || secret.includes('ALERT_PUSH_SECRET')) return false;
  return vapidReady(env);
}

export function vapidPublicKey(env) {
  if (!vapidReady(env)) return null;
  return String(env.VAPID_PUBLIC_KEY).trim();
}

export async function secretsMatch(provided, expected) {
  const left = String(provided || '');
  const right = String(expected || '');
  if (!left || !right) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(left)),
    crypto.subtle.digest('SHA-256', enc.encode(right)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i += 1) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function pagesDevOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    return (
      url.hostname === 'tradingvenator.pages.dev' ||
      url.hostname.endsWith('.tradingvenator.pages.dev')
    );
  } catch {
    return false;
  }
}

export function normalizeAlertUrl(raw, env) {
  if (raw == null || String(raw).trim() === '') return { url: '/' };
  const text = String(raw).trim();
  if (text.startsWith('/') && !text.startsWith('//')) {
    if (text.length > 300) return { error: 'url is too long' };
    return { url: text };
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return { error: 'Invalid url' };
  }
  if (!isAllowedOrigin(url.origin, env) && !pagesDevOrigin(url.origin)) {
    return { error: 'url must point at this site' };
  }
  return { url: `${url.pathname}${url.search}${url.hash}` || '/' };
}

export function collectUserIds(body) {
  const hasList = Array.isArray(body.user_ids);
  const single = body.clerk_user_id;
  const hasOne = single != null && String(single).trim() !== '';
  if (!hasList && !hasOne) return { ids: null };
  const raw = [];
  if (hasOne) raw.push(String(single).trim());
  if (hasList) {
    for (const item of body.user_ids) raw.push(item);
  }
  if (raw.length > MAX_USER_IDS) return { error: 'user_ids must contain at most 50 ids' };
  const ids = [];
  for (const item of raw) {
    const id = String(item || '').trim();
    if (!USER_ID_RE.test(id)) return { error: 'Invalid user id' };
    ids.push(id);
  }
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { ids: null };
  return { ids: unique };
}

export function normalizeAlert(body, env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body must be a JSON object' };
  }
  const symbol = String(body.symbol || '').trim();
  if (!SYMBOL_RE.test(symbol)) return { error: 'symbol must be 1-12 letters or digits' };
  const title = String(body.title || '').trim();
  const text = String(body.body || '').trim();
  if (!title || title.length > 80) return { error: 'title must be 1-80 characters' };
  if (!text || text.length > 240) return { error: 'body must be 1-240 characters' };
  const urlResult = normalizeAlertUrl(body.url, env);
  if (urlResult.error) return { error: urlResult.error };
  const users = collectUserIds(body);
  if (users.error) return { error: users.error };
  return {
    alert: {
      symbol,
      title,
      body: text,
      url: urlResult.url,
      userIds: users.ids,
    },
  };
}

export function listSubscriptionsQuery(userIds) {
  const columns = 'id, user_id, endpoint, p256dh, auth';
  if (!userIds || userIds.length === 0) {
    return {
      sql: `SELECT ${columns} FROM push_subscriptions WHERE alerts_enabled = 1 LIMIT ${MAX_SUBSCRIBERS}`,
      binds: [],
      fanout: true,
    };
  }
  const placeholders = userIds.map(() => '?').join(', ');
  return {
    sql: `SELECT ${columns} FROM push_subscriptions WHERE alerts_enabled = 1 AND user_id IN (${placeholders}) LIMIT ${MAX_SUBSCRIBERS}`,
    binds: userIds,
    fanout: false,
  };
}

export function validEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2000) return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validPushKey(value) {
  return typeof value === 'string' && KEY_RE.test(value);
}

export function parseSubscription(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid subscription' };
  }
  const endpoint = String(body.endpoint || '').trim();
  const keys = body.keys && typeof body.keys === 'object' ? body.keys : {};
  const p256dh = String(keys.p256dh || body.p256dh || '').trim();
  const auth = String(keys.auth || body.auth || '').trim();
  if (!validEndpoint(endpoint) || !validPushKey(p256dh) || !validPushKey(auth)) {
    return { error: 'Invalid subscription' };
  }
  return { subscription: { endpoint, p256dh, auth } };
}

export function pushStatusCode(err) {
  const code = Number(err && (err.statusCode || err.status));
  return Number.isFinite(code) ? code : 0;
}

export function isGoneStatus(status) {
  return status === 404 || status === 410;
}

export async function deliverAlerts(db, rows, payload, sendOne) {
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sendOne(row, payload);
      sent += 1;
    } catch (err) {
      const status = pushStatusCode(err);
      if (isGoneStatus(status)) {
        await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(row.endpoint).run();
        removed += 1;
      } else {
        failed += 1;
        console.error('web push failed', status || (err && err.message) || 'unknown');
      }
    }
  }
  return { sent, removed, failed };
}

export async function loadSubscriptions(db, userIds) {
  const query = listSubscriptionsQuery(userIds);
  const stmt = db.prepare(query.sql);
  const result = query.binds.length ? await stmt.bind(...query.binds).all() : await stmt.all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  return { rows, fanout: query.fanout };
}
