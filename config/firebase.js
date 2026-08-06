const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
require("dotenv").config();

const cleanPrivateKey = (key) => {
  if (!key) return "";
  let cleaned = key.trim();
  // Remove surrounding single/double quotes
  cleaned = cleaned.replace(/^["']+|["']+$/g, "");
  // Unescape double-escaped newlines (\\\\n) first, then single-escaped (\\n)
  cleaned = cleaned.replace(/\\\\n/g, "\n");
  cleaned = cleaned.replace(/\\n/g, "\n");
  return cleaned;
};

const validatePrivateKey = (key) => {
  if (!key.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY is invalid: it does not contain a valid PEM header. " +
      "Fix it by setting FIREBASE_SERVICE_ACCOUNT_BASE64 (recommended) — see README, " +
      "or re-paste the key ensuring it starts with -----BEGIN PRIVATE KEY-----."
    );
  }
  return key;
};

let credential;

if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  // Strategy 1 (recommended for Vercel): base64-encoded full service account JSON.
  // Immune to newline / escaping issues — set it with:
  //   base64 -w 0 serviceAccountKey.json   (Linux/macOS/Git Bash)
  // or PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccountKey.json"))
  try {
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")
    );
    credential = cert(serviceAccount);
  } catch (error) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_BASE64:", error.message);
    process.exit(1);
  }
} else if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_PRIVATE_KEY &&
  process.env.FIREBASE_CLIENT_EMAIL
) {
  // Strategy 2: individual environment variables (fallback)
  try {
    const privateKey = validatePrivateKey(cleanPrivateKey(process.env.FIREBASE_PRIVATE_KEY));
    credential = cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    });
  } catch (error) {
    console.error("Invalid Firebase env credentials:", error.message);
    process.exit(1);
  }
} else {
  // Fallback to local file for development
  const fs = require("fs");
  const path = require("path");
  const path1 = path.join(__dirname, "serviceAccountKey.json");
  const path2 = path.join(__dirname, "..", "serviceAccountKey.json");

  if (fs.existsSync(path1)) {
    credential = cert(require(path1));
  } else if (fs.existsSync(path2)) {
    credential = cert(require(path2));
  } else {
    console.error(
      "❌ Firebase credentials not found.\n" +
      "Please place your Firebase 'serviceAccountKey.json' file inside 'Backend/config/serviceAccountKey.json' (or 'Backend/serviceAccountKey.json'),\n" +
      "or set FIREBASE_SERVICE_ACCOUNT_BASE64 in your Backend/.env file."
    );
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