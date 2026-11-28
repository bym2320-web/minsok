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

// 중복 알림 방지: Firebase가 자동 표시하는 notification 메시지는 다시 띄우지 않음
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;
  const title = payload.data?.title || '민속 알림';
  const options = {
    body: payload.data?.body || '새로운 알림이 도착했습니다.',
    icon: '/logo.png',
    badge: '/logo.png'
  };
  self.registration.showNotification(title, options);
});

// 휴대폰에서 푸시 알림을 누르면 민속 알림 앱으로 바로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('minsok.vercel.app') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
