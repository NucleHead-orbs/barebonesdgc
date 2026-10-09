/*
 * Bare Bones service worker: phone alerts only (migration 20261118). No fetch handler on purpose:
 * the site never runs from a cache, so a stale deploy can't get stuck on anyone's phone.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Bare Bones', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Bare Bones', {
    body: d.body || '',
    icon: '/assets/app/mytag-192.png',
    badge: '/assets/app/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = wins.find((w) => new URL(w.url).pathname === new URL(url).pathname);
    if (same) { await same.focus(); if ('navigate' in same) await same.navigate(url); return; }
    await self.clients.openWindow(url);
  })());
});
