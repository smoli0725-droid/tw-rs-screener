import assert from 'node:assert/strict';
import test from 'node:test';

import { isAllowedOrigin } from '../functions/_lib/cors.js';

test('allows production Pages origin', () => {
  assert.equal(isAllowedOrigin('https://tradingvenator.pages.dev'), true);
});

test('allows localhost preview origins', () => {
  assert.equal(isAllowedOrigin('http://localhost:8080'), true);
  assert.equal(isAllowedOrigin('http://localhost:8788'), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:4173'), true);
});

test('rejects other origins', () => {
  assert.equal(isAllowedOrigin('https://evil.example'), false);
  assert.equal(isAllowedOrigin('https://pages.dev'), false);
  assert.equal(isAllowedOrigin(''), false);
});

test('allows extra origins from env', () => {
  assert.equal(
    isAllowedOrigin('https://tv.example.com', { ALLOWED_ORIGINS: 'https://tv.example.com' }),
    true
  );
});
