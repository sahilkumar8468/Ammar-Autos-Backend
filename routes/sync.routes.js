const express = require("express");
const router = express.Router();
const syncController = require("../controllers/sync.controller");

router.post("/batch", syncController.batchSync);

module.exports = router;
