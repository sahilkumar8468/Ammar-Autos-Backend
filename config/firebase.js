const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
require("dotenv").config();

let credential;

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  // Use environment variables in production (Vercel)
  credential = cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  });
} else {
  // Fallback to local file for development
  try {
    const serviceAccount = require("./serviceAccountKey.json");
    credential = cert(serviceAccount);
  } catch (error) {
    console.error("Firebase credentials not found. Please set environment variables or provide serviceAccountKey.json");
    process.exit(1);
  }
}

initializeApp({
  credential,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "bikepos-edf38.appspot.com"
});

const db = getFirestore();
const storage = getStorage();

module.exports = { db, storage };