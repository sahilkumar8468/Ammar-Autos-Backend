const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

// GET /api/inventory - returns purchased bikes inventory and summary stats
router.get("/", async (req, res) => {
  try {
    const snapshot = await db.collection("purchases").where("sold", "==", false).get();
    const purchases = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const totalPurchased = purchases.length;
    const totalPurchaseValue = purchases.reduce((sum, p) => sum + (Number(p.actualAmount) || 0), 0);
    const remainingBalance = purchases.reduce((sum, p) => sum + (Number(p.amountRemaining) || 0), 0);

    return res.json({
      success: true,
      summary: {
        totalPurchased,
        totalPurchaseValue,
        remainingBalance,
      },
      data: purchases,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
