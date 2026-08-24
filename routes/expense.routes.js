const express = require("express");
const router = express.Router();
const {
  createExpense,
  getAllExpenses,
  updateExpense,
  deleteExpense,
  getExpenseOverview
} = require("../controllers/expense.controller");

// GET /api/expense/overview - Consolidated financial overview (expenses + bike purchases + bike sales & profit)
router.get("/overview", getExpenseOverview);

// GET /api/expense - Fetch manual expenses list
router.get("/", getAllExpenses);

// POST /api/expense - Create new manual daily expense
router.post("/", createExpense);

// PUT /api/expense/:id - Update existing manual expense
router.put("/:id", updateExpense);

// DELETE /api/expense/:id - Delete an expense record
router.delete("/:id", deleteExpense);

module.exports = router;
