const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

// GET /api/inventory - returns purchased bikes inventory and summary stats (paginated)
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    // Get all unsold purchases for stats and total count
    const allSnap = await db.collection("purchases").where("sold", "==", false).get();
    const allPurchases = allSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const total = allPurchases.length;
    const totalPurchased = total;
    const totalPurchaseValue = allPurchases.reduce((sum, p) => sum + (Number(p.actualAmount) || 0), 0);
    const remainingBalance = allPurchases.reduce((sum, p) => sum + (Number(p.amountRemaining) || 0), 0);

    // Sort and paginate in-memory (avoids Firestore composite index requirement)
    allPurchases.sort((a, b) => {
      const dateA = a.purchaseDateTime?._seconds || a.purchaseDateTime?.seconds || 0;
      const dateB = b.purchaseDateTime?._seconds || b.purchaseDateTime?.seconds || 0;
      return dateB - dateA;
    });

    const offset = (page - 1) * limit;
    const paginatedData = allPurchases.slice(offset, offset + limit);

    return res.json({
      success: true,
      summary: {
        totalPurchased,
        totalPurchaseValue,
        remainingBalance,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: paginatedData,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
