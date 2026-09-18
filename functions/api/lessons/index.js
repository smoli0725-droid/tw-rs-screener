import { json } from '../../_lib/cors.js';
import { getSiteContent, putSiteContent } from '../../_lib/db.js';
import { normalizeList } from '../../_lib/lessons.js';
import { requireOwner } from '../../_lib/require_owner.js';

const MAX_BODY_BYTES = 256 * 1024;
const SEED_PATH = '/content/lessons.json';

async function fetchSeedLessons(request) {
  try {
    const url = new URL(SEED_PATH, request.url);
    const res = await fetch(url.toString(), { cf: { cacheTtl: 0 } });
    if (!res.ok) return null;
    const data = await res.json();
    return normalizeList(data && data.lessons);
  } catch (err) {
    console.error('seed lessons fetch failed', err);
    return null;
  }
}

async function currentLessons(env, request) {
  const row = await getSiteContent(env.DB, 'lessons');
  if (row) {
    const lessons = normalizeList(row.value);
    if (lessons) return { lessons, from: 'd1', row };
  }
  const seed = await fetchSeedLessons(request);
  return { lessons: seed || [], from: seed ? 'seed' : 'empty', row: null };
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
  const owner = await requireOwner(env, data, request);
  if (owner.error) return owner.error;
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

export async function onRequestDelete({ request, env, data }) {
  const owner = await requireOwner(env, data, request);
  if (owner.error) return owner.error;
  const url = new URL(request.url);
  const id = String(url.searchParams.get('id') || '').trim();
  if (!id) {
    return json({ error: 'id required' }, 400, request, env);
  }
  try {
    const current = await currentLessons(env, request);
    const next = current.lessons.filter((row) => row.id !== id);
    if (next.length === current.lessons.length) {
      return json({ error: 'Lesson not found' }, 404, request, env);
    }
    const updated_at = await putSiteContent(env.DB, 'lessons', next, data.userId);
    return json({ ok: true, lessons: next, source: 'd1', updated_at }, 200, request, env);
  } catch (err) {
    console.error('DELETE /api/lessons failed', err);
    return json({ error: 'Failed to delete lesson' }, 500, request, env);
  }
}
