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
    const isAll = req.query.all === "true" || req.query.limit === "all";
    const page = parseInt(req.query.page) || 1;
    const limit = isAll ? 10000 : (parseInt(req.query.limit) || 10);
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const [purchasesSnap, salesSnap] = await Promise.all([
      db.collection("purchases").get(),
      db.collection("sales").get()
    ]);

    const purchases = purchasesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(p => !p.isDeleted);
    const sales = salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(s => !s.isDeleted);

    // Identify returned sale IDs from both sale flags and return purchase records
    const returnedSaleIds = new Set();
    sales.forEach(s => {
      if (s.isReturned) returnedSaleIds.add(s.id);
    });
    purchases.forEach(p => {
      if (p.isReturn && p.previousSaleId) {
        returnedSaleIds.add(p.previousSaleId);
      }
    });

    const soldLinkedPurchaseIds = new Set();
    const soldRegSet = new Set();
    const soldChasisSet = new Set();
    const soldEngineSet = new Set();

    sales.forEach(s => {
      // Returned sales do not hold a bike as sold in active inventory
      if (s.isReturned || returnedSaleIds.has(s.id)) return;

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

      const hasActiveSoldSale = p.soldSaleId && !returnedSaleIds.has(p.soldSaleId);

      const isSold =
        p.sold === true && !p.isReturn
          ? true
          : (hasActiveSoldSale ||
             soldLinkedPurchaseIds.has(p.id) ||
             (regKey && soldRegSet.has(regKey)) ||
             (chasisKey && soldChasisSet.has(chasisKey)) ||
             (engineKey && soldEngineSet.has(engineKey)));

      if (isSold) {
        // Auto-heal purchase record if it was not marked as sold
        if (!p.sold) {
          db.collection("purchases").doc(p.id).update({ sold: true, updatedAt: new Date() }).catch(() => {});
        }
      } else {
        // If a return purchase was previously erroneously marked sold, unmark it
        if (p.sold && p.isReturn && !hasActiveSoldSale && !soldLinkedPurchaseIds.has(p.id)) {
          p.sold = false;
          db.collection("purchases").doc(p.id).update({ sold: false, soldSaleId: null, updatedAt: new Date() }).catch(() => {});
        }
        unsoldPurchases.push(p);
      }
    });

    let filteredUnsold = unsoldPurchases;
    if (startDate || endDate) {
      filteredUnsold = unsoldPurchases.filter(p => {
        const pSec = p.purchaseDateTime?._seconds || p.purchaseDateTime?.seconds;
        const pDate = pSec ? new Date(pSec * 1000) : (p.purchaseDateTime || p.purchaseDate ? new Date(p.purchaseDateTime || p.purchaseDate) : (p.createdAt ? new Date(p.createdAt) : null));
        if (!pDate || isNaN(pDate.getTime())) return true;
        if (startDate && pDate < new Date(startDate)) return false;
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (pDate > end) return false;
        }
        return true;
      });
    }

    const total = filteredUnsold.length;
    const totalPurchased = total;
    const totalPurchaseValue = filteredUnsold.reduce((sum, p) => sum + (Number(p.actualAmount) || 0), 0);
    const remainingBalance = filteredUnsold.reduce((sum, p) => sum + (Number(p.amountRemaining) || 0), 0);

    // Sort and paginate in-memory (avoids Firestore composite index requirement)
    filteredUnsold.sort((a, b) => {
      const dateA = a.purchaseDateTime?._seconds || a.purchaseDateTime?.seconds || (a.createdAt ? new Date(a.createdAt).getTime() / 1000 : 0) || 0;
      const dateB = b.purchaseDateTime?._seconds || b.purchaseDateTime?.seconds || (b.createdAt ? new Date(b.createdAt).getTime() / 1000 : 0) || 0;
      return dateB - dateA;
    });

    const offset = (page - 1) * limit;
    const paginatedData = isAll ? filteredUnsold : filteredUnsold.slice(offset, offset + limit);

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
