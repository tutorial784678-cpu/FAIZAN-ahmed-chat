const CACHE_NAME = 'faizan-chats-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try { await cache.addAll(APP_SHELL); } catch (error) { console.warn('Some app shell files were not cached:', error); }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('faizan-chats-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/index.html')) || Response.error()));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { title: 'Faizan Ahmed Chats', body: event.data ? event.data.text() : 'You have a new notification.' }; }

  const isCall = data.kind === 'call';
  const options = {
    body: data.body || (isCall ? 'Incoming call' : 'You have a new message.'),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: isCall ? `fa-call-${data.eventId || Date.now()}` : `fa-message-${data.conversationId || Date.now()}`,
    renotify: true,
    requireInteraction: isCall,
    timestamp: Date.now(),
    data: {
      url: data.url || '/',
      kind: data.kind || 'message',
      eventId: data.eventId || null,
      conversationId: data.conversationId || null
    }
  };
  if (data.sound === false) {
    options.silent = true;
  } else {
    options.vibrate = isCall ? [500, 250, 500, 250, 800] : [180, 100, 180];
  }
  if (isCall) {
    options.actions = [
      { action: 'answer', title: 'Open call' },
      { action: 'decline', title: 'Decline' }
    ];
  } else {
    options.actions = [{ action: 'open', title: 'Open chat' }];
  }
  event.waitUntil(self.registration.showNotification(data.title || (isCall ? 'Incoming call' : 'New message'), options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let target = data.url || '/';
  if (data.kind === 'call' && data.eventId) {
    const url = new URL('/', self.location.origin);
    url.searchParams.set('incomingCallSignal', String(data.eventId));
    if (event.action === 'decline') url.searchParams.set('callAction', 'decline');
    else url.searchParams.set('callAction', 'answer');
    target = url.href;
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const targetUrl = new URL(target, self.location.origin);
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.navigate(targetUrl.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl.href);
  })());
});

self.addEventListener('notificationclose', () => {});
