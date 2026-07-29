const { db } = require("../config/firebase");

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const toDate = (value) => (value?.toDate ? value.toDate() : new Date(value));

/**
 * GET /api/sale/reminders
 * Scans every installment sale and returns:
 *  - upcoming: due within the next 7 days, not yet paid
 *  - overdue: due date has passed, not yet paid (fires once per day per sale)
 * The frontend can poll this (e.g. on app load / every few hours) to
 * render a notifications bell without needing push infra.
 */
const getDueReminders = async (req, res) => {
  try {
    const snapshot = await db.collection("sales").where("saleType", "==", "installment").get();

    const today = new Date();
    const upcoming = [];
    const overdue = [];

    snapshot.forEach(doc => {
      const sale = doc.data();
      (sale.installments || []).forEach(installment => {
        if (installment.paid) return;

        const dueDate = toDate(installment.dueDate);
        const daysUntilDue = Math.ceil((dueDate - today) / MS_PER_DAY);

        const base = {
          saleId: doc.id,
          buyerName: sale.buyerName,
          buyerCnic: sale.buyerCnic,
          registrationNo: sale.registrationNo,
          monthNumber: installment.monthNumber,
          amount: installment.amount,
          dueDate
        };

        if (daysUntilDue > 0 && daysUntilDue <= 7) {
          upcoming.push({ ...base, daysUntilDue });
        } else if (daysUntilDue <= 0) {
          overdue.push({ ...base, daysOverdue: Math.abs(daysUntilDue) });
        }
      });
    });

    return res.status(200).json({
      success: true,
      upcomingCount: upcoming.length,
      overdueCount: overdue.length,
      upcoming,
      overdue
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getDueReminders };