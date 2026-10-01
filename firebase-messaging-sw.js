// Service Worker für Firebase Cloud Messaging (Push-Benachrichtigungen),
// wenn die App im Hintergrund ist oder geschlossen wurde - ohne diese Datei
// bleibt die Token-Registrierung in mitarbeiter.html (maPushRegister) im
// Fehler stecken, egal ob FB_VAPID_KEY korrekt gesetzt ist.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBzuk8yEBbBf6Thp0Lu76pXarw2IkHJXNw",
  authDomain: "glsc-eabb6.firebaseapp.com",
  projectId: "glsc-eabb6",
  storageBucket: "glsc-eabb6.firebasestorage.app",
  messagingSenderId: "565990660261",
  appId: "1:565990660261:web:5607161b999f1c88a9954c",
});

const messaging = firebase.messaging();

// Hintergrund-Nachrichten: Browser zeigt die System-Benachrichtigung selbst,
// hier nur Titel/Text aus dem Payload übernehmen.
messaging.onBackgroundMessage(function(payload) {
  const title = (payload.notification && payload.notification.title) || 'GLSC';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: 'icons/icon-192.png',
  };
  self.registration.showNotification(title, options);
});
