import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";
import { walletBalance } from "../services/analytics-service.js";

const base = resourceController(collections.walletTransactions, { listKey: "transactions", minWriteRole: "admin" });

export const walletController = {
  ...base,
  async balance(req, res) {
    try {
      return res.json({ data: { balance: await walletBalance(req.accountId) } });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to load wallet balance" });
    }
  },
};
