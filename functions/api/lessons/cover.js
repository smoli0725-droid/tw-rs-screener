import { json } from '../../_lib/cors.js';
import { requireOwner } from '../../_lib/require_owner.js';
import {
  MAX_COVER_BYTES,
  MAX_COVER_REQUEST_BYTES,
  MISSING_R2_ERROR,
  R2_BINDING,
  fileFromFormData,
  hasR2Binding,
  newCoverKey,
  publicCoverUrl,
  sniffImageType,
} from '../../_lib/covers.js';

export async function onRequestPost({ request, env, data }) {
  const owner = await requireOwner(env, data, request);
  if (owner.error) return owner.error;

  const length = Number(request.headers.get('content-length') || '0');
  if (length > MAX_COVER_REQUEST_BYTES) {
    return json({ error: '圖片請小於 5MB' }, 413, request, env);
  }

  if (!hasR2Binding(env)) {
    return json({ error: MISSING_R2_ERROR, binding: R2_BINDING }, 503, request, env);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: '請用 multipart 上傳圖片' }, 400, request, env);
  }

  const file = fileFromFormData(form);
  if (!file || typeof file.arrayBuffer !== 'function') {
    return json({ error: '請選擇一張圖片' }, 400, request, env);
  }
  if (typeof file.size === 'number' && file.size > MAX_COVER_BYTES) {
    return json({ error: '圖片請小於 5MB' }, 413, request, env);
  }

  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (err) {
    console.error('cover read failed', err);
    return json({ error: '無法讀取圖片' }, 400, request, env);
  }
  if (buf.byteLength > MAX_COVER_BYTES) {
    return json({ error: '圖片請小於 5MB' }, 413, request, env);
  }

  const kind = sniffImageType(buf);
  if (!kind) {
    return json({ error: '請選 jpeg、png 或 webp' }, 415, request, env);
  }

  const key = newCoverKey(kind.ext);
  try {
    await env[R2_BINDING].put(key, buf, {
      httpMetadata: { contentType: kind.contentType },
      customMetadata: { uploadedBy: String(data.userId || '') },
    });
  } catch (err) {
    console.error('R2 put cover failed', err);
    return json({ error: '封面上傳失敗' }, 500, request, env);
  }

  const url = publicCoverUrl(env, key);
  return json({ ok: true, url, key, cover_url: url }, 200, request, env);
}
