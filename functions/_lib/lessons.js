export const MAX_LESSONS = 50;
export const MAX_TITLE = 80;
export const MAX_BODY = 8000;
export const MAX_COVER_URL = 500;

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

export function normalizeCoverUrl(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.length > MAX_COVER_URL) return '';
  if (/[\s<>"'`\\]/.test(s)) return '';
  if (s.startsWith('./') || (s.startsWith('/') && !s.startsWith('//'))) {
    if (s.includes('..') || s.includes('//')) return '';
    if (!/^(\.\/|\/)[A-Za-z0-9._~/-]+$/.test(s)) return '';
    return s;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    if (u.username || u.password) return '';
    return u.href;
  } catch {
    return '';
  }
}

export function normalizeLesson(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  const title = String(raw.title || '').trim();
  const body = String(raw.body || raw.passage || '').trim();
  if (!id || !title || !body) return null;
  if (id.length > 80 || title.length > MAX_TITLE || body.length > MAX_BODY) return null;
  if (!ID_RE.test(id)) return null;
  const cover_url = normalizeCoverUrl(raw.cover_url || raw.image);
  return {
    id,
    title,
    body,
    published_at: String(raw.published_at || raw.date || '').slice(0, 10),
    cover_url,
  };
}

export function normalizeList(raw) {
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
