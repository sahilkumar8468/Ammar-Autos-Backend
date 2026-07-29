const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const helmet = require("helmet");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

dotenv.config();

const authRoutes = require("./routes/auth.routes");
const purchaseRoutes = require("./routes/purchase.routes");
const saleRoutes = require("./routes/sale.routes");
const uploadRoutes = require("./routes/upload.route");
const registrationRoutes = require("./routes/registration.routes");
const inventoryRoutes = require("./routes/inventory.routes");
const customerRoutes = require("./routes/customer.routes");
const reportsRoutes = require("./routes/reports.routes");

// Starts the daily cron schedule (installment reminders) as a side effect
// require("./jobs/reminder.job");

const app = express();

app.use(cors("http://localhost:3000"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(helmet());
app.use(morgan("dev"));

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Bike Showroom POS Backend Running 🚀",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/purchase", purchaseRoutes);
app.use("/api/sale", saleRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/registration", registrationRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/reports", reportsRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});