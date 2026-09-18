import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_COVER_BYTES,
  MISSING_R2_ERROR,
  R2_BINDING,
  R2_BUCKET_NAME,
  contentTypeForKey,
  hasR2Binding,
  isCoverKey,
  newCoverKey,
  publicCoverUrl,
  sniffImageType,
} from '../functions/_lib/covers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jpegBytes() {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

function webpBytes() {
  const b = new Uint8Array(12);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
}

test('sniffImageType accepts jpeg png webp and rejects gif/html', () => {
  assert.equal(sniffImageType(jpegBytes()).ext, 'jpg');
  assert.equal(sniffImageType(pngBytes()).contentType, 'image/png');
  assert.equal(sniffImageType(webpBytes()).ext, 'webp');
  assert.equal(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(sniffImageType(new TextEncoder().encode('<!doctype html>....')), null);
  assert.equal(sniffImageType(new Uint8Array(4)), null);
});

test('cover keys are uuid image names and public URL is same-origin path', () => {
  const key = newCoverKey('png');
  assert.ok(isCoverKey(key));
  assert.match(key, /\.png$/);
  assert.equal(isCoverKey('../secret.png'), false);
  assert.equal(isCoverKey('x.jpg'), false);
  assert.equal(isCoverKey(''), false);
  assert.equal(publicCoverUrl({}, key), `/covers/${key}`);
  assert.equal(
    publicCoverUrl({ COVER_PUBLIC_BASE: 'https://pub-abc.r2.dev' }, key),
    `https://pub-abc.r2.dev/${key}`
  );
  assert.equal(publicCoverUrl({ COVER_PUBLIC_BASE: 'http://insecure.example' }, key), `/covers/${key}`);
  assert.equal(contentTypeForKey('a.png'), 'image/png');
  assert.equal(MAX_COVER_BYTES, 5 * 1024 * 1024);
  assert.equal(R2_BINDING, 'TEACHING_COVERS');
  assert.equal(R2_BUCKET_NAME, 'flashpick-teaching');
});

test('hasR2Binding is false without put/get and missing error names the bucket', () => {
  assert.equal(hasR2Binding({}), false);
  assert.equal(hasR2Binding({ TEACHING_COVERS: {} }), false);
  assert.equal(
    hasR2Binding({ TEACHING_COVERS: { put: async () => {}, get: async () => null } }),
    true
  );
  assert.match(MISSING_R2_ERROR, /flashpick-teaching/);
  assert.match(MISSING_R2_ERROR, /TEACHING_COVERS/);
});

test('cover upload endpoint is owner-only POST and routes expose /covers', () => {
  const coverJs = fs.readFileSync(path.join(ROOT, 'functions/api/lessons/cover.js'), 'utf8');
  const getJs = fs.readFileSync(path.join(ROOT, 'functions/covers/[key].js'), 'utf8');
  const routes = fs.readFileSync(path.join(ROOT, 'site/_routes.json'), 'utf8');
  const wrangler = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const apiJs = fs.readFileSync(path.join(ROOT, 'site/js/api.js'), 'utf8');
  assert.match(coverJs, /requireOwner/);
  assert.match(coverJs, /onRequestPost/);
  assert.doesNotMatch(coverJs, /onRequestGet/);
  assert.match(coverJs, /MISSING_R2_ERROR/);
  assert.match(getJs, /isCoverKey/);
  assert.match(getJs, /TEACHING_COVERS|R2_BINDING/);
  assert.match(routes, /\/covers\/\*/);
  assert.match(wrangler, /binding = "TEACHING_COVERS"/);
  assert.match(wrangler, /bucket_name = "flashpick-teaching"/);
  assert.match(apiJs, /uploadLessonCover/);
  assert.match(apiJs, /\/api\/lessons\/cover/);
  assert.match(apiJs, /FormData/);
});
