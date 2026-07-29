const express = require("express");
const router = express.Router();
const {
  createPurchase,
  getAllPurchases,
  getPurchaseById,
  updatePurchase,
  approvePurchase,
  deletePurchase
} = require("../controllers/purchase.controller");

// Base routing paths
router.post("/", createPurchase);
router.get("/", getAllPurchases);
router.get("/:id", getPurchaseById);
router.put("/:id", updatePurchase);
router.patch("/:id/approve", approvePurchase);
router.delete("/:id", deletePurchase);

module.exports = router;