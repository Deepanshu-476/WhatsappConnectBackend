import { collections } from "../models/collection-models.js";
import { countCollection, dashboardSummary, messageStatusCounts } from "../services/analytics-service.js";

export const analyticsController = {
  minWriteRole: "admin",
  async list(req, res) {
    try {
      const [summary, deliverabilityEvents, webhookDeliveries] = await Promise.all([
        dashboardSummary(req.accountId),
        countCollection(collections.deliverabilityEvents, req.accountId),
        countCollection(collections.webhookDeliveries, req.accountId),
      ]);
      return res.json({ data: { ...summary, deliverability_events: deliverabilityEvents, webhook_deliveries: webhookDeliveries } });
    } catch (err) {
      console.error("[analytics] error:", err);
      return res.status(500).json({ error: err.message || "Failed to load analytics" });
    }
  },
  async messageStatuses(req, res) {
    try {
      return res.json({ data: await messageStatusCounts(req.accountId) });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to load message statuses" });
    }
  },
};
