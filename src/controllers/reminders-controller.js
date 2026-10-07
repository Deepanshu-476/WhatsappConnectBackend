import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";
import { collection, accountScope, publicDoc } from "../utils/crud.js";

const base = resourceController(collections.reminders, {
  listKey: "reminders",
  minWriteRole: "agent",
});

export const remindersController = {
  ...base,

  async list(req, res) {
    try {
      const query = { ...accountScope(req.accountId) };
      if (req.query.contact_id) query.contact_id = req.query.contact_id;
      if (req.query.conversation_id) query.conversation_id = req.query.conversation_id;
      if (req.query.status) query.status = req.query.status;

      const docs = await collection(collections.reminders)
        .find(query)
        .sort({ due_date: 1, created_at: -1 })
        .toArray();

      return res.json({
        reminders: docs.map(publicDoc),
        data: docs.map(publicDoc),
      });
    } catch (err) {
      console.error("[GET reminders] error:", err);
      return res.status(500).json({ error: err.message || "Failed to list reminders" });
    }
  },
};
