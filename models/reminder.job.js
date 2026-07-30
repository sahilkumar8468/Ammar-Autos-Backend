/**
 * Daily installment-reminder job.
 *
 * Behavior (matches the requested rule):
 *  - 7 days before an installment's due date: send ONE "upcoming" reminder.
 *  - Once the due date has passed and the installment is still unpaid:
 *    send ONE reminder per day until it's marked paid.
 *
 * Install: npm install node-cron
 * Wire up in server.js:
 *    require("./jobs/reminder.job");
 *
 * Notification delivery is stubbed via sendNotification() below — plug in
 * FCM (push), email (nodemailer), or SMS there. Keeping delivery separate
 * from the scheduling/state logic means you can swap channels without
 * touching the due-date math.
 */
const cron = require("node-cron");
const { db } = require("../config/firebase");

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const toDate = (value) => (value?.toDate ? value.toDate() : new Date(value));
const isSameDay = (a, b) =>
  a && new Date(a).toDateString() === new Date(b).toDateString();

// TODO: replace with real delivery (Firebase Cloud Messaging, email, SMS...)
const sendNotification = async ({ type, sale, installment }) => {
  console.log(
    `[reminder:${type}] ${sale.buyerName} (${sale.registrationNo}) — ` +
      `installment #${installment.monthNumber}, Rs. ${installment.amount}, due ${toDate(installment.dueDate).toDateString()}`
  );
  // e.g. await admin.messaging().send({...})
};

const runReminderSweep = async () => {
  const today = new Date();
  const snapshot = await db.collection("sales").where("saleType", "==", "installment").get();

  for (const doc of snapshot.docs) {
    const sale = doc.data();
    let changed = false;
    const installments = sale.installments || [];

    for (const installment of installments) {
      if (installment.paid) continue;

      const dueDate = toDate(installment.dueDate);
      const daysUntilDue = Math.ceil((dueDate - today) / MS_PER_DAY);

      // One-time reminder, ~7 days out
      if (daysUntilDue <= 7 && daysUntilDue >= 0 && !installment.upcomingReminderSent) {
        await sendNotification({ type: "upcoming", sale, installment });
        installment.upcomingReminderSent = true;
        changed = true;
      }

      // Daily reminder once overdue, throttled to once per calendar day
      if (daysUntilDue < 0 && !isSameDay(installment.lastOverdueReminderDate, today)) {
        await sendNotification({ type: "overdue", sale, installment });
        installment.lastOverdueReminderDate = today;
        changed = true;
      }
    }

    if (changed) {
      await doc.ref.update({ installments, updatedAt: new Date() });
    }
  }
};

// Runs every day at 9:00 AM server time
cron.schedule("0 9 * * *", () => {
  runReminderSweep().catch(err => console.error("Reminder sweep failed:", err));
});

module.exports = { runReminderSweep };