import { dashboardSummary } from "../services/analytics-service.js";

export const dashboardController = {
  minWriteRole: "admin",
  async list(req, res) {
    try {
      return res.json({ data: await dashboardSummary(req.accountId) });
    } catch (err) {
      console.error("[dashboard] error:", err);
      return res.status(500).json({ error: err.message || "Failed to load dashboard" });
    }
  },
};
