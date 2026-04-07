importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyBfxSMeAWZaLcrbiGqG9uv8wYyW_H9-sQ8",
  authDomain: "colorplastic-87a1c.firebaseapp.com",
  databaseURL: "https://colorplastic-87a1c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "colorplastic-87a1c",
  storageBucket: "colorplastic-87a1c.firebasestorage.app",
  messagingSenderId: "283651673468",
  appId: "1:283651673468:web:07da20b37db6bd3857a8f9"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  console.log('Background message:', payload);
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body: body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data
  });
});
