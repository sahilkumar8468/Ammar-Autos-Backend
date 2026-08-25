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

// Helper to sync registration changes to linked purchase record
async function syncPurchaseFromRegistration(regRecord) {
  try {
    let purchaseRef = null;
    if (regRecord.bikeId) {
      purchaseRef = db.collection("purchases").doc(regRecord.bikeId);
    } else if (regRecord.chasisNo) {
      const snap = await db.collection("purchases").where("chasisNo", "==", regRecord.chasisNo.trim()).limit(1).get();
      if (!snap.empty) purchaseRef = snap.docs[0].ref;
    }

    if (purchaseRef) {
      const pDoc = await purchaseRef.get();
      if (pDoc.exists) {
        const updateData = { updatedAt: new Date() };
        if (regRecord.paperReceived) {
          updateData.approved = true;
          updateData.approvedAt = new Date();
        }
        if (regRecord.registrationNo && regRecord.registrationNo.trim().toUpperCase() !== "AFR") {
          updateData.registrationNo = regRecord.registrationNo.trim();
          updateData.registrationStatus = "registered";
        }
        await purchaseRef.update(updateData);
      }
    }
  } catch (err) {
    console.error("Error syncing purchase from registration:", err);
  }
}

// Create registration record
router.post("/", async (req, res) => {
  try {
    const record = {
      ...req.body,
      paperReceived: req.body.paperReceived || false,
      agentTotalMoney: parseFloat(req.body.agentTotalMoney || 0),
      customerTotalMoney: parseFloat(req.body.customerTotalMoney || 0),
      agentAdvance: parseFloat(req.body.agentAdvance || 0),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const docRef = await db.collection("registrations").add(record);
    const savedRecord = { id: docRef.id, ...record };
    
    if (savedRecord.paperReceived || (savedRecord.registrationNo && savedRecord.registrationNo.trim().toUpperCase() !== "AFR")) {
      await syncPurchaseFromRegistration(savedRecord);
    }
    
    return res.json({ success: true, data: savedRecord });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Update registration record
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("registrations").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Registration record not found" });

    const updateData = {
      ...req.body,
      agentTotalMoney: parseFloat(req.body.agentTotalMoney ?? doc.data().agentTotalMoney ?? 0),
      customerTotalMoney: parseFloat(req.body.customerTotalMoney ?? doc.data().customerTotalMoney ?? 0),
      agentAdvance: parseFloat(req.body.agentAdvance ?? doc.data().agentAdvance ?? 0),
      updatedAt: new Date()
    };

    await docRef.update(updateData);
    const updatedDoc = (await docRef.get()).data();
    const updatedRecord = { id, ...updatedDoc };

    if (updatedRecord.paperReceived || (updatedRecord.registrationNo && updatedRecord.registrationNo.trim().toUpperCase() !== "AFR")) {
      await syncPurchaseFromRegistration(updatedRecord);
    }

    return res.json({ success: true, data: updatedRecord });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Delete registration record
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("registrations").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ success: false, message: "Registration record not found" });

    await docRef.delete();
    return res.json({ success: true, message: "Registration deleted successfully" });
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
    const newStatus = !currentStatus;
    await docRef.update({ paperReceived: newStatus, updatedAt: new Date() });
    
    const updatedRecord = { id, ...doc.data(), paperReceived: newStatus };
    if (newStatus) {
      await syncPurchaseFromRegistration(updatedRecord);
    }
    
    return res.json({ success: true, paperReceived: newStatus });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
