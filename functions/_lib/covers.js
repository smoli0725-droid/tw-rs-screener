export const R2_BINDING = 'TEACHING_COVERS';
export const R2_BUCKET_NAME = 'flashpick-teaching';
export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const MAX_COVER_REQUEST_BYTES = MAX_COVER_BYTES + 256 * 1024;

export const MISSING_R2_ERROR =
  '尚未設定封面儲存空間。請在 Cloudflare 建立 R2 bucket「flashpick-teaching」，並綁定變數 TEACHING_COVERS（步驟見 README）。';

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png' };
  }
  const riff = String.fromCharCode(b[0], b[1], b[2], b[3]);
  const webp = String.fromCharCode(b[8], b[9], b[10], b[11]);
  if (riff === 'RIFF' && webp === 'WEBP') {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

export function newCoverKey(ext) {
  const safe = ext === 'png' || ext === 'webp' ? ext : 'jpg';
  return `${crypto.randomUUID()}.${safe}`;
}

export function isCoverKey(key) {
  return KEY_RE.test(String(key || ''));
}

export function contentTypeForKey(key) {
  const lower = String(key || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export function hasR2Binding(env) {
  const bucket = env && env[R2_BINDING];
  return Boolean(bucket && typeof bucket.put === 'function' && typeof bucket.get === 'function');
}

export function publicCoverUrl(env, key) {
  const base = String(env?.COVER_PUBLIC_BASE || '')
    .trim()
    .replace(/\/$/, '');
  if (base) {
    try {
      const u = new URL(`${base}/${key}`);
      if (u.protocol === 'https:') return u.href;
    } catch {
      // fall through to same-origin path
    }
  }
  return `/covers/${key}`;
}

export function fileFromFormData(form) {
  if (!form || typeof form.get !== 'function') return null;
  const raw = form.get('file') || form.get('cover');
  if (!raw) return null;
  return raw;
}
