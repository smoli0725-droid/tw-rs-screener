/* TradingVenator price-alert service worker. Shows a notification and
   tells an open tab so the page can toast the same event. */

const ICON = '/icons/icon-192.png';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  const fallback = { title: '到價通知', body: '', url: '/', symbol: '' };
  if (!event.data) return fallback;
  try {
    const data = event.data.json();
    return {
      title: String(data.title || fallback.title).slice(0, 80),
      body: String(data.body || '').slice(0, 240),
      url: typeof data.url === 'string' && data.url ? data.url : '/',
      symbol: String(data.symbol || '').slice(0, 12),
    };
  } catch {
    return { ...fallback, body: String(event.data.text() || '').slice(0, 240) };
  }
}

function sameOriginUrl(url) {
  try {
    const resolved = new URL(url || '/', self.location.origin);
    if (resolved.origin !== self.location.origin) return `${self.location.origin}/`;
    return resolved.href;
  } catch {
    return `${self.location.origin}/`;
  }
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({ type: 'tv-alert', ...payload });
      }
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: ICON,
        badge: ICON,
        data: { url: payload.url },
        tag: payload.symbol ? `alert-${payload.symbol}` : 'alert',
        renotify: true,
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if ('navigate' in client) {
          try {
            await client.navigate(target);
          } catch {
            /* focus still lands on the open tab */
          }
        }
        await client.focus();
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});
