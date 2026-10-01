import express from "express";

import { resourceController } from "../controllers/resource-controller.js";
import { collections } from "../models/collection-models.js";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { collection, accountScope } from "../utils/crud.js";
import { resourceRoute } from "./resource-route.js";

const router = express.Router();
const knowledge = resourceRoute(resourceController(collections.aiKnowledge, { listKey: "knowledge", minWriteRole: "admin" }));

router.use(requireAuth);
router.use(attachAccount);

router.get("/config", async (req, res) => {
  const config = await collection(collections.aiConfig).findOne(accountScope(req.accountId));
  res.json({ config: config ?? null });
});
router.post("/config", requireAccountRole("admin"), async (req, res) => {
  await collection(collections.aiConfig).updateOne(accountScope(req.accountId), { $set: { ...(req.body ?? {}), accountId: req.accountId } }, { upsert: true });
  res.json({ ok: true });
});
router.delete("/config", requireAccountRole("admin"), async (req, res) => {
  await collection(collections.aiConfig).deleteMany(accountScope(req.accountId));
  res.json({ ok: true });
});
router.post("/draft", requireAccountRole("agent"), (_req, res) => res.json({ draft: "" }));
router.post("/test", requireAccountRole("admin"), (_req, res) => res.json({ ok: true }));
router.post("/playground", requireAccountRole("agent"), (_req, res) => res.json({ message: "" }));
router.get("/usage", requireAccountRole("admin"), (_req, res) => res.json({ usage: [] }));
router.post("/autoreply/:conversationId", requireAccountRole("agent"), (_req, res) => res.json({ ok: true, draft: "" }));
router.use("/knowledge", knowledge);
router.post("/knowledge/reindex", requireAccountRole("admin"), (_req, res) => res.json({ ok: true }));

export default router;

