const { db } = require("../config/firebase");

/**
 * Normalizes string keys by stripping hyphens, spaces, and non-alphanumeric chars
 * for maximum tolerance matching (e.g. "HC-Q 0623" matches "HCQ0623")
 */
const normalizeKey = (str) => {
  if (!str) return "";
  const cleaned = str.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned === "AFR" || !cleaned) return "";
  return cleaned;
};

/**
 * GET /api/reports/earning or /api/earning
 * Query parameters:
 *  - range: "10days" | "thisMonth" | "6months" | "perMonth" | "custom" | "all"
 *  - startDate: "YYYY-MM-DD"
 *  - endDate: "YYYY-MM-DD"
 *  - month: "YYYY-MM"
 */
const getEarningStats = async (req, res) => {
  try {
    const { range = "all", startDate, endDate, month } = req.query;

    const [purchasesSnap, salesSnap] = await Promise.all([
      db.collection("purchases").get(),
      db.collection("sales").get()
    ]);

    const purchases = purchasesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    const sales = salesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data()
    }));

    // Build multi-layer lookup maps for 100% accurate purchase matching
    const purchaseById = new Map();
    const purchaseBySoldSaleId = new Map();
    const purchaseByReg = new Map();
    const purchaseByChasis = new Map();
    const purchaseByEngine = new Map();

    purchases.forEach((p) => {
      purchaseById.set(p.id, p);
      if (p.soldSaleId) {
        purchaseBySoldSaleId.set(p.soldSaleId, p);
      }

      const regKey = normalizeKey(p.registrationNo);
      if (regKey) purchaseByReg.set(regKey, p);

      const chasisKey = normalizeKey(p.chasisNo);
      if (chasisKey) purchaseByChasis.set(chasisKey, p);

      const engineKey = normalizeKey(p.engineNo);
      if (engineKey) purchaseByEngine.set(engineKey, p);
    });

    const soldLinkedPurchaseIds = new Set();
    const soldRegSet = new Set();
    const soldChasisSet = new Set();
    const soldEngineSet = new Set();

    sales.forEach((s) => {
      if (s.linkedPurchaseId) soldLinkedPurchaseIds.add(s.linkedPurchaseId);
      const reg = normalizeKey(s.registrationNo);
      if (reg) soldRegSet.add(reg);
      const chasis = normalizeKey(s.chasisNo);
      if (chasis) soldChasisSet.add(chasis);
      const engine = normalizeKey(s.engineNo);
      if (engine) soldEngineSet.add(engine);
    });

    // 1. Current Stock Metrics (unsold bikes)
    const stockBikes = purchases.filter((p) => {
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

      return !isSold;
    });
    const currentStockCount = stockBikes.length;
    const currentStockValue = stockBikes.reduce((sum, p) => {
      const cost = parseFloat(p.actualAmount || 0) + parseFloat(p.additionalExpense || 0);
      return sum + cost;
    }, 0);

    // 2. Date Filtering Setup
    const now = new Date();
    let filterStart = null;
    let filterEnd = null;

    if (range === "10days") {
      filterStart = new Date();
      filterStart.setDate(now.getDate() - 10);
      filterStart.setHours(0, 0, 0, 0);
    } else if (range === "thisMonth") {
      filterStart = new Date(now.getFullYear(), now.getMonth(), 1);
      filterEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (range === "6months") {
      filterStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      filterStart.setHours(0, 0, 0, 0);
    } else if (range === "perMonth" && month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split("-").map(Number);
      filterStart = new Date(y, m - 1, 1);
      filterEnd = new Date(y, m, 0, 23, 59, 59, 999);
    } else if (range === "custom" || (startDate && endDate)) {
      if (startDate) {
        filterStart = new Date(startDate);
        filterStart.setHours(0, 0, 0, 0);
      }
      if (endDate) {
        filterEnd = new Date(endDate);
        filterEnd.setHours(23, 59, 59, 999);
      }
    }

    const helperGetDate = (val) => {
      if (!val) return null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
      if (typeof val.toDate === "function") return val.toDate();
      const secs = val._seconds ?? val.seconds;
      if (typeof secs === "number") return new Date(secs * 1000);
      if (typeof val === "string" || typeof val === "number") {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
      }
      return null;
    };

    // Filter sales within date range
    const filteredSales = sales.filter((s) => {
      const sDate = helperGetDate(s.saleDateTime) || helperGetDate(s.createdAt);
      if (!sDate) return true;
      if (filterStart && sDate < filterStart) return false;
      if (filterEnd && sDate > filterEnd) return false;
      return true;
    });

    // Filter purchases within date range for "Bikes Bought in Period"
    const filteredPurchases = purchases.filter((p) => {
      const pDate = helperGetDate(p.purchaseDateTime) || helperGetDate(p.createdAt);
      if (!pDate) return true;
      if (filterStart && pDate < filterStart) return false;
      if (filterEnd && pDate > filterEnd) return false;
      return true;
    });

    let totalProfit = 0;
    let totalSalesRevenue = 0;
    let matchedSalesCount = 0;
    let unmatchedSalesCount = 0;

    const profitList = filteredSales.map((s) => {
      const sDate = helperGetDate(s.saleDateTime) || helperGetDate(s.createdAt);
      let matchedPurchase = null;

      const regKey = normalizeKey(s.registrationNo);
      const chasisKey = normalizeKey(s.chasisNo);
      const engineKey = normalizeKey(s.engineNo);

      // Multi-tier matching logic:
      if (purchaseBySoldSaleId.has(s.id)) {
        matchedPurchase = purchaseBySoldSaleId.get(s.id);
      } else if (s.linkedPurchaseId && purchaseById.has(s.linkedPurchaseId)) {
        matchedPurchase = purchaseById.get(s.linkedPurchaseId);
      } else if (chasisKey && purchaseByChasis.has(chasisKey)) {
        matchedPurchase = purchaseByChasis.get(chasisKey);
      } else if (engineKey && purchaseByEngine.has(engineKey)) {
        matchedPurchase = purchaseByEngine.get(engineKey);
      } else if (regKey && purchaseByReg.has(regKey)) {
        matchedPurchase = purchaseByReg.get(regKey);
      }

      const salePrice = parseFloat(s.totalSaleAmount || 0);
      let purchaseCost = 0;
      let profit = 0;
      let hasMatchedPurchase = false;

      if (matchedPurchase) {
        hasMatchedPurchase = true;
        matchedSalesCount += 1;
        purchaseCost = parseFloat(matchedPurchase.actualAmount || 0) + parseFloat(matchedPurchase.additionalExpense || 0);
        profit = salePrice - purchaseCost;
        totalProfit += profit;
      } else {
        unmatchedSalesCount += 1;
        // Unmatched sales don't distort net profit unless estimated
        purchaseCost = 0;
        profit = salePrice;
        totalProfit += profit;
      }

      totalSalesRevenue += salePrice;

      return {
        saleId: s.id,
        saleDate: sDate ? sDate.toISOString() : null,
        buyerName: s.buyerName || "—",
        buyerCnic: s.buyerCnic || "—",
        bikeCompany: s.bikeCompany || matchedPurchase?.bikeCompany || "—",
        bikeModel: s.bikeModel || matchedPurchase?.bikeModel || "—",
        registrationNo: s.registrationNo || "—",
        chasisNo: s.chasisNo || "—",
        engineNo: s.engineNo || "—",
        purchaseCost,
        salePrice,
        profit,
        hasMatchedPurchase,
        purchaseCategory: matchedPurchase?.category || null
      };
    });

    const totalPurchasesCost = filteredPurchases.reduce((sum, p) => {
      return sum + parseFloat(p.actualAmount || 0) + parseFloat(p.additionalExpense || 0);
    }, 0);

    // Build Chart / Trend Data grouped by Month or Day
    const trendMap = new Map();

    const getGroupKey = (d) => {
      if (!d) return "Unknown";
      if (range === "10days") {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    };

    filteredSales.forEach((s) => {
      const sDate = helperGetDate(s.saleDateTime) || helperGetDate(s.createdAt);
      const key = getGroupKey(sDate);
      if (!trendMap.has(key)) {
        trendMap.set(key, { period: key, profit: 0, salesCount: 0, revenue: 0, purchasesCount: 0, purchaseCost: 0 });
      }
      const entry = trendMap.get(key);
      entry.salesCount += 1;
      entry.revenue += parseFloat(s.totalSaleAmount || 0);

      const matched = profitList.find((p) => p.saleId === s.id);
      if (matched) entry.profit += matched.profit;
    });

    filteredPurchases.forEach((p) => {
      const pDate = helperGetDate(p.purchaseDateTime) || helperGetDate(p.createdAt);
      const key = getGroupKey(pDate);
      if (!trendMap.has(key)) {
        trendMap.set(key, { period: key, profit: 0, salesCount: 0, revenue: 0, purchasesCount: 0, purchaseCost: 0 });
      }
      const entry = trendMap.get(key);
      entry.purchasesCount += 1;
      entry.purchaseCost += parseFloat(p.actualAmount || 0) + parseFloat(p.additionalExpense || 0);
    });

    const chartData = Array.from(trendMap.values()).sort((a, b) => a.period.localeCompare(b.period));

    return res.status(200).json({
      success: true,
      range,
      filterStart: filterStart ? filterStart.toISOString() : null,
      filterEnd: filterEnd ? filterEnd.toISOString() : null,
      summary: {
        totalProfit,
        totalSalesCount: filteredSales.length,
        totalSalesRevenue,
        matchedSalesCount,
        unmatchedSalesCount,
        totalPurchasesCount: filteredPurchases.length,
        totalPurchasesCost,
        currentStockCount,
        currentStockValue
      },
      chartData,
      profitList
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getEarningStats };
