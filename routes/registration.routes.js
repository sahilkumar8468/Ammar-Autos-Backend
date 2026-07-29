const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase.js");

// Search purchased bikes by chasisNo or registrationNo
router.get("/search-bike", async (req, res) => {
  try {
    const { searchType, searchValue } = req.query;
    if (!searchValue) return res.json({ success: true, found: false });
    
    const field = searchType === "registrationNo" ? "registrationNo" : "chasisNo";
    const snapshot = await db.collection("purchases")
      .where(field, "==", searchValue.trim())
      .limit(1)
      .get();
      
    if (snapshot.empty) return res.json({ success: true, found: false });
    
    const doc = snapshot.docs[0];
    return res.json({ success: true, found: true, data: { id: doc.id, ...doc.data() } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Get all registration records
router.get("/", async (req, res) => {
  try {
    const snapshot = await db.collection("registrations").get();
    const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return res.json({ success: true, data: list });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Create registration record
router.post("/", async (req, res) => {
  try {
    const record = { ...req.body, paperReceived: req.body.paperReceived || false, createdAt: new Date() };
    const docRef = await db.collection("registrations").add(record);
    return res.json({ success: true, data: { id: docRef.id, ...record } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Toggle/Approve registration paper received status
router.patch("/:id/receive-paper", async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("registrations").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Registration record not found" });
    
    const currentStatus = doc.data().paperReceived || false;
    await docRef.update({ paperReceived: !currentStatus, updatedAt: new Date() });
    
    return res.json({ success: true, paperReceived: !currentStatus });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
