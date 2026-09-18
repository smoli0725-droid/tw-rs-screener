import {
  contentTypeForKey,
  hasR2Binding,
  isCoverKey,
  R2_BINDING,
} from '../_lib/covers.js';

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
  });
}

export async function onRequestGet({ params, env }) {
  const key = decodeURIComponent(String(params?.key || ''));
  if (!isCoverKey(key)) return notFound();
  if (!hasR2Binding(env)) {
    return new Response('R2 not bound', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  let object;
  try {
    object = await env[R2_BINDING].get(key);
  } catch (err) {
    console.error('R2 get cover failed', err);
    return new Response('Failed to load cover', { status: 500 });
  }
  if (!object) return notFound();
  const storedType = object.httpMetadata && object.httpMetadata.contentType;
  const contentType =
    storedType && String(storedType).startsWith('image/') ? storedType : contentTypeForKey(key);
  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
