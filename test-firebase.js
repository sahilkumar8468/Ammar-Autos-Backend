const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./config/serviceAccountKey.json');

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const admin = require("firebase-admin");

console.log("Admin keys:", Object.keys(admin));
console.log("Credential:", admin.credential);
db.collection('purchases').limit(1).get()
  .then(snap => console.log('✅ Success, docs:', snap.size))
  .catch(err => console.error('❌ Failed:', err));