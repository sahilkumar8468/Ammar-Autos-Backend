const { db } = require("../config/firebase");

/**
 * Detects "Applied For Registration" placeholder values.
 * Treats "AFR" (any case/spacing) as: only the letter has been received,
 * the actual number isn't available yet. Used for registrationNo,
 * chasisNo, and engineNo alike — a bike bought before its papers are
 * finalized can have any (or all) of these as "AFR".
 */
const _normalize = (value) => {
  const raw = (value || "").toString().trim();
  if (!raw) return { value: "", status: "unregistered" };
  if (raw.toUpperCase() === "AFR") {
    return { value: "AFR", status: "AFR" };
  }
  return { value: raw, status: "registered" };
};

const normalizeRegistration = (value) => {
  const { value: v, status } = _normalize(value);
  return { registrationNo: v, registrationStatus: status };
};

const normalizeChasis = (value) => {
  const { value: v, status } = _normalize(value);
  return { chasisNo: v, chasisStatus: status };
};

const normalizeEngine = (value) => {
  const { value: v, status } = _normalize(value);
  return { engineNo: v, engineStatus: status };
};

/**
 * CREATE: Record a new purchase
 * POST /api/purchase
 */
const createPurchase = async (req, res) => {
  try {
    const {
      category,
      customerName,
      customerFatherName,
      customerNo,
      purchaseDate,
      currentAddress,
      permanentAddress,
      cnicNumber,
      actualAmount,
      amountRemaining,
      additionalExpense,
      documents,
      // Bike identity fields — needed so Sale can look these up
      bikeCompany,
      bikeModel,
      bikeCC,
      bikeColor,
      chasisNo,
      engineNo,
      registrationNo
    } = req.body;

    if (!category || !["company", "local_customer", "dealer"].includes(category)) {
      return res.status(400).json({
        success: false,
        message: "Valid purchase category (company, local_customer, dealer) is required."
      });
    }

    const { registrationNo: normalizedRegNo, registrationStatus } = normalizeRegistration(registrationNo);
    const { chasisNo: normalizedChasisNo, chasisStatus } = normalizeChasis(chasisNo);
    const { engineNo: normalizedEngineNo, engineStatus } = normalizeEngine(engineNo);

    // If a real (non-AFR) registration number is given, it must be unique across purchases
    if (registrationStatus === "registered") {
      const existing = await db
        .collection("purchases")
        .where("registrationNo", "==", normalizedRegNo)
        .limit(1)
        .get();
      if (!existing.empty) {
        return res.status(409).json({
          success: false,
          message: `A purchase with registration number "${normalizedRegNo}" already exists.`
        });
      }
    }

    const purchaseData = {
      category,
      customerName: customerName || "",
      customerFatherName: customerFatherName || "",
      customerNo: customerNo || "",
      purchaseDateTime: purchaseDate ? new Date(purchaseDate) : new Date(),
      currentAddress: currentAddress || "",
      permanentAddress: permanentAddress || "",
      cnicNumber: cnicNumber || "",
      actualAmount: parseFloat(actualAmount || 0),
      amountRemaining: parseFloat(amountRemaining || 0),
      additionalExpense: parseFloat(additionalExpense || 0),
      documents: Array.isArray(documents) ? documents : [],
      bikeCompany: bikeCompany || "",
      bikeModel: bikeModel || "",
      bikeCC: bikeCC || "",
      bikeColor:bikeColor || "",
      chasisNo: normalizedChasisNo,
      chasisStatus, // "registered" | "AFR" | "unregistered"
      engineNo: normalizedEngineNo,
      engineStatus, // "registered" | "AFR" | "unregistered"
      registrationNo: normalizedRegNo,
      registrationStatus, // "registered" | "AFR" | "unregistered"
      sold: false, // flips to true once a Sale record is created against this bike
      approved: false, // flips to true once the registration/AFR letter is received
      approvedAt: null,
      buyer: "Showroom Owner",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await db.collection("purchases").add(purchaseData);

    return res.status(201).json({
      success: true,
      message: `${category.replace("_", " ")} purchase created successfully`,
      id: docRef.id,
      data: purchaseData
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * READ ALL: Fetch purchases (Optional filter by category via query string)
 * GET /api/purchase?category=local_customer
 */
const getAllPurchases = async (req, res) => {
  try {
    const { category, page = "1", limit = "10", engineNo, chasisNo, customerName } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    let collectionRef = db.collection("purchases");

    if (category && ["company", "local_customer", "dealer"].includes(category)) {
      collectionRef = collectionRef.where("category", "==", category);
    }

    const snapshot = await collectionRef.orderBy("createdAt", "desc").get();
    const allPurchases = [];
    snapshot.forEach(doc => {
      allPurchases.push({ id: doc.id, ...doc.data() });
    });

    // Apply filters if provided (case‑insensitive contains)
    let filtered = allPurchases;
    if (engineNo) {
      const term = engineNo.toString().toLowerCase();
      filtered = filtered.filter(p => (p.engineNo || "").toString().toLowerCase().includes(term));
    }
    if (chasisNo) {
      const term = chasisNo.toString().toLowerCase();
      filtered = filtered.filter(p => (p.chasisNo || "").toString().toLowerCase().includes(term));
    }
    if (customerName) {
      const term = customerName.toString().toLowerCase();
      filtered = filtered.filter(p => (p.customerName || "").toString().toLowerCase().includes(term));
    }

    const totalCount = filtered.length;
    const startIdx = (pageNum - 1) * limitNum;
    const paged = filtered.slice(startIdx, startIdx + limitNum);

    return res.status(200).json({
      success: true,
      count: paged.length,
      totalCount,
      page: pageNum,
      limit: limitNum,
      data: paged
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * READ SINGLE: Fetch one entry by document ID
 * GET /api/purchase/:id
 */
const getPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection("purchases").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Purchase record not found" });
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
 * LOOKUP: Fetch a purchase by registration number (used by the Sale form
 * to auto-fill bike details when staff types a plate number that the
 * showroom already owns).
 * GET /api/purchase/lookup/:registrationNo
 */
const lookupPurchaseByRegistration = async (req, res) => {
  try {
    const { registrationNo } = req.params;
    const { registrationNo: normalizedRegNo, registrationStatus } = normalizeRegistration(registrationNo);

    if (registrationStatus === "AFR") {
      return res.status(200).json({
        success: true,
        found: false,
        isAfr: true,
        message: "AFR entries are not looked up — treat as a new, unregistered bike."
      });
    }

    const snapshot = await db
      .collection("purchases")
      .where("registrationNo", "==", normalizedRegNo)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ success: true, found: false });
    }

    const doc = snapshot.docs[0];
    return res.status(200).json({
      success: true,
      found: true,
      data: { id: doc.id, ...doc.data() }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * UPDATE: Modify existing entry fields or update documents array
 * PUT /api/purchase/:id
 */
const updatePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const docRef = db.collection("purchases").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Purchase record not found" });
    }

    if (updateData.actualAmount) updateData.actualAmount = parseFloat(updateData.actualAmount);
    if (updateData.amountRemaining) updateData.amountRemaining = parseFloat(updateData.amountRemaining);
    if (updateData.additionalExpense) updateData.additionalExpense = parseFloat(updateData.additionalExpense);
    if (updateData.purchaseDate) updateData.purchaseDateTime = new Date(updateData.purchaseDate);

    if (updateData.registrationNo !== undefined) {
      const { registrationNo, registrationStatus } = normalizeRegistration(updateData.registrationNo);
      updateData.registrationNo = registrationNo;
      updateData.registrationStatus = registrationStatus;
    }
    if (updateData.chasisNo !== undefined) {
      const { chasisNo, chasisStatus } = normalizeChasis(updateData.chasisNo);
      updateData.chasisNo = chasisNo;
      updateData.chasisStatus = chasisStatus;
    }
    if (updateData.engineNo !== undefined) {
      const { engineNo, engineStatus } = normalizeEngine(updateData.engineNo);
      updateData.engineNo = engineNo;
      updateData.engineStatus = engineStatus;
    }

    updateData.updatedAt = new Date();

    await docRef.update(updateData);

    return res.status(200).json({
      success: true,
      message: "Purchase record updated successfully"
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * APPROVE: Mark that the registration/AFR letter has been received for
 * this purchase's bike. Frontend flips the row from "light red" to a
 * green tick once this succeeds.
 * PATCH /api/purchase/:id/approve
 */
const approvePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("purchases").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Purchase record not found" });
    }

    if (doc.data().approved) {
      return res.status(200).json({ success: true, message: "Already approved", data: { id, ...doc.data() } });
    }

    const approvedAt = new Date();
    await docRef.update({ approved: true, approvedAt, updatedAt: approvedAt });

    return res.status(200).json({
      success: true,
      message: "Purchase approved — letter received.",
      data: { id, ...doc.data(), approved: true, approvedAt }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * DELETE: Erase document from Firestore
 * DELETE /api/purchase/:id
 */
const deletePurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("purchases").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Purchase record not found" });
    }

    await docRef.delete();

    return res.status(200).json({
      success: true,
      message: "Purchase record deleted successfully"
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createPurchase,
  getAllPurchases,
  getPurchaseById,
  lookupPurchaseByRegistration,
  updatePurchase,
  approvePurchase,
  deletePurchase,
  normalizeRegistration,
  normalizeChasis,
  normalizeEngine
};