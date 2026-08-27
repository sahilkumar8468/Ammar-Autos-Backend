const { db } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");

/**
 * BATCH SYNC ENDPOINT: Receives offline local records and writes them in 1 bulk Firestore Batch Write
 * POST /api/sync/batch
 */
const batchSync = async (req, res) => {
  try {
    const { sales = [], expenses = [], purchases = [] } = req.body;

    const totalRecords = sales.length + expenses.length + purchases.length;

    if (totalRecords === 0) {
      return res.status(200).json({
        success: true,
        message: "No unsynced records received.",
        syncedCount: 0,
      });
    }

    const batch = db.batch();
    const statsRef = db.collection("metadata").doc("dashboard_stats");

    let totalExpenseAmountAdded = 0;
    let totalSalesAmountAdded = 0;

    // Process Sales Batch
    sales.forEach((sale) => {
      const docRef = sale.firestoreId
        ? db.collection("sales").doc(sale.firestoreId)
        : db.collection("sales").doc();

      const { id, localId, isSynced, ...saleData } = sale;

      batch.set(
        docRef,
        {
          ...saleData,
          updatedAt: FieldValue.serverTimestamp(),
          syncedFromLocalAt: new Date(),
        },
        { merge: true }
      );

      if (saleData.totalSaleAmount) {
        totalSalesAmountAdded += parseFloat(saleData.totalSaleAmount) || 0;
      }
    });

    // Process Expenses Batch
    expenses.forEach((expense) => {
      const docRef = expense.firestoreId
        ? db.collection("expenses").doc(expense.firestoreId)
        : db.collection("expenses").doc();

      const { id, localId, isSynced, ...expenseData } = expense;

      batch.set(
        docRef,
        {
          ...expenseData,
          updatedAt: FieldValue.serverTimestamp(),
          syncedFromLocalAt: new Date(),
        },
        { merge: true }
      );

      if (expenseData.amount) {
        totalExpenseAmountAdded += parseFloat(expenseData.amount) || 0;
      }
    });

    // Process Purchases Batch
    purchases.forEach((purchase) => {
      const docRef = purchase.firestoreId
        ? db.collection("purchases").doc(purchase.firestoreId)
        : db.collection("purchases").doc();

      const { id, localId, isSynced, ...purchaseData } = purchase;

      batch.set(
        docRef,
        {
          ...purchaseData,
          updatedAt: FieldValue.serverTimestamp(),
          syncedFromLocalAt: new Date(),
        },
        { merge: true }
      );
    });

    // Method 1: Update Summary Document in the exact same batch!
    batch.set(
      statsRef,
      {
        totalSalesAmount: FieldValue.increment(totalSalesAmountAdded),
        totalExpensesAmount: FieldValue.increment(totalExpenseAmountAdded),
        totalSalesCount: FieldValue.increment(sales.length),
        totalExpensesCount: FieldValue.increment(expenses.length),
        totalPurchasesCount: FieldValue.increment(purchases.length),
        lastSyncTimestamp: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    // Commit single batch (1 Write Request for all records!)
    await batch.commit();

    return res.status(200).json({
      success: true,
      message: `Successfully synced ${totalRecords} records to Firestore Cloud in 1 batch write!`,
      syncedCount: totalRecords,
    });
  } catch (error) {
    console.error("Batch sync server error:", error);
    return res.status(500).json({
      success: false,
      message: "Server batch sync failed.",
      error: error.message,
    });
  }
};

module.exports = {
  batchSync,
};
