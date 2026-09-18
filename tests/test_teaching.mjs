import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LESSONS_PATH = path.join(ROOT, 'site/content/lessons.json');
const TEACHING_JS = fs.readFileSync(path.join(ROOT, 'site/js/teaching.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT, 'site/js/app.js'), 'utf8');
const API_JS = fs.readFileSync(path.join(ROOT, 'site/js/api.js'), 'utf8');
const STYLES = fs.readFileSync(path.join(ROOT, 'site/styles.css'), 'utf8');

function loadTeaching() {
  const context = { window: null, document: { querySelector: () => null }, console, Date, Boolean, String, Array, Number, URL, fetch: async () => ({ ok: false }) };
  context.window = context;
  vm.runInNewContext(TEACHING_JS, context, { filename: 'teaching.js' });
  return context.window.RS_TEACHING;
}

test('seed lessons are Traditional Chinese text posts with optional cover_url, without video', () => {
  const data = JSON.parse(fs.readFileSync(LESSONS_PATH, 'utf8'));
  assert.ok(Array.isArray(data.lessons));
  assert.ok(data.lessons.length >= 2);
  assert.ok(data.lessons.some((lesson) => lesson.cover_url));
  for (const lesson of data.lessons) {
    assert.equal(typeof lesson.id, 'string');
    assert.equal(typeof lesson.title, 'string');
    assert.equal(typeof lesson.body, 'string');
    assert.ok(lesson.title.length > 0);
    assert.ok(lesson.body.length > 40);
    assert.equal(lesson.video, undefined);
    assert.equal(lesson.embed, undefined);
    assert.equal(lesson.url, undefined);
    if (lesson.cover_url) {
      assert.match(lesson.cover_url, /^(https:\/\/|\.\/|\/)/);
    }
    assert.match(lesson.title, /[\u4e00-\u9fff]/);
    assert.match(lesson.body, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(lesson.title, /Course\s*\d|課程\s*\d/);
  }
});

test('teaching helpers excerpt and normalize text-only posts plus cover_url', () => {
  const T = loadTeaching();
  const long = '甲'.repeat(200);
  assert.ok(T.excerpt(long).endsWith('…'));
  assert.ok(T.excerpt(long).length < 160);
  const lesson = T.normalizeLesson({
    id: 'rs-not-a-buy-signal',
    title: 'RS 不是買進訊號',
    passage: '把 RS 當濾網。',
    date: '2026-09-16',
    image: './icons/og-1200x630.png',
  });
  assert.equal(lesson.body, '把 RS 當濾網。');
  assert.equal(lesson.published_at, '2026-09-16');
  assert.equal(lesson.cover_url, './icons/og-1200x630.png');
  assert.equal(T.normalizeLesson({ id: 'x', title: 't' }), null);
});

test('cover_url accepts https, same-origin paths, and /covers keys; rejects javascript', () => {
  const T = loadTeaching();
  assert.equal(T.normalizeCoverUrl('https://tradingvenator.pages.dev/icons/og-1200x630.png'), 'https://tradingvenator.pages.dev/icons/og-1200x630.png');
  assert.equal(T.normalizeCoverUrl('./icons/og-1200x630.png'), './icons/og-1200x630.png');
  assert.equal(T.normalizeCoverUrl('/icons/og-1200x630.png'), '/icons/og-1200x630.png');
  assert.equal(
    T.normalizeCoverUrl('/covers/11111111-1111-1111-1111-111111111111.webp'),
    '/covers/11111111-1111-1111-1111-111111111111.webp'
  );
  assert.equal(T.normalizeCoverUrl('http://evil.example/x.png'), '');
  assert.equal(T.normalizeCoverUrl('javascript:alert(1)'), '');
  assert.equal(T.normalizeCoverUrl('data:image/png;base64,aaaa'), '');
  assert.equal(T.normalizeCoverUrl('../secret.png'), '');
  const dropped = T.normalizeLesson({
    id: 'ok-id',
    title: '標題',
    body: '內文要夠長才算一篇。',
    cover_url: 'javascript:alert(1)',
  });
  assert.equal(dropped.cover_url, '');
});

test('site nav includes 教學, cover upload, delete dialog, not a public composer', () => {
  assert.match(INDEX, /data-view="teaching"/);
  assert.match(INDEX, />教學</);
  assert.match(INDEX, /id="view-teaching"/);
  assert.match(INDEX, /id="teachingList"/);
  assert.match(INDEX, /id="teachingDetailPane"/);
  assert.match(INDEX, /id="addLessonBtn"/);
  assert.match(INDEX, /id="lessonCoverFile"/);
  assert.match(INDEX, /type="file"/);
  assert.match(INDEX, /選擇圖片上傳/);
  assert.match(INDEX, /id="lessonCoverUrl"/);
  assert.match(INDEX, /name="cover_url"/);
  assert.match(INDEX, /id="lessonCoverUrlDetails"/);
  assert.match(INDEX, /id="deleteLessonDialog"/);
  assert.match(INDEX, /id="confirmDeleteLessonBtn"/);
  assert.match(INDEX, /js\/teaching\.js/);
  assert.match(INDEX, /site\/content\/lessons\.json/);
  assert.doesNotMatch(INDEX, /youtube|iframe|video/i);
  assert.match(APP_JS, /showView/);
  assert.match(APP_JS, /RS_TEACHING/);
  assert.match(API_JS, /deleteLesson/);
  assert.match(API_JS, /uploadLessonCover/);
  assert.match(API_JS, /method: 'DELETE'/);
  assert.match(STYLES, /grid-template-columns: repeat\(4, 1fr\)/);
  assert.match(STYLES, /\.post-excerpt/);
  assert.match(STYLES, /\.post-cover/);
  assert.match(STYLES, /\.post-title/);
  assert.match(STYLES, /\.cover-file-btn/);
  assert.match(TEACHING_JS, /uploadLessonCover/);
  assert.match(TEACHING_JS, /尚未設定封面儲存空間/);
});
