const admin = require('firebase-admin');
const serviceAccount = require('./config/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // Optionally specify storage bucket if needed
  // storageBucket: 'your-storage-bucket.appspot.com'
});

const db = admin.firestore();
const storage = admin.storage();

module.exports = { admin, db, storage };