const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
require("dotenv").config();

const cleanPrivateKey = (key) => {
  if (!key) return "";
  let cleaned = key.trim();
  cleaned = cleaned.replace(/^["']+|["']+$/g, "");
  cleaned = cleaned.replace(/\\\\n/g, "\n");
  cleaned = cleaned.replace(/\\n/g, "\n");
  return cleaned;
};

const getCredentials = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
      const serviceAccount = JSON.parse(decoded);
      return cert(serviceAccount);
    } catch (error) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:", error.message);
    }
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_PRIVATE_KEY &&
    process.env.FIREBASE_CLIENT_EMAIL
  ) {
    try {
      const privateKey = cleanPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
      return cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      });
    } catch (error) {
      console.error("Invalid Firebase env credentials:", error.message);
    }
  }

  const fs = require("fs");
  const path = require("path");
  const path1 = path.join(__dirname, "serviceAccountKey.json");
  const path2 = path.join(__dirname, "..", "serviceAccountKey.json");

  if (fs.existsSync(path1)) {
    return cert(require(path1));
  }
  if (fs.existsSync(path2)) {
    return cert(require(path2));
  }

  console.error(
    "❌ Firebase credentials not found in env or local files."
  );
  return null;
};

if (!getApps().length) {
  const credential = getCredentials();
  if (credential) {
    initializeApp({
      credential,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "bikepos-edf38.appspot.com"
    });
  } else {
    initializeApp({
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "bikepos-edf38.appspot.com"
    });
  }
}

const db = getFirestore();
const storage = getStorage();

module.exports = { db, storage };