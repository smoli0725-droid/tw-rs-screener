import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateRequestDetails, generateVAPIDKeys } from 'web-push-neo';
import {
  collectUserIds,
  deliverAlerts,
  listSubscriptionsQuery,
  normalizeAlert,
  parseSubscription,
  secretsMatch,
} from '../_lib/alerts.js';

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

test('secretsMatch compares equal secrets and rejects mismatches', async () => {
  assert.equal(await secretsMatch('alpha', 'alpha'), true);
  assert.equal(await secretsMatch('alpha', 'beta'), false);
  assert.equal(await secretsMatch('', 'alpha'), false);
});

test('normalizeAlert fan-out by default and accepts a same-site url', () => {
  const parsed = normalizeAlert(
    {
      symbol: '2330',
      title: '2330 到價',
      body: '現價已觸及目標',
      url: 'https://tradingvenator.pages.dev/#portfolio',
    },
    {}
  );
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.alert.userIds, null);
  assert.equal(parsed.alert.url, '/#portfolio');
  assert.equal(listSubscriptionsQuery(null).fanout, true);
  assert.match(listSubscriptionsQuery(['user_abc']).sql, /user_id IN/);
});

test('normalizeAlert rejects off-site urls and bad user ids', () => {
  assert.equal(
    normalizeAlert({ symbol: '2330', title: 't', body: 'b', url: 'https://evil.example/phish' }, {}).error,
    'url must point at this site'
  );
  assert.equal(collectUserIds({ user_ids: ['not valid'] }).error, 'Invalid user id');
  assert.equal(collectUserIds({ clerk_user_id: 'user_abc' }).ids[0], 'user_abc');
});

test('parseSubscription accepts browser key fields', () => {
  const ok = parseSubscription({
    endpoint: 'https://fcm.googleapis.com/fcm/send/example',
    keys: { p256dh: 'A'.repeat(80), auth: 'B'.repeat(22) },
  });
  assert.equal(ok.subscription.endpoint.startsWith('https://'), true);
  assert.equal(parseSubscription({ endpoint: 'http://insecure.example', keys: {} }).error, 'Invalid subscription');
});

test('deliverAlerts deletes subscriptions on 404 and 410 only', async () => {
  const deleted = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              deleted.push({ sql, args });
            },
          };
        },
      };
    },
  };
  const rows = [
    { endpoint: 'https://push.example/gone', p256dh: 'a', auth: 'b' },
    { endpoint: 'https://push.example/missing', p256dh: 'a', auth: 'b' },
    { endpoint: 'https://push.example/boom', p256dh: 'a', auth: 'b' },
    { endpoint: 'https://push.example/ok', p256dh: 'a', auth: 'b' },
  ];
  const result = await deliverAlerts(db, rows, { title: 't' }, async (row) => {
    if (row.endpoint.endsWith('/gone')) {
      const err = new Error('gone');
      err.statusCode = 410;
      throw err;
    }
    if (row.endpoint.endsWith('/missing')) {
      const err = new Error('missing');
      err.statusCode = 404;
      throw err;
    }
    if (row.endpoint.endsWith('/boom')) {
      const err = new Error('boom');
      err.statusCode = 500;
      throw err;
    }
  });
  assert.deepEqual(result, { sent: 1, removed: 2, failed: 1 });
  assert.equal(deleted.length, 2);
  assert.deepEqual(
    deleted.map((row) => row.args[0]),
    ['https://push.example/gone', 'https://push.example/missing']
  );
});

test('web-push-neo builds an aes128gcm VAPID request from url-safe keys', async () => {
  const vapid = await generateVAPIDKeys();
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const point = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  assert.equal(point.length, 65);
  assert.equal(point[0], 0x04);
  const details = await generateRequestDetails(
    {
      endpoint: 'https://fcm.googleapis.com/fcm/send/example',
      keys: {
        p256dh: b64url(point),
        auth: b64url(Buffer.from('0123456789abcdef')),
      },
    },
    JSON.stringify({ title: '測試', body: '到價', url: '/' }),
    {
      vapidDetails: {
        subject: 'mailto:alerts@tradingvenator.pages.dev',
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    }
  );
  assert.equal(details.method, 'POST');
  assert.match(details.headers.Authorization, /^vapid t=/);
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
});
