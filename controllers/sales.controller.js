const { db } = require("../config/firebase");
const { normalizeRegistration,normalizeChasis,normalizeEngine  } = require("./purchase.controller");

const SALE_CATEGORIES = ["company", "local_customer", "dealer"];

/**
 * Builds the month-by-month installment schedule for an installment sale.
 * Each entry tracks its own paid/reminder state so the reminder job can
 * work off Firestore data alone (no external scheduler state needed).
 */

/**
 * LOOKUP BY CHASIS: second step of the sale-search flow, used when the
 * registration number is AFR or wasn't found.
 * GET /api/sale/lookup-bike-chasis/:chasisNo
 */
const lookupBikeByChasis = async (req, res) => {
  try {
    const { chasisNo } = req.params;
    const { chasisNo: normalizedChasisNo, chasisStatus } = normalizeChasis(chasisNo);

    if (chasisStatus !== "registered") {
      return res.status(200).json({ success: true, found: false });
    }

    const purchaseSnap = await db
      .collection("purchases")
      .where("chasisNo", "==", normalizedChasisNo)
      .limit(1)
      .get();

    if (purchaseSnap.empty) {
      return res.status(200).json({ success: true, found: false });
    }

    const purchaseDoc = purchaseSnap.docs[0];
    const purchase = purchaseDoc.data();

    if (purchase.sold) {
      return res.status(200).json({
        success: true,
        found: true,
        alreadySold: true,
        message: "This bike is already marked as sold in a previous sale record."
      });
    }

    return res.status(200).json({
      success: true,
      found: true,
      alreadySold: false,
      purchaseId: purchaseDoc.id,
      purchaseCategory: purchase.category || "local_customer",
      data: {
        bikeCompany: purchase.bikeCompany || "",
        bikeModel: purchase.bikeModel || "",
        chasisNo: purchase.chasisNo || "",
        engineNo: purchase.engineNo || "",
        registrationNo: purchase.registrationNo || "",
        registrationStatus: purchase.registrationStatus || "registered",
        originalPurchase: {
          purchasedFrom: purchase.customerName || "",
          purchasedFromCnic: purchase.cnicNumber || "",
          purchaseDate: purchase.purchaseDateTime || null
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * LOOKUP BY ENGINE: third/final step of the sale-search flow, used when
 * both registration and chasis searches came up empty.
 * GET /api/sale/lookup-bike-engine/:engineNo
 */
const lookupBikeByEngine = async (req, res) => {
  try {
    const { engineNo } = req.params;
    const { engineNo: normalizedEngineNo, engineStatus } = normalizeEngine(engineNo);

    if (engineStatus !== "registered") {
      return res.status(200).json({ success: true, found: false });
    }

    const purchaseSnap = await db
      .collection("purchases")
      .where("engineNo", "==", normalizedEngineNo)
      .limit(1)
      .get();

    if (purchaseSnap.empty) {
      return res.status(200).json({ success: true, found: false });
    }

    const purchaseDoc = purchaseSnap.docs[0];
    const purchase = purchaseDoc.data();

    if (purchase.sold) {
      return res.status(200).json({
        success: true,
        found: true,
        alreadySold: true,
        message: "This bike is already marked as sold in a previous sale record."
      });
    }

    return res.status(200).json({
      success: true,
      found: true,
      alreadySold: false,
      purchaseId: purchaseDoc.id,
      purchaseCategory: purchase.category || "local_customer",
      data: {
        bikeCompany: purchase.bikeCompany || "",
        bikeModel: purchase.bikeModel || "",
        chasisNo: purchase.chasisNo || "",
        engineNo: purchase.engineNo || "",
        registrationNo: purchase.registrationNo || "",
        registrationStatus: purchase.registrationStatus || "registered",
        originalPurchase: {
          purchasedFrom: purchase.customerName || "",
          purchasedFromCnic: purchase.cnicNumber || "",
          purchaseDate: purchase.purchaseDateTime || null
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};


const buildInstallmentSchedule = (startDate, months, perMonthAmount) => {
  const schedule = [];
  const start = startDate ? new Date(startDate) : new Date();

  for (let i = 1; i <= months; i++) {
    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + i);

    schedule.push({
      monthNumber: i,
      dueDate,
      amount: parseFloat(perMonthAmount || 0),
      paid: false,
      paidDate: null,
      upcomingReminderSent: false, // the single "due in a week" notice
      lastOverdueReminderDate: null // used to throttle overdue reminders to once/day
    });
  }
  return schedule;
};

/**
 * CREATE: Record a new sale
 * POST /api/sale
 */
const createSale = async (req, res) => {
  try {
    const {
      category, // buyer category — mirrors the purchase tabs (company / local_customer / dealer)

      // Buyer
      buyerName,
      buyerFatherName,
      buyerCurrentAddress,
      buyerPermanentAddress,
      addressSameAsPermanent,
      buyerCnic,
      buyerPhotos,

      // Saler (showroom staff handling this sale)
      salerName,
      salerNumber,
      salerCnic,
      salerAddress,
      salerPhotos,

      // Bike / registration
      bikeCompany,
      bikeModel,
      chasisNo,
      engineNo,
      registrationNo,
      linkedPurchaseId, // set by the frontend when it matched an existing purchase by reg no

      // Sale terms
      saleDateTime,
      totalSaleAmount,
      advanceReceived,
      saleType, // "cash" | "installment"
      installmentMonths,
      perMonthInstallment,
      installmentStartDate
    } = req.body;

    if (!category || !SALE_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: "Valid sale category (company, local_customer, dealer) is required."
      });
    }

    if (!buyerName || !buyerCnic) {
      return res.status(400).json({
        success: false,
        message: "Buyer name and CNIC are required."
      });
    }

    if (!["cash", "installment"].includes(saleType)) {
      return res.status(400).json({
        success: false,
        message: "saleType must be either 'cash' or 'installment'."
      });
    }

    const { registrationNo: normalizedRegNo, registrationStatus } = normalizeRegistration(registrationNo);

    // Only enforce "already sold" checks for real registration numbers.
    if (registrationStatus === "registered") {
      const existingSale = await db
        .collection("sales")
        .where("registrationNo", "==", normalizedRegNo)
        .limit(1)
        .get();
      if (!existingSale.empty) {
        return res.status(409).json({
          success: false,
          message: `A sale already exists for registration number "${normalizedRegNo}".`
        });
      }
    }

    const total = parseFloat(totalSaleAmount || 0);
    const advance = parseFloat(advanceReceived || 0);

    let installments = [];
    let months = 0;
    let perMonth = 0;

    if (saleType === "installment") {
      months = parseInt(installmentMonths || 0, 10);
      perMonth = parseFloat(perMonthInstallment || 0);

      if (!months || !perMonth) {
        return res.status(400).json({
          success: false,
          message: "installmentMonths and perMonthInstallment are required for installment sales."
        });
      }

      installments = buildInstallmentSchedule(installmentStartDate, months, perMonth);
    }

    const amountRemaining =
      saleType === "installment" ? Math.max(total - advance, 0) : Math.max(total - advance, 0);

    const saleData = {
      category,

      buyerName,
      buyerFatherName: buyerFatherName || "",
      buyerCurrentAddress: buyerCurrentAddress || "",
      // If addressSameAsPermanent is true, mirror current -> permanent, exactly
      // like the frontend checkbox behavior described.
      buyerPermanentAddress: addressSameAsPermanent ? (buyerCurrentAddress || "") : (buyerPermanentAddress || ""),
      addressSameAsPermanent: !!addressSameAsPermanent,
      buyerCnic,
      buyerPhotos: Array.isArray(buyerPhotos) ? buyerPhotos : [],

      salerName: salerName || "",
      salerNumber: salerNumber || "",
      salerCnic: salerCnic || "",
      salerAddress: salerAddress || "",
      salerPhotos: Array.isArray(salerPhotos) ? salerPhotos : [],

      bikeCompany: bikeCompany || "",
      bikeModel: bikeModel || "",
      chasisNo: chasisNo || "",
      engineNo: engineNo || "",
      registrationNo: normalizedRegNo,
      registrationStatus,
      linkedPurchaseId: linkedPurchaseId || null,

      saleDateTime: saleDateTime ? new Date(saleDateTime) : new Date(),
      totalSaleAmount: total,
      advanceReceived: advance,
      amountRemaining,

      saleType,
      installmentMonths: months || null,
      perMonthInstallment: perMonth || null,
      installmentStartDate: saleType === "installment" ? new Date(installmentStartDate || new Date()) : null,
      installments,

      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await db.collection("sales").add(saleData);

    // Mark the source purchase as sold, if this sale was linked to one.
    if (linkedPurchaseId) {
      await db.collection("purchases").doc(linkedPurchaseId).update({
        sold: true,
        soldSaleId: docRef.id,
        updatedAt: new Date()
      });
    }

    return res.status(201).json({
      success: true,
      message: `${category.replace("_", " ")} sale created successfully`,
      id: docRef.id,
      data: saleData
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * READ ALL: Fetch sales, with optional category, month, and search filters.
 * GET /api/sale?category=local_customer&month=2026-07&search=LEA-1234
 *
 * - month: "YYYY-MM" — restricts to sales whose saleDateTime falls in that month
 * - search: matched (case-insensitive, partial) against registrationNo,
 *   chasisNo, engineNo, and buyerCnic ("customer no"). Firestore can't do
 *   partial-text search server-side, so this filters in-memory after the
 *   month/category query narrows things down — fine at showroom-POS scale.
 */
const getAllSales = async (req, res) => {
  try {
    const { category, month, search, page: pageStr, limit: limitStr } = req.query;
    const page = Math.max(1, parseInt(pageStr) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr) || 10));
    let collectionRef = db.collection("sales");

    if (category && SALE_CATEGORIES.includes(category)) {
      collectionRef = collectionRef.where("category", "==", category);
    }

    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, mon] = month.split("-").map(Number);
      const start = new Date(year, mon - 1, 1);
      const end = new Date(year, mon, 1); // first day of next month, exclusive
      collectionRef = collectionRef
        .where("saleDateTime", ">=", start)
        .where("saleDateTime", "<", end)
        .orderBy("saleDateTime", "desc");
    } else {
      collectionRef = collectionRef.orderBy("createdAt", "desc");
    }

    const snapshot = await collectionRef.get();

    let sales = [];
    snapshot.forEach(doc => {
      sales.push({ id: doc.id, ...doc.data() });
    });

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      sales = sales.filter(sale =>
        (sale.registrationNo || "").toLowerCase().includes(term) ||
        (sale.chasisNo || "").toLowerCase().includes(term) ||
        (sale.engineNo || "").toLowerCase().includes(term) ||
        (sale.buyerCnic || "").toLowerCase().includes(term)
      );
    }

    const totalCount = sales.length;
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const start = (page - 1) * limit;
    const paged = sales.slice(start, start + limit);

    return res.status(200).json({
      success: true,
      count: paged.length,
      totalCount,
      page,
      totalPages,
      limit,
      data: paged
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * STATS: Bikes sold + revenue. Filters by month if provided, otherwise all-time.
 * GET /api/sale/stats?month=2026-07
 * "Revenue" = sum of totalSaleAmount for matching sales.
 */
const getSaleStats = async (req, res) => {
  try {
    const { month } = req.query;

    let snapshot;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, mon] = month.split("-").map(Number);
      const start = new Date(year, mon - 1, 1);
      const end = new Date(year, mon, 1);
      snapshot = await db
        .collection("sales")
        .where("saleDateTime", ">=", start)
        .where("saleDateTime", "<", end)
        .get();
    } else {
      snapshot = await db.collection("sales").get();
    }

    let bikesSold = 0;
    let revenue = 0;
    snapshot.forEach(doc => {
      const sale = doc.data();
      bikesSold += 1;
      revenue += parseFloat(sale.totalSaleAmount || 0);
    });

    return res.status(200).json({
      success: true,
      month: month || "all",
      bikesSold,
      revenue
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * READ SINGLE
 * GET /api/sale/:id
 */
const getSaleById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection("sales").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Sale record not found" });
    }

    return res.status(200).json({
      success: true,
      data: { id: doc.id, ...doc.data() }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * LOOKUP: Bike-data-by-registration-number lookup for the Sale form.
 * Wraps the purchase lookup so the frontend only talks to one endpoint
 * while building the Sale screen.
 * GET /api/sale/lookup-bike/:registrationNo
 */
const lookupBikeByRegistration = async (req, res) => {
  try {
    const { registrationNo } = req.params;
    const { registrationNo: normalizedRegNo, registrationStatus } = normalizeRegistration(registrationNo);

    if (registrationStatus === "AFR") {
      return res.status(200).json({
        success: true,
        found: false,
        isAfr: true,
        message: "AFR — treat as a new bike, no existing purchase record to match."
      });
    }

    const purchaseSnap = await db
      .collection("purchases")
      .where("registrationNo", "==", normalizedRegNo)
      .limit(1)
      .get();

    if (purchaseSnap.empty) {
      return res.status(200).json({ success: true, found: false });
    }

    const purchaseDoc = purchaseSnap.docs[0];
    const purchase = purchaseDoc.data();

    if (purchase.sold) {
      return res.status(200).json({
        success: true,
        found: true,
        alreadySold: true,
        message: "This bike is already marked as sold in a previous sale record."
      });
    }

    return res.status(200).json({
      success: true,
      found: true,
      alreadySold: false,
      purchaseId: purchaseDoc.id,
      purchaseCategory: purchase.category || "local_customer",
      data: {
        bikeCompany: purchase.bikeCompany || "",
        bikeModel: purchase.bikeModel || "",
        chasisNo: purchase.chasisNo || "",
        engineNo: purchase.engineNo || "",
        registrationNo: purchase.registrationNo || "",
        registrationStatus: purchase.registrationStatus || "registered",
        originalPurchase: {
          purchasedFrom: purchase.customerName || "",
          purchasedFromCnic: purchase.cnicNumber || "",
          purchaseDate: purchase.purchaseDateTime || null
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * UPDATE
 * PUT /api/sale/:id
 */
const updateSale = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const docRef = db.collection("sales").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Sale record not found" });
    }

    if (updateData.totalSaleAmount) updateData.totalSaleAmount = parseFloat(updateData.totalSaleAmount);
    if (updateData.advanceReceived) updateData.advanceReceived = parseFloat(updateData.advanceReceived);
    if (updateData.saleDateTime) updateData.saleDateTime = new Date(updateData.saleDateTime);

    if (updateData.registrationNo !== undefined) {
      const { registrationNo, registrationStatus } = normalizeRegistration(updateData.registrationNo);
      updateData.registrationNo = registrationNo;
      updateData.registrationStatus = registrationStatus;
    }

    if (updateData.addressSameAsPermanent) {
      updateData.buyerPermanentAddress =
        updateData.buyerCurrentAddress || doc.data().buyerCurrentAddress || "";
    }

    updateData.updatedAt = new Date();

    await docRef.update(updateData);

    return res.status(200).json({
      success: true,
      message: "Sale record updated successfully"
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * MARK INSTALLMENT PAID
 * PATCH /api/sale/:id/installments/:monthNumber/pay
 */
const markInstallmentPaid = async (req, res) => {
  try {
    const { id, monthNumber } = req.params;
    const docRef = db.collection("sales").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Sale record not found" });
    }

    const sale = doc.data();
    const installments = sale.installments || [];
    const target = installments.find(i => i.monthNumber === parseInt(monthNumber, 10));

    if (!target) {
      return res.status(404).json({ success: false, message: "Installment not found" });
    }

    target.paid = true;
    target.paidDate = new Date();

    const remaining = installments
      .filter(i => !i.paid)
      .reduce((sum, i) => sum + i.amount, 0);

    await docRef.update({
      installments,
      amountRemaining: remaining,
      updatedAt: new Date()
    });

    return res.status(200).json({ success: true, message: "Installment marked as paid" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE
 * DELETE /api/sale/:id
 */
const deleteSale = async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("sales").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Sale record not found" });
    }

    const sale = doc.data();
    await docRef.delete();

    // Free up the bike again if this sale had claimed a purchase record.
    if (sale.linkedPurchaseId) {
      await db.collection("purchases").doc(sale.linkedPurchaseId).update({
        sold: false,
        soldSaleId: null,
        updatedAt: new Date()
      });
    }

    return res.status(200).json({
      success: true,
      message: "Sale record deleted successfully"
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createSale,
  getAllSales,
  getSaleStats,
  getSaleById,
  lookupBikeByRegistration,
  lookupBikeByChasis,
  lookupBikeByEngine,
  updateSale,
  markInstallmentPaid,
  deleteSale
};