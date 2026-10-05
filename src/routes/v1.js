import express from "express";

import { resourceController } from "../controllers/resource-controller.js";
import { collections } from "../models/collection-models.js";
import { resourceRoute } from "./resource-route.js";
import { ApiError, sendMessageForAccount } from "../services/whatsapp-service.js";
import { collection } from "../utils/crud.js";

const router = express.Router();

router.get("/me", (_req, res) => res.json({ ok: true }));
router.use("/contacts", resourceRoute(resourceController(collections.contacts, { listKey: "contacts", minWriteRole: "agent" })));
router.use("/conversations", resourceRoute(resourceController(collections.conversations, { listKey: "conversations", minWriteRole: "agent" })));
router.use("/webhooks", resourceRoute(resourceController(collections.webhooks, { listKey: "webhooks", minWriteRole: "admin" })));
router.use("/broadcasts", resourceRoute(resourceController(collections.broadcasts, { listKey: "broadcasts", minWriteRole: "agent" })));
router.post("/messages", async (req, res) => {
  try {
    const key = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "") || req.get("x-api-key");
    if (!key) return res.status(401).json({ error: { code: "unauthorized", message: "API key is required" } });
    const apiKey = await collection(collections.apiKeys).findOne({ $or: [{ key }, { token: key }, { value: key }] });
    if (!apiKey) return res.status(401).json({ error: { code: "unauthorized", message: "Invalid API key" } });
    const accountId = apiKey.accountId || apiKey.account_id;
    const userId = apiKey.userId || apiKey.user_id || null;
    const result = await sendMessageForAccount({
      accountId,
      userId,
      conversationId: req.body?.conversation_id,
      contactId: req.body?.contact_id,
      body: req.body ?? {},
      senderType: "agent",
    });
    return res.status(201).json({ data: result });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return res.status(status).json({ error: { code: err.code || "error", message: err.message || "Request failed" } });
  }
});

export default router;
