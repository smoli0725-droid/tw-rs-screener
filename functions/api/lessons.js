import { json } from '../_lib/cors.js';
import { getSiteContent, putSiteContent } from '../_lib/db.js';
import { isSiteOwner } from '../_lib/owner.js';
import { createClerkClient } from '@clerk/backend';

const MAX_LESSONS = 50;
const MAX_TITLE = 80;
const MAX_BODY = 8000;
const MAX_BODY_BYTES = 256 * 1024;

function jwtKeyFromEnv(env) {
  const raw = env.CLERK_JWT_KEY;
  if (!raw || !String(raw).trim()) return undefined;
  return String(raw).replace(/\\n/g, '\n');
}

function normalizeLesson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  const body = String(raw.body || '').trim();
  if (!id || !title || !body) return null;
  if (id.length > 80 || title.length > MAX_TITLE || body.length > MAX_BODY) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id)) return null;
  return {
    id,
    title,
    body,
    published_at: String(raw.published_at || '').slice(0, 10),
  };
}

function normalizeList(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_LESSONS) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const lesson = normalizeLesson(item);
    if (!lesson) return null;
    if (seen.has(lesson.id)) return null;
    seen.add(lesson.id);
    out.push(lesson);
  }
  return out;
}

async function loadOwnerUser(env, userId) {
  const clerk = createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    jwtKey: jwtKeyFromEnv(env),
  });
  return clerk.users.getUser(userId);
}

export async function onRequestGet({ request, env }) {
  try {
    const row = await getSiteContent(env.DB, 'lessons');
    if (!row) {
      return json({ lessons: null, source: 'empty' }, 200, request, env);
    }
    const lessons = normalizeList(row.value) || [];
    return json(
      { lessons, source: 'd1', updated_at: row.updated_at || null },
      200,
      request,
      env
    );
  } catch (err) {
    console.error('GET /api/lessons failed', err);
    return json({ lessons: null, source: 'empty' }, 200, request, env);
  }
}

export async function onRequestPut({ request, env, data }) {
  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_BODY_BYTES) {
    return json({ error: 'Payload too large' }, 413, request, env);
  }
  let user;
  try {
    user = await loadOwnerUser(env, data.userId);
  } catch (err) {
    console.error('Clerk getUser failed', err);
    return json({ error: 'Forbidden' }, 403, request, env);
  }
  if (!isSiteOwner(user, env)) {
    return json({ error: 'Forbidden' }, 403, request, env);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400, request, env);
  }
  const lessons = normalizeList(body && body.lessons);
  if (!lessons) {
    return json({ error: 'lessons must be a valid array of text posts' }, 400, request, env);
  }
  try {
    const updated_at = await putSiteContent(env.DB, 'lessons', lessons, data.userId);
    return json({ ok: true, lessons, source: 'd1', updated_at }, 200, request, env);
  } catch (err) {
    console.error('PUT /api/lessons failed', err);
    return json({ error: 'Failed to save lessons' }, 500, request, env);
  }
}
