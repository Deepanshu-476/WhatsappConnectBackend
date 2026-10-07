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

function maskKey(key) {
  if (!key || typeof key !== "string") return "";
  if (key.length <= 8) return "••••••••••••••••";
  return `${key.slice(0, 3)}••••••••••••••••${key.slice(-4)}`;
}

router.get("/config", async (req, res) => {
  const config = await collection(collections.aiConfig).findOne(accountScope(req.accountId));
  if (config) {
    const sanitized = { ...config };
    if (sanitized.apiKey) sanitized.apiKey = maskKey(sanitized.apiKey);
    if (sanitized.api_key) sanitized.api_key = maskKey(sanitized.api_key);
    return res.json({ config: sanitized });
  }
  res.json({ config: null });
});

router.post("/config", requireAccountRole("admin"), async (req, res) => {
  const incoming = { ...(req.body ?? {}) };
  // Protect against saving masked bullets
  if (incoming.apiKey && incoming.apiKey.includes("••••")) {
    const existing = await collection(collections.aiConfig).findOne(accountScope(req.accountId));
    incoming.apiKey = existing?.apiKey || existing?.api_key || "";
  }
  await collection(collections.aiConfig).updateOne(accountScope(req.accountId), { $set: { ...incoming, accountId: req.accountId } }, { upsert: true });
  res.json({ ok: true });
});

router.delete("/config", requireAccountRole("admin"), async (req, res) => {
  await collection(collections.aiConfig).deleteMany(accountScope(req.accountId));
  res.json({ ok: true });
});

router.post("/draft", requireAccountRole("agent"), async (req, res) => {
  try {
    const draft = await generateAiText(req.accountId, [
      { role: "system", content: "Write a concise, helpful WhatsApp business reply." },
      { role: "user", content: req.body?.prompt || req.body?.message || "" },
    ]);
    res.json({ draft });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/test", requireAccountRole("admin"), async (req, res) => {
  try {
    const message = await generateAiText(req.accountId, [{ role: "user", content: req.body?.prompt || "Say OK" }]);
    res.json({ ok: true, message });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/playground", requireAccountRole("agent"), async (req, res) => {
  try {
    const message = await generateAiText(req.accountId, req.body?.messages || [{ role: "user", content: req.body?.message || req.body?.prompt || "" }]);
    res.json({ message });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/usage", requireAccountRole("admin"), async (req, res) => {
  const usage = await collection("ai_usage").find(accountScope(req.accountId)).sort({ created_at: -1 }).limit(100).toArray();
  res.json({ usage });
});

router.post("/autoreply/:conversationId", requireAccountRole("agent"), async (req, res) => {
  try {
    // Check CRM Settings for AI Assistant enable flag
    const crmSettings = await collection("crm_settings").findOne(accountScope(req.accountId));
    if (crmSettings?.aiSettings && crmSettings.aiSettings.enabled === false) {
      return res.status(403).json({ error: "AI Assistant is disabled in CRM Settings" });
    }

    const messages = await collection(collections.messages)
      .find({ conversation_id: req.params.conversationId, ...accountScope(req.accountId) })
      .sort({ created_at: -1, _id: -1 })
      .limit(12)
      .toArray();
    const transcript = messages.reverse().map((m) => `${m.sender_type}: ${m.content_text || `[${m.content_type}]`}`).join("\n");
    const draft = await generateAiText(req.accountId, [
      { role: "system", content: "You are a WhatsApp support agent. Reply briefly and naturally." },
      { role: "user", content: transcript || req.body?.prompt || "" },
    ]);
    res.json({ ok: true, draft });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/knowledge/reindex", requireAccountRole("admin"), async (req, res) => {
  const result = await collection(collections.aiKnowledge).updateMany(accountScope(req.accountId), { $set: { indexed_at: new Date().toISOString() } });
  res.json({ ok: true, indexed: result.modifiedCount });
});

router.use("/knowledge", knowledge);

async function generateAiText(accountId, messages) {
  // Check CRM Settings first
  const crmSettings = await collection("crm_settings").findOne(accountScope(accountId));
  if (crmSettings?.aiSettings && crmSettings.aiSettings.enabled === false) {
    const err = new Error("AI Assistant is disabled in CRM Settings");
    err.status = 403;
    throw err;
  }

  const config = await collection(collections.aiConfig).findOne(accountScope(accountId));
  const apiKey =
    (crmSettings?.aiSettings?.apiKey && !crmSettings.aiSettings.apiKey.includes("••••") ? crmSettings.aiSettings.apiKey : null) ||
    config?.api_key ||
    config?.apiKey ||
    process.env.OPENAI_API_KEY;

  const model = crmSettings?.aiSettings?.model || config?.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const temperature = crmSettings?.aiSettings?.temperature ?? 0.4;

  if (!apiKey) {
    const err = new Error("AI API key is not configured");
    err.status = 400;
    throw err;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error(data?.error?.message || `AI request failed: ${response.status}`);
    err.status = response.status;
    throw err;
  }

  await collection("ai_usage").insertOne({
    accountId,
    model,
    prompt_tokens: data?.usage?.prompt_tokens || 0,
    completion_tokens: data?.usage?.completion_tokens || 0,
    total_tokens: data?.usage?.total_tokens || 0,
    created_at: new Date().toISOString(),
  });

  return data?.choices?.[0]?.message?.content || "";
}

export default router;
