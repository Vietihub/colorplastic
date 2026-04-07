// firebase-messaging-sw.js
// Service Worker pro Firebase Cloud Messaging (background push notifikace)
// Musí být ve stejném adresáři jako index.html (kořen domény)

importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBfxSMeAWZaLcrbiGqG9uv8wYyW_H9-sQ8",
  authDomain:        "colorplastic-87a1c.firebaseapp.com",
  databaseURL:       "https://colorplastic-87a1c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "colorplastic-87a1c",
  storageBucket:     "colorplastic-87a1c.firebasestorage.app",
  messagingSenderId: "283651673468",
  appId:             "1:283651673468:web:07da20b37db6bd3857a8f9"
});

const messaging = firebase.messaging();

// ── Zpracování notifikací na pozadí (app zavřená nebo minimalizovaná) ─────────
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] Background message:', payload);

  const title   = (payload.notification && payload.notification.title) || 'ColorPlastic';
  const options = {
    body:    (payload.notification && payload.notification.body) || '',
    icon:    '/icon-192.png',   // volitelné – přidej ikonu do složky
    badge:   '/badge-72.png',   // volitelné – malá ikonka v status baru
    tag:     payload.data && payload.data.type ? payload.data.type : 'colorplastic',
    renotify: true,
    vibrate: [200, 100, 200],
    data:    payload.data || {}
  };

  return self.registration.showNotification(title, options);
});

// ── Klik na notifikaci → otevře/zaměří aplikaci ───────────────────────────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});
