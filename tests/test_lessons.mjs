import assert from 'node:assert/strict';
import test from 'node:test';

import { corsHeaders } from '../functions/_lib/cors.js';
import { normalizeCoverUrl, normalizeLesson, normalizeList } from '../functions/_lib/lessons.js';

test('CORS allows GET POST PUT DELETE for lessons writes', () => {
  const req = new Request('https://tradingvenator.pages.dev/api/lessons', {
    headers: { Origin: 'https://tradingvenator.pages.dev' },
    method: 'OPTIONS',
  });
  const headers = corsHeaders(req, {});
  assert.match(headers['Access-Control-Allow-Methods'], /DELETE/);
  assert.match(headers['Access-Control-Allow-Methods'], /PUT/);
  assert.match(headers['Access-Control-Allow-Methods'], /POST/);
});

test('API normalizeLesson round-trips cover_url and aliases image', () => {
  const lesson = normalizeLesson({
    id: 'pivot-then-breakout',
    title: '先有確認的樞紐，才叫突破',
    body: '突破不是今天創新高。',
    published_at: '2026-09-18',
    image: 'https://tradingvenator.pages.dev/icons/og-1200x630.png',
  });
  assert.equal(lesson.cover_url, 'https://tradingvenator.pages.dev/icons/og-1200x630.png');
  assert.equal(normalizeCoverUrl('javascript:alert(1)'), '');
  assert.equal(
    normalizeCoverUrl('/covers/11111111-1111-1111-1111-111111111111.webp'),
    '/covers/11111111-1111-1111-1111-111111111111.webp'
  );
  assert.equal(normalizeLesson({ id: 'bad id', title: 't', body: 'b' }), null);
});

test('API normalizeList drop-in delete is remaining array', () => {
  const current = normalizeList([
    { id: 'keep', title: '留下', body: '這篇要留著當種子。', published_at: '2026-09-18' },
    { id: 'drop', title: '刪掉', body: '這篇會被刪除測試。', published_at: '2026-09-16', cover_url: './icons/og-1200x630.png' },
  ]);
  const next = current.filter((row) => row.id !== 'drop');
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'keep');
  assert.equal(next[0].cover_url, '');
  assert.ok(normalizeList(next));
});
