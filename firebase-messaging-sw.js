importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDw1ovHdCcr3ttVwZdljoZXOpDglovF7M4",
  authDomain: "minsok-d0af1.firebaseapp.com",
  databaseURL: "https://minsok-d0af1-default-rtdb.firebaseio.com",
  projectId: "minsok-d0af1",
  storageBucket: "minsok-d0af1.firebasestorage.app",
  messagingSenderId: "55087479382",
  appId: "1:55087479382:web:ef402a104ca7b6c9f1a137",
  measurementId: "G-XE0KHJRQSN"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '민속 알림';
  const options = {
    body: payload.notification?.body || '새로운 현장 전파가 도착했습니다.',
    icon: '/logo.png',
    badge: '/logo.png',
    requireInteraction: true
  };
  self.registration.showNotification(title, options);
});
