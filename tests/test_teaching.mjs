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
const STYLES = fs.readFileSync(path.join(ROOT, 'site/styles.css'), 'utf8');

function loadTeaching() {
  const context = { window: null, document: { querySelector: () => null }, console, Date, Boolean, String, Array, Number, fetch: async () => ({ ok: false }) };
  context.window = context;
  vm.runInNewContext(TEACHING_JS, context, { filename: 'teaching.js' });
  return context.window.RS_TEACHING;
}

test('seed lessons are Traditional Chinese text posts without video', () => {
  const data = JSON.parse(fs.readFileSync(LESSONS_PATH, 'utf8'));
  assert.ok(Array.isArray(data.lessons));
  assert.ok(data.lessons.length >= 2);
  for (const lesson of data.lessons) {
    assert.equal(typeof lesson.id, 'string');
    assert.equal(typeof lesson.title, 'string');
    assert.equal(typeof lesson.body, 'string');
    assert.ok(lesson.title.length > 0);
    assert.ok(lesson.body.length > 40);
    assert.equal(lesson.video, undefined);
    assert.equal(lesson.embed, undefined);
    assert.equal(lesson.url, undefined);
    assert.match(lesson.title, /[\u4e00-\u9fff]/);
    assert.match(lesson.body, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(lesson.title, /Course\s*\d|課程\s*\d/);
  }
});

test('teaching helpers excerpt and normalize text-only posts', () => {
  const T = loadTeaching();
  const long = '甲'.repeat(200);
  assert.ok(T.excerpt(long).endsWith('…'));
  assert.ok(T.excerpt(long).length < 160);
  const lesson = T.normalizeLesson({
    id: 'rs-not-a-buy-signal',
    title: 'RS 不是買進訊號',
    passage: '把 RS 當濾網。',
    date: '2026-09-16',
  });
  assert.equal(lesson.body, '把 RS 當濾網。');
  assert.equal(lesson.published_at, '2026-09-16');
  assert.equal(T.normalizeLesson({ id: 'x', title: 't' }), null);
});

test('site nav includes 教學 and teaching view, not a public composer', () => {
  assert.match(INDEX, /data-view="teaching"/);
  assert.match(INDEX, />教學</);
  assert.match(INDEX, /id="view-teaching"/);
  assert.match(INDEX, /id="teachingList"/);
  assert.match(INDEX, /id="teachingDetailPane"/);
  assert.match(INDEX, /id="addLessonBtn"/);
  assert.match(INDEX, /js\/teaching\.js/);
  assert.match(INDEX, /site\/content\/lessons\.json/);
  assert.doesNotMatch(INDEX, /youtube|iframe|video/i);
  assert.match(APP_JS, /showView/);
  assert.match(APP_JS, /RS_TEACHING/);
  assert.match(STYLES, /grid-template-columns: repeat\(4, 1fr\)/);
  assert.match(STYLES, /\.post-excerpt/);
});
