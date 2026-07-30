const multer = require("multer");
const sharp = require("sharp");
const crypto = require("crypto");
const { storage } = require("../config/firebase");

// In-memory storage for multer
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 8 * 1024 * 1024 } 
});

/**
 * POST /api/upload
 * Compresses the image and uploads to Firebase Storage with a long-lived download token.
 */
const uploadPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: "No file uploaded (field name must be 'photo')." 
      });
    }

    let imageBuffer = req.file.buffer;

    // Try to compress with sharp if available
    try {
      imageBuffer = await sharp(req.file.buffer)
        .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
    } catch (sharpErr) {
      console.warn("sharp not available, using original buffer:", sharpErr.message);
    }

    const bucket = storage.bucket(); // Uses bucket name from config
    const fileName = `uploads/${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, "_")}`;
    const file = bucket.file(fileName);
    
    // Generate a UUID to serve as the long-lived token
    const token = crypto.randomUUID();

    await file.save(imageBuffer, {
      metadata: {
        contentType: req.file.mimetype.startsWith("image/") ? "image/jpeg" : req.file.mimetype,
        metadata: {
          firebaseStorageDownloadTokens: token
        }
      }
    });

    // Construct the long-lived public URL that uses the token
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media&token=${token}`;

    return res.status(201).json({ success: true, url });
  } catch (error) {
    console.error("Upload error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { upload, uploadPhoto };