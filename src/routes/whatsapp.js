import express from "express";

import { resourceController } from "../controllers/resource-controller.js";
import { collections } from "../models/collection-models.js";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { accountScope, collection } from "../utils/crud.js";
import { resourceRoute } from "./resource-route.js";

const router = express.Router();

router.get("/webhook", (_req, res) => res.send("OK"));
router.post("/webhook", (_req, res) => res.json({ ok: true }));

router.use(requireAuth);
router.use(attachAccount);

router.get("/config", async (req, res) => {
  const config = await collection(collections.whatsappConfig).findOne(accountScope(req.accountId));
  res.json({ config: config ?? null });
});
router.post("/config", requireAccountRole("admin"), async (req, res) => {
  await collection(collections.whatsappConfig).updateOne(accountScope(req.accountId), { $set: { ...(req.body ?? {}), accountId: req.accountId } }, { upsert: true });
  res.json({ ok: true });
});
router.delete("/config", requireAccountRole("admin"), async (req, res) => {
  await collection(collections.whatsappConfig).deleteMany(accountScope(req.accountId));
  res.json({ ok: true });
});
router.get("/config/verify-registration", (_req, res) => res.json({ ok: true }));
router.post("/send", requireAccountRole("agent"), (_req, res) => res.json({ ok: true }));
router.post("/react", requireAccountRole("agent"), (_req, res) => res.json({ ok: true }));
router.post("/broadcast", requireAccountRole("agent"), (_req, res) => res.json({ ok: true }));
router.post("/broadcast/:id/resume", requireAccountRole("agent"), (_req, res) => res.json({ ok: true }));
router.get("/media/:mediaId", (_req, res) => res.status(404).json({ error: "Media proxy is not configured in backend yet" }));
router.post("/templates/sync", requireAccountRole("admin"), (_req, res) => res.json({ ok: true, templates: [] }));
router.post("/templates/submit", requireAccountRole("admin"), (_req, res) => res.json({ ok: true }));
router.use("/templates", resourceRoute(resourceController(collections.whatsappTemplates, { listKey: "templates", minWriteRole: "admin" })));

export default router;

