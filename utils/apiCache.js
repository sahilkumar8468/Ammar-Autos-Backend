/**
 * Shared API Cache & Quota Fail-Safe Helper
 * Caches controller query responses in memory and gracefully returns cached/fallback data
 * when Firebase returns "8 RESOURCE_EXHAUSTED: Quota exceeded".
 */

const cacheStore = new Map();
const DEFAULT_TTL_MS = 300000; // 5 minutes TTL (Protects 50,000 free reads limit)

const getCached = (key) => {
  const item = cacheStore.get(key);
  if (!item) return null;
  return item.data;
};

const getFreshCached = (key, ttlMs = DEFAULT_TTL_MS) => {
  const item = cacheStore.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp < ttlMs) {
    return item.data;
  }
  return null;
};

const setCached = (key, data) => {
  cacheStore.set(key, { timestamp: Date.now(), data });
};

const clearCache = () => {
  cacheStore.clear();
};

const isQuotaError = (err) => {
  if (!err) return false;
  const msg = err.message || err.toString() || "";
  return msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Quota exceeded") || err.code === 8;
};

const handleControllerError = (err, res, fallbackData = { success: true, data: [], quotaExhausted: true }) => {
  console.error("Controller Error:", err.message);
  if (isQuotaError(err)) {
    return res.status(200).json({
      ...fallbackData,
      quotaExhausted: true,
      message: "Firebase daily read quota reached. Displaying available data."
    });
  }
  return res.status(500).json({ success: false, message: err.message });
};

module.exports = {
  getCached,
  getFreshCached,
  setCached,
  clearCache,
  isQuotaError,
  handleControllerError
};
