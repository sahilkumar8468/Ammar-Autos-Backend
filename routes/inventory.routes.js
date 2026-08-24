const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

const normalizeKey = (str) => {
  if (!str) return "";
  const cleaned = str.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned === "AFR" || !cleaned) return "";
  return cleaned;
};

// GET /api/inventory - returns unsold bikes inventory and summary stats (paginated)
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const [purchasesSnap, salesSnap] = await Promise.all([
      db.collection("purchases").get(),
      db.collection("sales").get()
    ]);

    const purchases = purchasesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const sales = salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const soldLinkedPurchaseIds = new Set();
    const soldRegSet = new Set();
    const soldChasisSet = new Set();
    const soldEngineSet = new Set();

    sales.forEach(s => {
      if (s.linkedPurchaseId) soldLinkedPurchaseIds.add(s.linkedPurchaseId);
      const reg = normalizeKey(s.registrationNo);
      if (reg) soldRegSet.add(reg);
      const chasis = normalizeKey(s.chasisNo);
      if (chasis) soldChasisSet.add(chasis);
      const engine = normalizeKey(s.engineNo);
      if (engine) soldEngineSet.add(engine);
    });

    const unsoldPurchases = [];

    purchases.forEach(p => {
      const regKey = normalizeKey(p.registrationNo);
      const chasisKey = normalizeKey(p.chasisNo);
      const engineKey = normalizeKey(p.engineNo);

      const isSold =
        p.sold === true ||
        !!p.soldSaleId ||
        soldLinkedPurchaseIds.has(p.id) ||
        (regKey && soldRegSet.has(regKey)) ||
        (chasisKey && soldChasisSet.has(chasisKey)) ||
        (engineKey && soldEngineSet.has(engineKey));

      if (isSold) {
        // Auto-heal purchase record if it was not marked as sold
        if (!p.sold) {
          db.collection("purchases").doc(p.id).update({ sold: true, updatedAt: new Date() }).catch(() => {});
        }
      } else {
        unsoldPurchases.push(p);
      }
    });

    const total = unsoldPurchases.length;
    const totalPurchased = total;
    const totalPurchaseValue = unsoldPurchases.reduce((sum, p) => sum + (Number(p.actualAmount) || 0), 0);
    const remainingBalance = unsoldPurchases.reduce((sum, p) => sum + (Number(p.amountRemaining) || 0), 0);

    // Sort and paginate in-memory (avoids Firestore composite index requirement)
    unsoldPurchases.sort((a, b) => {
      const dateA = a.purchaseDateTime?._seconds || a.purchaseDateTime?.seconds || (a.createdAt ? new Date(a.createdAt).getTime() / 1000 : 0) || 0;
      const dateB = b.purchaseDateTime?._seconds || b.purchaseDateTime?.seconds || (b.createdAt ? new Date(b.createdAt).getTime() / 1000 : 0) || 0;
      return dateB - dateA;
    });

    const offset = (page - 1) * limit;
    const paginatedData = unsoldPurchases.slice(offset, offset + limit);

    return res.json({
      success: true,
      summary: {
        totalPurchased,
        totalUnsold: total,
        totalPurchaseValue,
        remainingBalance,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
      data: paginatedData,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
