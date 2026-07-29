const express = require("express");
const router = express.Router();
const { db } = require("../config/firebase");

// GET /api/customer - Returns only installment buyers with overdue/upcoming calculations
router.get("/", async (req, res) => {
  try {
    const salesSnap = await db.collection("sales").where("saleType", "==", "installment").get();

    const currentDate = new Date();
    let customers = [];

    salesSnap.docs.forEach((doc) => {
      const d = doc.data();
      if (!d.buyerName) return;

      let isOverdue = false;
      let overdueMonths = 0;
      let monthsPassed = 0;
      let daysUntilNextDue = null;

      if (d.installmentStartDate) {
        const startDate = new Date(d.installmentStartDate);
        monthsPassed = (currentDate.getFullYear() - startDate.getFullYear()) * 12
          + (currentDate.getMonth() - startDate.getMonth());
        if (monthsPassed < 0) monthsPassed = 0;

        const paidCount = d.perMonthInstallment > 0
          ? Math.floor(Number(d.paidInstallments || 0) / Number(d.perMonthInstallment))
          : 0;

        if (monthsPassed > paidCount) {
          isOverdue = true;
          overdueMonths = monthsPassed - paidCount;
        }

        // Calculate next due date (start + paidCount + 1 month)
        const nextDueDate = new Date(startDate);
        nextDueDate.setMonth(nextDueDate.getMonth() + paidCount + 1);
        const msPerDay = 1000 * 60 * 60 * 24;
        daysUntilNextDue = Math.floor((nextDueDate - currentDate) / msPerDay);
      }

      const totalSaleAmount = Number(d.totalSaleAmount || 0);
      const advance = Number(d.advanceReceived || 0);
      const paid = Number(d.paidInstallments || 0);
      const remaining = Math.max(0, totalSaleAmount - advance - paid);

      customers.push({
        id: doc.id,
        // Basic
        name: d.buyerName,
        buyerName: d.buyerName,
        buyerFatherName: d.buyerFatherName || "",
        buyerCnic: d.buyerCnic || "",
        buyerCurrentAddress: d.buyerCurrentAddress || "",
        buyerPermanentAddress: d.buyerPermanentAddress || "",
        cnic: d.buyerCnic || "—",
        phone: d.salerNumber || "—",
        // Saler
        salerName: d.salerName || "",
        salerNumber: d.salerNumber || "",
        salerCnic: d.salerCnic || "",
        salerAddress: d.salerAddress || "",
        // Bike
        bike: [d.bikeCompany, d.bikeModel].filter(Boolean).join(" ") || "—",
        bikeCompany: d.bikeCompany || "",
        bikeModel: d.bikeModel || "",
        chasisNo: d.chasisNo || "—",
        engineNo: d.engineNo || "—",
        registrationNo: d.registrationNo || "—",
        registrationStatus: d.registrationStatus || "",
        // Financials
        totalSaleAmount,
        advanceReceived: advance,
        paidInstallments: paid,
        remainingBalance: remaining,
        saleType: "installment",
        installmentMonths: Number(d.installmentMonths || 0),
        perMonthInstallment: Number(d.perMonthInstallment || 0),
        installmentStartDate: d.installmentStartDate || null,
        installmentHistory: d.installmentHistory || [],
        // Overdue / upcoming
        isOverdue,
        overdueMonths,
        monthsPassed,
        daysUntilNextDue,
        isSale: true,
        saleDateTime: d.saleDateTime || null,
      });
    });

    return res.json({ success: true, data: customers });
  } catch (error) {
    console.error("Customer route error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/customer/pay-installment
router.post("/pay-installment", async (req, res) => {
  try {
    const { saleId, amountPaid, paymentDate, notes } = req.body;

    const docRef = db.collection("sales").doc(saleId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "Sale record not found" });
    }

    const data = doc.data();
    const currentPaid = Number(data.paidInstallments || 0);
    const newPaid = currentPaid + Number(amountPaid);

    const history = data.installmentHistory || [];
    history.push({
      amount: Number(amountPaid),
      date: paymentDate || new Date().toISOString(),
      notes: notes || "Monthly installment paid",
      timestamp: new Date(),
    });

    await docRef.update({
      paidInstallments: newPaid,
      installmentHistory: history,
      updatedAt: new Date(),
    });

    return res.json({ success: true, message: "Installment payment recorded", paidInstallments: newPaid });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;