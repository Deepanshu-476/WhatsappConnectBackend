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
  const config = await collection(collections.aiConfig).findOne(accountScope(accountId));
  const apiKey = config?.api_key || config?.apiKey || process.env.OPENAI_API_KEY;
  const model = config?.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    const err = new Error("AI API key is not configured");
    err.status = 400;
    throw err;
  }
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.4 }),
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
