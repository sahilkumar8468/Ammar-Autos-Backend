const express = require("express");
const router = express.Router();

const {
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
} = require("../controllers/sales.controller");

const { getDueReminders } = require("../controllers/reminder.controller");

// IMPORTANT: static/specific routes must come before the "/:id" param route
router.get("/lookup-bike/:registrationNo", lookupBikeByRegistration);
router.get("/lookup-bike-chasis/:chasisNo", lookupBikeByChasis);
router.get("/lookup-bike-engine/:engineNo", lookupBikeByEngine);
router.get("/reminders", getDueReminders);
router.get("/stats", getSaleStats);

router.post("/", createSale);
router.get("/", getAllSales);
router.get("/:id", getSaleById);
router.put("/:id", updateSale);
router.patch("/:id/installments/:monthNumber/pay", markInstallmentPaid);
router.delete("/:id", deleteSale);

module.exports = router;