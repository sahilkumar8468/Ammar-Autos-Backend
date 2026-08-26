const { db } = require("../config/firebase");
const { normalizeRegistration, normalizeChasis, normalizeEngine } = require("./purchase.controller");
const { getFreshCached, setCached, handleControllerError } = require("../utils/apiCache");

const normalizeKey = (str) => {
  if (!str) return "";
  const cleaned = str.toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned === "AFR" || !cleaned) return "";
  return cleaned;
};

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

    const unsoldSnap = await db
      .collection("purchases")
      .where("chasisNo", "==", normalizedChasisNo)
      .where("sold", "==", false)
      .limit(1)
      .get();

    let purchaseDoc = null;
    let isSold = false;

    if (!unsoldSnap.empty) {
      purchaseDoc = unsoldSnap.docs[0];
      isSold = false;
    } else {
      const anySnap = await db
        .collection("purchases")
        .where("chasisNo", "==", normalizedChasisNo)
        .limit(1)
        .get();

      if (anySnap.empty) {
        return res.status(200).json({ success: true, found: false });
      }
      purchaseDoc = anySnap.docs[0];
      isSold = true;
    }

    const purchase = purchaseDoc.data();

    if (isSold || purchase.sold) {
      return res.status(200).json({
        success: true,
        found: true,
        alreadySold: true,
        message: "This bike is already marked as sold in a previous sale record. Please use Return / Buy Back first."
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

    const unsoldSnap = await db
      .collection("purchases")
      .where("engineNo", "==", normalizedEngineNo)
      .where("sold", "==", false)
      .limit(1)
      .get();

    let purchaseDoc = null;
    let isSold = false;

    if (!unsoldSnap.empty) {
      purchaseDoc = unsoldSnap.docs[0];
      isSold = false;
    } else {
      const anySnap = await db
        .collection("purchases")
        .where("engineNo", "==", normalizedEngineNo)
        .limit(1)
        .get();

      if (anySnap.empty) {
        return res.status(200).json({ success: true, found: false });
      }
      purchaseDoc = anySnap.docs[0];
      isSold = true;
    }

    const purchase = purchaseDoc.data();

    if (isSold || purchase.sold) {
      return res.status(200).json({
        success: true,
        found: true,
        alreadySold: true,
        message: "This bike is already marked as sold in a previous sale record. Please use Return / Buy Back first."
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


const buildInstallmentSchedule = (
  startDate,
  months,
  perMonthAmount,
  hasInitialGracePayment = false,
  initialGraceAmount = 0,
  initialGraceDueDate = null,
  initialGraceDescription = ""
) => {
  const schedule = [];
  let monthOffset = 0;

  if (hasInitialGracePayment && parseFloat(initialGraceAmount) > 0) {
    const graceDate = initialGraceDueDate ? new Date(initialGraceDueDate) : new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    schedule.push({
      monthNumber: 1,
      dueDate: graceDate,
      amount: parseFloat(initialGraceAmount || 0),
      description: initialGraceDescription || "Initial / Grace Payment (10 Days)",
      paid: false,
      paidDate: null,
      upcomingReminderSent: false,
      lastOverdueReminderDate: null
    });
    monthOffset = 1;
  }

  const start = startDate ? new Date(startDate) : new Date();

  for (let i = 1; i <= months; i++) {
    const dueDate = new Date(start);
    dueDate.setMonth(dueDate.getMonth() + (i - 1));

    schedule.push({
      monthNumber: i + monthOffset,
      dueDate,
      amount: parseFloat(perMonthAmount || 0),
      description: `Installment #${i}`,
      paid: false,
      paidDate: null,
      upcomingReminderSent: false,
      lastOverdueReminderDate: null
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
      installmentStartDate,
      installmentDescription,
      hasInitialGracePayment,
      initialGraceAmount,
      initialGraceDueDate,
      initialGraceDescription,
      installments: customInstallments
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

    // Check if the bike is available for sale (must have an active unsold purchase or be a valid new entry)
    if (linkedPurchaseId) {
      const pDoc = await db.collection("purchases").doc(linkedPurchaseId).get();
      if (!pDoc.exists || pDoc.data().sold) {
        return res.status(409).json({
          success: false,
          message: "This bike purchase record is already marked as sold."
        });
      }
    } else if (registrationStatus === "registered") {
      const unsoldSnap = await db
        .collection("purchases")
        .where("registrationNo", "==", normalizedRegNo)
        .where("sold", "==", false)
        .limit(1)
        .get();
      if (unsoldSnap.empty) {
        const anySnap = await db
          .collection("purchases")
          .where("registrationNo", "==", normalizedRegNo)
          .limit(1)
          .get();
        if (!anySnap.empty) {
          return res.status(409).json({
            success: false,
            message: `This bike (${normalizedRegNo}) is already marked as sold. Record a Return / Buy Back purchase first.`
          });
        }
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

      if (Array.isArray(customInstallments) && customInstallments.length > 0) {
        installments = customInstallments.map((inst, idx) => ({
          monthNumber: inst.monthNumber || idx + 1,
          dueDate: inst.dueDate ? new Date(inst.dueDate) : new Date(),
          amount: parseFloat(inst.amount || 0),
          description: inst.description || inst.notes || `Installment #${idx + 1}`,
          paid: !!inst.paid,
          paidDate: inst.paidDate ? new Date(inst.paidDate) : null,
          upcomingReminderSent: !!inst.upcomingReminderSent,
          lastOverdueReminderDate: inst.lastOverdueReminderDate ? new Date(inst.lastOverdueReminderDate) : null
        }));
      } else {
        if (!months || !perMonth) {
          return res.status(400).json({
            success: false,
            message: "installmentMonths and perMonthInstallment are required for installment sales."
          });
        }

        installments = buildInstallmentSchedule(
          installmentStartDate,
          months,
          perMonth,
          hasInitialGracePayment,
          initialGraceAmount,
          initialGraceDueDate,
          initialGraceDescription
        );
      }
    }

    // For cash sales, everything is paid upfront — nothing remaining.
    // For installment sales, remaining = total - advance.
    const amountRemaining = saleType === "cash" ? 0 : Math.max(total - advance, 0);

    const saleData = {
      category,

      buyerName,
      buyerFatherName: buyerFatherName || "",
      buyerCurrentAddress: buyerCurrentAddress || "",
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
      installmentDescription: installmentDescription || "",
      hasInitialGracePayment: !!hasInitialGracePayment,
      initialGraceAmount: parseFloat(initialGraceAmount || 0),
      initialGraceDueDate: initialGraceDueDate ? new Date(initialGraceDueDate) : null,
      initialGraceDescription: initialGraceDescription || "",
      installments,

      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await db.collection("sales").add(saleData);

    let targetPurchaseId = linkedPurchaseId;
    if (!targetPurchaseId) {
      if (registrationStatus === "registered" && normalizedRegNo) {
        const pSnap = await db.collection("purchases").where("registrationNo", "==", normalizedRegNo).limit(1).get();
        if (!pSnap.empty && !pSnap.docs[0].data().sold) targetPurchaseId = pSnap.docs[0].id;
      }
      if (!targetPurchaseId && chasisNo && normalizeKey(chasisNo)) {
        const pSnap = await db.collection("purchases").where("chasisNo", "==", chasisNo).limit(1).get();
        if (!pSnap.empty && !pSnap.docs[0].data().sold) targetPurchaseId = pSnap.docs[0].id;
      }
      if (!targetPurchaseId && engineNo && normalizeKey(engineNo)) {
        const pSnap = await db.collection("purchases").where("engineNo", "==", engineNo).limit(1).get();
        if (!pSnap.empty && !pSnap.docs[0].data().sold) targetPurchaseId = pSnap.docs[0].id;
      }
    }

    // Mark the source purchase as sold, if this sale was linked to one.
    if (targetPurchaseId) {
      await db.collection("purchases").doc(targetPurchaseId).update({
        sold: true,
        soldSaleId: docRef.id,
        updatedAt: new Date()
      }).catch(() => {});

      if (!linkedPurchaseId) {
        await docRef.update({ linkedPurchaseId: targetPurchaseId }).catch(() => {});
        saleData.linkedPurchaseId = targetPurchaseId;
      }
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
 * READ ALL: Fetch sales, with optional category, month, and search filters.
 * GET /api/sale?category=local_customer&month=2026-07&search=LEA-1234
 */
const getAllSales = async (req, res) => {
  const { category, month, search, page: pageStr, limit: limitStr } = req.query;
  const cacheKey = `all_sales_${category || "all"}_${month || "all"}_${search || ""}_${pageStr || 1}_${limitStr || 50}`;
  const cached = getFreshCached(cacheKey, 30000);
  if (cached) return res.status(200).json(cached);

  try {
    let query = db.collection("sales");

    if (category && SALE_CATEGORIES.includes(category)) {
      query = query.where("category", "==", category);
    }

    const snapshot = await query.get();

    let sales = [];
    snapshot.forEach(doc => {
      sales.push({ id: doc.id, ...doc.data() });
    });

    // In-memory month filter to prevent Firestore missing composite index 500 errors
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      sales = sales.filter(s => {
        const d = parseDate(s.saleDateTime || s.createdAt);
        if (!d) return false;
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        return m === month;
      });
    }

    // Sort in JS (newest first)
    sales.sort((a, b) => {
      const dateA = parseDate(a.saleDateTime || a.createdAt) || new Date(0);
      const dateB = parseDate(b.saleDateTime || b.createdAt) || new Date(0);
      return dateB - dateA;
    });

    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      sales = sales.filter(sale =>
        (sale.registrationNo || "").toLowerCase().includes(term) ||
        (sale.chasisNo || "").toLowerCase().includes(term) ||
        (sale.engineNo || "").toLowerCase().includes(term) ||
        (sale.buyerCnic || "").toLowerCase().includes(term) ||
        (sale.buyerName || "").toLowerCase().includes(term) ||
        (sale.bikeCompany || "").toLowerCase().includes(term) ||
        (sale.bikeModel || "").toLowerCase().includes(term)
      );
    }

    const totalCount = sales.length;

    let paged = sales;
    if (pageStr || limitStr) {
      const page = Math.max(1, parseInt(pageStr) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(limitStr) || 50));
      const start = (page - 1) * limit;
      paged = sales.slice(start, start + limit);
    }

    const payload = {
      success: true,
      count: paged.length,
      totalCount,
      data: paged
    };

    setCached(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (error) {
    return handleControllerError(error, res, { success: true, count: 0, totalCount: 0, data: [] });
  }
};

/**
 * STATS: Bikes sold + revenue for a given month (defaults to all/current month).
 * GET /api/sale/stats?month=2026-07
 */
const getSaleStats = async (req, res) => {
  const { month, category } = req.query;
  const cacheKey = `sale_stats_${month || "all"}_${category || "all"}`;
  const cached = getFreshCached(cacheKey, 30000);
  if (cached) return res.status(200).json(cached);

  try {
    let collectionRef = db.collection("sales");
    if (category && SALE_CATEGORIES.includes(category)) {
      collectionRef = collectionRef.where("category", "==", category);
    }

    const snapshot = await collectionRef.get();

    let bikesSold = 0;
    let revenue = 0;
    snapshot.forEach(doc => {
      const sale = doc.data();
      let matchMonth = true;

      if (month && /^\d{4}-\d{2}$/.test(month)) {
        const d = parseDate(sale.saleDateTime || sale.createdAt);
        if (!d) {
          matchMonth = false;
        } else {
          const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          if (m !== month) matchMonth = false;
        }
      }

      if (matchMonth) {
        bikesSold += 1;
        revenue += parseFloat(sale.totalSaleAmount || 0);
      }
    });

    const payload = {
      success: true,
      month: month || "all",
      bikesSold,
      revenue
    };

    setCached(cacheKey, payload);
    return res.status(200).json(payload);
  } catch (error) {
    return handleControllerError(error, res, { success: true, month: month || "all", bikesSold: 0, revenue: 0 });
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

    const unsoldSnap = await db
      .collection("purchases")
      .where("registrationNo", "==", normalizedRegNo)
      .where("sold", "==", false)
      .limit(1)
      .get();

    let purchaseDoc = null;
    let isSold = false;

    if (!unsoldSnap.empty) {
      purchaseDoc = unsoldSnap.docs[0];
      isSold = false;
    } else {
      const anySnap = await db
        .collection("purchases")
        .where("registrationNo", "==", normalizedRegNo)
        .limit(1)
        .get();

      if (anySnap.empty) {
        return res.status(200).json({ success: true, found: false });
      }
      purchaseDoc = anySnap.docs[0];
      isSold = true;
    }

    const purchase = purchaseDoc.data();

    if (isSold || purchase.sold) {
      return res.status(200).json({
        success: true,
        found: true,
        alreadySold: true,
        message: "This bike is already marked as sold in a previous sale record. Please use Return / Buy Back first."
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
 * Recursively converts date strings or serialized Firestore timestamps ({ _seconds, _nanoseconds })
 * into standard JavaScript Date objects for Firestore storage.
 */
const sanitizeTimestamps = (data) => {
  if (data === null || data === undefined) return data;

  if (data instanceof Date) return data;

  if (
    typeof data === "object" &&
    ((typeof data._seconds === "number" && typeof data._nanoseconds === "number") ||
     (typeof data.seconds === "number" && typeof data.nanoseconds === "number"))
  ) {
    const secs = data._seconds !== undefined ? data._seconds : data.seconds;
    return new Date(secs * 1000);
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeTimestamps(item));
  }

  if (typeof data === "object") {
    const result = {};
    const dateKeys = new Set([
      "saleDateTime",
      "installmentStartDate",
      "initialGraceDueDate",
      "dueDate",
      "paidDate",
      "lastOverdueReminderDate",
      "createdAt",
      "updatedAt",
      "purchaseDate",
      "purchaseDateTime"
    ]);

    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        result[key] = value;
      } else if (dateKeys.has(key)) {
        if (value instanceof Date) {
          result[key] = value;
        } else if (typeof value === "string") {
          const d = new Date(value);
          result[key] = isNaN(d.getTime()) ? null : d;
        } else if (typeof value === "object") {
          const sanitized = sanitizeTimestamps(value);
          result[key] = sanitized instanceof Date ? sanitized : null;
        } else {
          result[key] = value;
        }
      } else if (typeof value === "object") {
        result[key] = sanitizeTimestamps(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return data;
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

    if (updateData.totalSaleAmount !== undefined) updateData.totalSaleAmount = parseFloat(updateData.totalSaleAmount) || 0;
    if (updateData.advanceReceived !== undefined) updateData.advanceReceived = parseFloat(updateData.advanceReceived) || 0;

    // Recalculate amountRemaining whenever totalSaleAmount, advanceReceived, or saleType change
    if (updateData.totalSaleAmount !== undefined || updateData.advanceReceived !== undefined || updateData.saleType !== undefined) {
      const saleType = updateData.saleType !== undefined ? updateData.saleType : (doc.data().saleType || "cash");
      if (saleType === "cash") {
        updateData.amountRemaining = 0;
      } else {
        const total = updateData.totalSaleAmount !== undefined ? updateData.totalSaleAmount : (doc.data().totalSaleAmount || 0);
        const advance = updateData.advanceReceived !== undefined ? updateData.advanceReceived : (doc.data().advanceReceived || 0);
        updateData.amountRemaining = Math.max(total - advance, 0);
      }
    }

    // Clean up empty strings → null for fields that should be numbers/dates or null
    ["installmentMonths", "perMonthInstallment", "installmentStartDate"].forEach((field) => {
      if (updateData[field] === "" || updateData[field] === undefined) {
        // If saleType is being changed to cash, clear these fields
        if (updateData.saleType === "cash") {
          updateData[field] = null;
        } else if (updateData[field] === "") {
          // Don't overwrite with empty string — just remove the key so Firestore keeps existing value
          delete updateData[field];
        }
      }
    });

    // If switching to cash, clear installments
    if (updateData.saleType === "cash") {
      updateData.installments = [];
    }

    const sanitized = sanitizeTimestamps(updateData);

    // Convert any sanitized Date fields back to the updateData (preserving the reference)
    for (const key of Object.keys(sanitized)) {
      updateData[key] = sanitized[key];
    }

    if (updateData.registrationNo !== undefined) {
      const { registrationNo, registrationStatus } = normalizeRegistration(updateData.registrationNo);
      updateData.registrationNo = registrationNo;
      updateData.registrationStatus = registrationStatus;
    }

    if (updateData.addressSameAsPermanent) {
      updateData.buyerPermanentAddress =
        updateData.buyerCurrentAddress || doc.data().buyerCurrentAddress || "";
    }

    if (updateData.linkedPurchaseId !== undefined && updateData.linkedPurchaseId !== doc.data().linkedPurchaseId) {
      if (doc.data().linkedPurchaseId) {
        await db.collection("purchases").doc(doc.data().linkedPurchaseId).update({
          sold: false,
          soldSaleId: null,
          updatedAt: new Date()
        }).catch(() => {});
      }
      if (updateData.linkedPurchaseId) {
        await db.collection("purchases").doc(updateData.linkedPurchaseId).update({
          sold: true,
          soldSaleId: id,
          updatedAt: new Date()
        }).catch(() => {});
      }
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
      }).catch(() => {});
    }

    const linkedSnap = await db.collection("purchases").where("soldSaleId", "==", id).get();
    for (const pDoc of linkedSnap.docs) {
      await pDoc.ref.update({
        sold: false,
        soldSaleId: null,
        updatedAt: new Date()
      }).catch(() => {});
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