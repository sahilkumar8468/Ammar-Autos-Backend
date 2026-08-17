const { getEarningStats } = require("../controllers/earning.controller");

// GET /api/reports/earning - Profit & Earning analytics
router.get("/earning", getEarningStats);

// GET /api/reports - Comprehensive analytics
router.get("/", async (req, res) => {
  try {
    const { period, year, month, search } = req.query;

    const [purchasesSnap, salesSnap, regSnap] = await Promise.all([
      db.collection("purchases").get(),
      db.collection("sales").get(),
      db.collection("registrations").get(),
    ]);

    const purchases = purchasesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const sales = salesSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const registrations = regSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Scenario 1: Sales Revenue Report
    const totalSalesValue = sales.reduce(
      (sum, s) => sum + Number(s.totalSaleAmount || 0),
      0
    );

    const totalAdvanceReceived = sales.reduce(
      (sum, s) => sum + Number(s.advanceReceived || 0),
      0
    );

    const totalInstallmentsReceived = sales.reduce(
      (sum, s) => sum + Number(s.paidInstallments || 0),
      0
    );

    // Scenario 2: Purchase Cost Report
    const totalPurchaseCost = purchases.reduce(
      (sum, p) => sum + Number(p.actualAmount || 0),
      0
    );

    const totalPurchaseRemaining = purchases.reduce(
      (sum, p) => sum + Number(p.amountRemaining || 0),
      0
    );

    // Scenario 3: Installment Outstanding Report
    const installmentSales = sales.filter(
      (s) => (s.saleType || "").toLowerCase() === "installment"
    );

    const totalInstallmentExpected = installmentSales.reduce(
      (sum, s) =>
        sum +
        (Number(s.totalSaleAmount || 0) -
          Number(s.advanceReceived || 0)),
      0
    );

    const totalInstallmentPending =
      totalInstallmentExpected - totalInstallmentsReceived;

    // Scenario 4: Registration Papers Status Report
    const totalRegistrations = registrations.length;

    const completedPapers = registrations.filter(
      (r) => r.paperReceived === true
    ).length;

    const pendingPapers = totalRegistrations - completedPapers;

    return res.json({
      success: true,
      summary: {
        totalSalesValue,
        totalAdvanceReceived,
        totalInstallmentsReceived,
        totalPurchaseCost,
        totalPurchaseRemaining,
        totalInstallmentPending,
        totalRegistrations,
        completedPapers,
        pendingPapers,
      },
      data: {
        purchases,
        sales,
        registrations,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;