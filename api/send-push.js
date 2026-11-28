const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const { tokens, title, body } = req.body;
  if (!tokens || tokens.length === 0) {
    return res.status(200).json({ message: '보낼 대상 없음' });
  }

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: {
        notification: {
          icon: '/logo.png',
          badge: '/logo.png',
          requireInteraction: true,
        },
      },
    });
    res.status(200).json({ success: response.successCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
