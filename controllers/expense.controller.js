const { db } = require("../config/firebase");

/**
 * Normalizes string keys by stripping hyphens, spaces, and non-alphanumeric chars
 */
const normalizeKey = (str) => {
  if (!str) return "";
  const cleaned = str.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned === "AFR" || !cleaned) return "";
  return cleaned;
};

const parseDate = (val) => {
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

/**
 * CREATE: Add a new manual daily expense or income (e.g. employee wage, chai, spare parts, utilities)
 * POST /api/expense
 */
const createExpense = async (req, res) => {
  try {
    const { title, amount, category, expenseDate, description, transactionType = "expense" } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: "Expense title is required." });
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: "A valid positive amount is required." });
    }

    const expenseData = {
      title: title.trim(),
      amount: numericAmount,
      transactionType: transactionType === "income" ? "income" : "expense",
      category: category ? category.trim() : "General",
      expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
      description: description ? description.trim() : "",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await db.collection("expenses").add(expenseData);

    return res.status(201).json({
      success: true,
      message: `${transactionType === "income" ? "Income" : "Expense"} recorded successfully`,
      id: docRef.id,
      data: expenseData
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * READ ALL: Fetch manual expenses with pagination & date filtering
 * GET /api/expense
 */
const getAllExpenses = async (req, res) => {
  try {
    const { page = "1", limit = "50", category, month, search } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));

    let query = db.collection("expenses");
    if (category && category !== "all") {
      query = query.where("category", "==", category);
    }

    const snapshot = await query.get();
    let expenses = [];
    snapshot.forEach(doc => {
      expenses.push({ id: doc.id, ...doc.data() });
    });

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      expenses = expenses.filter(e => {
        const d = parseDate(e.expenseDate || e.createdAt);
        if (!d) return false;
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return m === month;
      });
    }

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      expenses = expenses.filter(e =>
        (e.title || "").toLowerCase().includes(term) ||
        (e.category || "").toLowerCase().includes(term) ||
        (e.description || "").toLowerCase().includes(term)
      );
    }

    // Sort newest first
    expenses.sort((a, b) => {
      const dateA = parseDate(a.expenseDate || a.createdAt) || new Date(0);
      const dateB = parseDate(b.expenseDate || b.createdAt) || new Date(0);
      return dateB - dateA;
    });

    const totalCount = expenses.length;
    const totalAmount = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const start = (pageNum - 1) * limitNum;
    const paged = expenses.slice(start, start + limitNum);

    return res.status(200).json({
      success: true,
      count: paged.length,
      totalCount,
      totalAmount,
      data: paged
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * UPDATE: Modify an existing expense
 * PUT /api/expense/:id
 */
const updateExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, amount, category, expenseDate, description, transactionType } = req.body;

    const docRef = db.collection("expenses").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Expense record not found" });
    }

    const updateData = { updatedAt: new Date() };

    if (title !== undefined) {
      if (!title.trim()) return res.status(400).json({ success: false, message: "Title cannot be empty." });
      updateData.title = title.trim();
    }

    if (amount !== undefined) {
      const num = parseFloat(amount);
      if (isNaN(num) || num <= 0) return res.status(400).json({ success: false, message: "A valid positive amount is required." });
      updateData.amount = num;
    }

    if (category !== undefined) updateData.category = category.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (expenseDate !== undefined) updateData.expenseDate = new Date(expenseDate);
    if (transactionType !== undefined) updateData.transactionType = transactionType === "income" ? "income" : "expense";

    await docRef.update(updateData);

    return res.status(200).json({
      success: true,
      message: "Expense record updated successfully"
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE: Remove an expense record
 * DELETE /api/expense/:id
 */
const deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("expenses").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Expense record not found" });
    }

    await docRef.delete();

    return res.status(200).json({
      success: true,
      message: "Expense record deleted successfully"
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * OVERVIEW / GENERAL LEDGER: Combines manual expenses, bike purchases, bike sales, and registrations into a daily cash flow & general ledger
 * GET /api/expense/overview
 */
const getExpenseOverview = async (req, res) => {
  try {
    const { range = "today", startDate, endDate, month, date } = req.query;

    const [expensesSnap, purchasesSnap, salesSnap, regSnap] = await Promise.all([
      db.collection("expenses").get(),
      db.collection("purchases").get(),
      db.collection("sales").get(),
      db.collection("registrations").get()
    ]);

    const expenses = expensesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const purchases = purchasesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const sales = salesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const registrations = regSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Build multi-layer lookup maps for purchases to compute accurate gross profit on sales
    const purchaseById = new Map();
    const purchaseBySoldSaleId = new Map();
    const purchaseByReg = new Map();
    const purchaseByChasis = new Map();
    const purchaseByEngine = new Map();

    purchases.forEach(p => {
      purchaseById.set(p.id, p);
      if (p.soldSaleId) purchaseBySoldSaleId.set(p.soldSaleId, p);
      const regKey = normalizeKey(p.registrationNo);
      if (regKey) purchaseByReg.set(regKey, p);
      const chasisKey = normalizeKey(p.chasisNo);
      if (chasisKey) purchaseByChasis.set(chasisKey, p);
      const engineKey = normalizeKey(p.engineNo);
      if (engineKey) purchaseByEngine.set(engineKey, p);
    });

    // Date range boundaries
    const now = new Date();
    let filterStart = null;
    let filterEnd = null;

    if (range === "today") {
      filterStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      filterEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (range === "yesterday") {
      const yest = new Date(now);
      yest.setDate(yest.getDate() - 1);
      filterStart = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0, 0);
      filterEnd = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999);
    } else if (range === "specificDate" && date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [y, m, d] = date.split("-").map(Number);
      filterStart = new Date(y, m - 1, d, 0, 0, 0, 0);
      filterEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else if (range === "thisMonth") {
      filterStart = new Date(now.getFullYear(), now.getMonth(), 1);
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (range === "pastMonth") {
      filterStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (range === "6months") {
      filterStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (range === "1year") {
      filterStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      filterStart.setHours(0, 0, 0, 0);
      filterEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (range === "perMonth" && month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split("-").map(Number);
      filterStart = new Date(y, m - 1, 1);
      filterStart.setHours(0, 0, 0, 0);
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

    const isInRange = (d) => {
      if (!d) return true;
      if (filterStart && d < filterStart) return false;
      if (filterEnd && d > filterEnd) return false;
      return true;
    };

    // Filter by date range
    const filteredExpenses = expenses.filter(e => isInRange(parseDate(e.expenseDate || e.createdAt)));
    const filteredPurchases = purchases.filter(p => isInRange(parseDate(p.purchaseDateTime || p.createdAt)));
    const filteredSales = sales.filter(s => isInRange(parseDate(s.saleDateTime || s.createdAt)));
    const filteredRegistrations = registrations.filter(r => isInRange(parseDate(r.registrationDateTime || r.createdAt)));

    // Categorize operational expenses vs additional income entries
    const generalExpensesList = filteredExpenses.filter(e => e.transactionType !== "income");
    const manualIncomeList = filteredExpenses.filter(e => e.transactionType === "income");

    const totalGeneralExpenses = generalExpensesList.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const totalManualIncome = manualIncomeList.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);

    const totalBikePurchasesCost = filteredPurchases.reduce((sum, p) => sum + (parseFloat(p.actualAmount) || 0) + (parseFloat(p.additionalExpense) || 0), 0);
    const totalBikeSalesRevenue = filteredSales.reduce((sum, s) => sum + (parseFloat(s.totalSaleAmount) || 0), 0);

    const totalRegCustomerFees = filteredRegistrations.reduce((sum, r) => sum + (parseFloat(r.customerTotalMoney) || 0), 0);
    const totalRegAgentCosts = filteredRegistrations.reduce((sum, r) => sum + (parseFloat(r.agentTotalMoney) || 0), 0);
    const totalRegProfit = totalRegCustomerFees - totalRegAgentCosts;

    // Calculate gross profit on sales
    let totalBikeGrossProfit = 0;
    const saleListWithProfit = filteredSales.map(s => {
      const sDate = parseDate(s.saleDateTime || s.createdAt);
      let matchedPurchase = null;

      const regKey = normalizeKey(s.registrationNo);
      const chasisKey = normalizeKey(s.chasisNo);
      const engineKey = normalizeKey(s.engineNo);

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
      let cost = 0;
      let profit = 0;

      if (matchedPurchase) {
        cost = parseFloat(matchedPurchase.actualAmount || 0) + parseFloat(matchedPurchase.additionalExpense || 0);
        profit = salePrice - cost;
      } else {
        cost = parseFloat(s.purchaseCost || s.purchasePrice || s.originalPurchasePrice || 0);
        profit = salePrice - cost;
      }

      totalBikeGrossProfit += profit;

      return {
        id: s.id,
        type: "bike_sale",
        date: sDate ? sDate.toISOString() : null,
        title: `Bike Sale: ${[s.bikeCompany, s.bikeModel].filter(Boolean).join(" ") || s.registrationNo || "Bike"}`,
        buyerName: s.buyerName || "—",
        buyerCnic: s.buyerCnic || "—",
        registrationNo: s.registrationNo || "—",
        chasisNo: s.chasisNo || "—",
        engineNo: s.engineNo || "—",
        salePrice,
        cost,
        profit,
        category: "Bike Sale"
      };
    });

    const totalOtherIncome = totalManualIncome + totalRegCustomerFees;
    const totalOutflow = totalBikePurchasesCost + totalGeneralExpenses + totalRegAgentCosts;
    const totalInflow = totalBikeSalesRevenue + totalOtherIncome;
    const netCashFlow = totalInflow - totalOutflow;

    const totalGrossProfit = totalBikeGrossProfit + totalRegProfit + totalManualIncome;
    const netProfit = totalGrossProfit - totalGeneralExpenses;

    // Category breakdown for expenses
    const categoryBreakdownMap = new Map();
    generalExpensesList.forEach(e => {
      const cat = e.category || "General";
      const amt = parseFloat(e.amount || 0);
      categoryBreakdownMap.set(cat, (categoryBreakdownMap.get(cat) || 0) + amt);
    });
    const categoryBreakdown = Array.from(categoryBreakdownMap.entries()).map(([category, amount]) => ({
      category,
      amount
    })).sort((a, b) => b.amount - a.amount);

    // Chronological General Ledger Entries
    const ledger = [
      ...filteredExpenses.map(e => {
        const d = parseDate(e.expenseDate || e.date || e.createdAt);
        const amt = parseFloat(e.amount || 0);
        const isInc = e.transactionType === "income";
        return {
          id: e.id,
          type: isInc ? "manual_income" : "manual_expense",
          date: d ? d.toISOString() : (e.expenseDate || e.createdAt || null),
          expenseDate: e.expenseDate || e.date || e.createdAt || null,
          title: e.title,
          category: e.category || "General",
          amount: amt,
          description: e.description || "",
          inflow: isInc ? amt : 0,
          outflow: isInc ? 0 : amt,
          profit: isInc ? amt : -amt
        };
      }),
      ...filteredPurchases.map(p => {
        const d = parseDate(p.purchaseDateTime || p.date || p.createdAt);
        const cost = Math.abs(parseFloat(p.actualAmount || 0) + parseFloat(p.additionalExpense || 0));
        return {
          id: p.id,
          type: "bike_purchase",
          date: d ? d.toISOString() : (p.purchaseDateTime || p.createdAt || null),
          purchaseDateTime: p.purchaseDateTime || p.date || p.createdAt || null,
          title: `Bike Purchase: ${[p.bikeCompany, p.bikeModel].filter(Boolean).join(" ") || p.registrationNo || "Bike"}`,
          category: "Bike Purchase",
          customerName: p.customerName || "—",
          registrationNo: p.registrationNo || "—",
          chasisNo: p.chasisNo || "—",
          engineNo: p.engineNo || "—",
          amount: cost,
          inflow: 0,
          outflow: cost,
          profit: 0
        };
      }),
      ...saleListWithProfit.map(s => ({
        id: s.id,
        type: "bike_sale",
        date: s.date || s.saleDateTime || s.createdAt || null,
        title: s.title,
        category: "Bike Sale",
        buyerName: s.buyerName,
        registrationNo: s.registrationNo,
        chasisNo: s.chasisNo,
        engineNo: s.engineNo,
        amount: s.salePrice,
        cost: s.cost,
        profit: s.profit,
        inflow: s.salePrice,
        outflow: 0
      })),
      ...filteredRegistrations.map(r => {
        const d = parseDate(r.registrationDateTime || r.date || r.createdAt);
        const customerFee = parseFloat(r.customerTotalMoney || 0);
        const agentFee = parseFloat(r.agentTotalMoney || 0);
        const profit = customerFee - agentFee;
        return {
          id: r.id,
          type: "registration",
          date: d ? d.toISOString() : (r.registrationDateTime || r.createdAt || null),
          title: `Registration: ${[r.bikeCompany, r.bikeModel].filter(Boolean).join(" ") || r.registrationNo || "Bike"}`,
          category: "Registration Service",
          customerName: r.customerName || "—",
          registrationNo: r.registrationNo || "—",
          chasisNo: r.chasisNo || "—",
          amount: customerFee,
          inflow: customerFee,
          outflow: agentFee,
          profit
        };
      })
    ];

    // Sort unified ledger newest first
    ledger.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });

    return res.status(200).json({
      success: true,
      range,
      filterStart: filterStart ? filterStart.toISOString() : null,
      filterEnd: filterEnd ? filterEnd.toISOString() : null,
      summary: {
        totalGeneralExpenses,
        totalBikePurchasesCost,
        totalBikeSalesRevenue,
        totalBikeGrossProfit,
        totalOtherIncome,
        totalRegAgentCosts,
        totalInflow,
        totalOutflow,
        totalGrossProfit,
        netProfit,
        netCashFlow,
        expensesCount: filteredExpenses.length,
        purchasesCount: filteredPurchases.length,
        salesCount: filteredSales.length,
        registrationsCount: filteredRegistrations.length
      },
      categoryBreakdown,
      expenses: filteredExpenses.sort((a, b) => (parseDate(b.expenseDate || b.createdAt) || 0) - (parseDate(a.expenseDate || a.createdAt) || 0)),
      purchases: filteredPurchases.sort((a, b) => (parseDate(b.purchaseDateTime || b.createdAt) || 0) - (parseDate(a.purchaseDateTime || a.createdAt) || 0)),
      sales: saleListWithProfit.sort((a, b) => (new Date(b.date || 0)) - (new Date(a.date || 0))),
      registrations: filteredRegistrations,
      ledger
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createExpense,
  getAllExpenses,
  updateExpense,
  deleteExpense,
  getExpenseOverview
};
