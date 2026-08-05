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

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "https://ammar-autos-frontend.vercel.app",
  "https://ammar-autos.vercel.app",
  "https://ammar-autos-backend.vercel.app",
];

// Helper: check if origin is from a Vercel preview deployment
const isVercelPreview = (origin) =>
  /^https:\/\/ammar-autos.*\.vercel\.app$/.test(origin);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, Postman, server-to-server, etc.)
      if (!origin || allowedOrigins.includes(origin) || isVercelPreview(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
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

// Also handle requests without /api prefix (frontend compatibility)
app.use("/auth", authRoutes);
app.use("/purchase", purchaseRoutes);
app.use("/sale", saleRoutes);
app.use("/upload", uploadRoutes);
app.use("/registration", registrationRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/customer", customerRoutes);
app.use("/reports", reportsRoutes);

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;