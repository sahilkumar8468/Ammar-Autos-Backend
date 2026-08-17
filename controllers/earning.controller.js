const { db } = require("../config/firebase");

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

    // Build lookup maps for fast purchase matching by id, regNo, chasisNo, engineNo
    const purchaseById = new Map();
    const purchaseByReg = new Map();
    const purchaseByChasis = new Map();
    const purchaseByEngine = new Map();

    purchases.forEach((p) => {
      purchaseById.set(p.id, p);
      if (p.registrationNo && p.registrationNo !== "AFR") {
        purchaseByReg.set(p.registrationNo.toUpperCase().trim(), p);
      }
      if (p.chasisNo && p.chasisNo !== "AFR") {
        purchaseByChasis.set(p.chasisNo.toUpperCase().trim(), p);
      }
      if (p.engineNo && p.engineNo !== "AFR") {
        purchaseByEngine.set(p.engineNo.toUpperCase().trim(), p);
      }
    });

    // 1. Current Stock Metrics (unsold bikes)
    const stockBikes = purchases.filter((p) => !p.sold);
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
      if (val instanceof Date) return val;
      if (typeof val === "object") {
        const secs = val._seconds || val.seconds;
        if (typeof secs === "number") return new Date(secs * 1000);
      }
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
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

    const profitList = filteredSales.map((s) => {
      const sDate = helperGetDate(s.saleDateTime) || helperGetDate(s.createdAt);
      let matchedPurchase = null;

      if (s.linkedPurchaseId && purchaseById.has(s.linkedPurchaseId)) {
        matchedPurchase = purchaseById.get(s.linkedPurchaseId);
      } else if (s.registrationNo && s.registrationNo !== "AFR" && purchaseByReg.has(s.registrationNo.toUpperCase().trim())) {
        matchedPurchase = purchaseByReg.get(s.registrationNo.toUpperCase().trim());
      } else if (s.chasisNo && s.chasisNo !== "AFR" && purchaseByChasis.has(s.chasisNo.toUpperCase().trim())) {
        matchedPurchase = purchaseByChasis.get(s.chasisNo.toUpperCase().trim());
      } else if (s.engineNo && s.engineNo !== "AFR" && purchaseByEngine.has(s.engineNo.toUpperCase().trim())) {
        matchedPurchase = purchaseByEngine.get(s.engineNo.toUpperCase().trim());
      }

      const salePrice = parseFloat(s.totalSaleAmount || 0);
      const purchaseCost = matchedPurchase
        ? parseFloat(matchedPurchase.actualAmount || 0) + parseFloat(matchedPurchase.additionalExpense || 0)
        : 0;

      const profit = salePrice - purchaseCost;
      totalProfit += profit;
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
        purchaseCost,
        salePrice,
        profit,
        hasMatchedPurchase: !!matchedPurchase,
        purchaseCategory: matchedPurchase?.category || null
      };
    });

    const totalPurchasesCost = filteredPurchases.reduce((sum, p) => {
      return sum + parseFloat(p.actualAmount || 0) + parseFloat(p.additionalExpense || 0);
    }, 0);

    // Build Chart / Trend Data grouped by Month or Day depending on range
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
