import express from "express";

import { resourceController } from "../controllers/resource-controller.js";
import { collections } from "../models/collection-models.js";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { accountScope, collection, parseId } from "../utils/crud.js";
import { resourceRoute } from "./resource-route.js";
import {
  ApiError,
  processInboundWebhook,
  proxyMedia,
  sendBroadcast,
  sendMessageForAccount,
  submitTemplate,
  syncTemplates,
} from "../services/whatsapp-service.js";

const router = express.Router();

function handleError(res, err) {
  const status = err instanceof ApiError ? err.status : 500;
  return res.status(status).json({ error: err.message || "Request failed", code: err.code || "error" });
}

router.get("/webhook", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const configuredToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && challenge && configuredToken && token === configuredToken) {
    return res.status(200).send(challenge);
  }
  return res.status(mode ? 403 : 200).send(mode ? "Verification failed" : "OK");
});

router.post("/webhook", async (req, res) => {
  try {
    const results = await processInboundWebhook(req.body);
    return res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error("[whatsapp webhook] error:", err);
    return handleError(res, err);
  }
});

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
router.get("/config/verify-registration", async (req, res) => {
  const config = await collection(collections.whatsappConfig).findOne(accountScope(req.accountId));
  res.json({ ok: !!config?.phone_number_id, config: config ?? null });
});
router.post("/send", requireAccountRole("agent"), async (req, res) => {
  try {
    const result = await sendMessageForAccount({
      accountId: req.accountId,
      userId: req.userId,
      conversationId: req.body?.conversation_id,
      contactId: req.body?.contact_id,
      body: req.body ?? {},
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("[whatsapp send] error:", err);
    return handleError(res, err);
  }
});
router.post("/react", requireAccountRole("agent"), (_req, res) => res.status(501).json({ error: "Reactions are not implemented in this backend yet" }));
router.post("/broadcast", requireAccountRole("agent"), async (req, res) => {
  try {
    const result = await sendBroadcast(req.accountId, req.userId, req.body ?? {});
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[whatsapp broadcast] error:", err);
    return handleError(res, err);
  }
});
router.post("/broadcast/:id/resume", requireAccountRole("agent"), async (req, res) => {
  try {
    const existing = await collection(collections.broadcasts).findOne({ _id: parseId(req.params.id), ...accountScope(req.accountId) });
    const result = await sendBroadcast(req.accountId, req.userId, { ...(existing ?? {}), ...(req.body ?? {}) });
    return res.json({ ok: true, resumed_from: req.params.id, ...result });
  } catch (err) {
    return handleError(res, err);
  }
});
router.get("/media/:mediaId", async (req, res) => {
  try {
    const media = await proxyMedia(req.accountId, req.params.mediaId);
    res.setHeader("Content-Type", media.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(media.buffer);
  } catch (err) {
    return handleError(res, err);
  }
});
router.post("/templates/sync", requireAccountRole("admin"), async (req, res) => {
  try {
    const templates = await syncTemplates(req.accountId);
    return res.json({ ok: true, templates });
  } catch (err) {
    return handleError(res, err);
  }
});
router.post("/templates/submit", requireAccountRole("admin"), async (req, res) => {
  try {
    const template = await submitTemplate(req.accountId, req.userId, req.body ?? {});
    return res.status(201).json({ ok: true, template });
  } catch (err) {
    return handleError(res, err);
  }
});
router.use("/templates", resourceRoute(resourceController(collections.whatsappTemplates, { listKey: "templates", minWriteRole: "admin" })));

export default router;
