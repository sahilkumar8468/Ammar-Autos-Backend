const express = require("express");
const router = express.Router();
const { upload, uploadPhoto } = require("../controllers/upload.controller");

router.post("/", upload.single("photo"), uploadPhoto);

module.exports = router;