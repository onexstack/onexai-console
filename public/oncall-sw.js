/* oai-incident-apiserver Web Push service worker. */
self.addEventListener('push', event => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: '值班通知', body: event.data.text() };
    }
  }
  const title = payload.title || '值班通知';
  const options = {
    body: payload.body || '',
    data: { url: (payload.data && payload.data.url) || '/oncall/incidents' },
    tag: payload.data && payload.data.tag,
    requireInteraction: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/oncall/incidents';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) {
          if ('navigate' in client) {
            client.navigate(url);
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
