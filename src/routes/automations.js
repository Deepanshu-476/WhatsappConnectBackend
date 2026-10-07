import express from "express";
import crypto from "node:crypto";
import mongoose from "mongoose";

import { AccountMember } from "../models/account-member.js";
import { requireAuth } from "../middleware/auth.js";
import { requireFeature } from "../middleware/subscription-guard.js";
import { sendMessageForAccount } from "../services/whatsapp-service.js";

const router = express.Router();

const ROLE_RANK = {
  viewer: 1,
  agent: 2,
  admin: 3,
  owner: 4,
};

function collection(name) {
  return mongoose.connection.db.collection(name);
}

function parseId(value) {
  if (typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
}

function formatDoc(doc) {
  if (!doc) return null;
  const out = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "_id") {
      out.id = value.toString();
    } else if (key === "userId") {
      out.user_id = value?.toString?.() ?? value;
    } else if (key === "accountId") {
      out.account_id = value?.toString?.() ?? value;
    } else if (value instanceof mongoose.Types.ObjectId) {
      out[key] = value.toString();
    } else {
      out[key] = value;
    }
  }
  return out;
}

function accountScope(accountId) {
  return { $or: [{ accountId }, { account_id: accountId }] };
}

function normalizeAutomation(body, defaults = {}) {
  return {
    ...defaults,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.trigger_type !== undefined ? { trigger_type: body.trigger_type } : {}),
    ...(body.trigger_config !== undefined ? { trigger_config: body.trigger_config ?? {} } : {}),
    ...(body.is_active !== undefined ? { is_active: !!body.is_active } : {}),
  };
}

async function attachAccount(req, res, next) {
  try {
    const member = await AccountMember.findOne({ userId: req.userId }).lean();
    if (!member) {
      return res.status(403).json({ error: "Profile is not linked to an account" });
    }

    req.accountId = member.accountId.toString();
    req.accountRole = member.role;
    return next();
  } catch (err) {
    console.error("[automations] account lookup error:", err);
    return res.status(500).json({ error: err.message || "Could not load account" });
  }
}

function requireRole(minRole) {
  return (req, res, next) => {
    if ((ROLE_RANK[req.accountRole] ?? 0) < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: `This action requires '${minRole}' role or higher` });
    }
    return next();
  };
}

router.use(requireAuth);
router.use(attachAccount);

router.post("/cron", async (req, res) => {
  const automations = await collection("automations")
    .find({ ...accountScope(req.accountId), is_active: true, trigger_type: { $in: ["scheduled", "cron"] } })
    .toArray();
  let processed = 0;
  for (const automation of automations) {
    await executeAutomation(req, automation, { trigger_event: "cron" });
    processed += 1;
  }
  return res.json({ ok: true, processed });
});

router.post("/engine", requireRole("agent"), async (req, res) => {
  const triggerType = req.body?.trigger_type || req.body?.event || "manual";
  const automations = await collection("automations")
    .find({ ...accountScope(req.accountId), is_active: true, $or: [{ trigger_type: triggerType }, { trigger_type: "manual" }] })
    .toArray();
  const results = [];
  for (const automation of automations) {
    results.push(await executeAutomation(req, automation, { trigger_event: triggerType, contact_id: req.body?.contact_id }));
  }
  return res.json({ ok: true, processed: results.length, results });
});

router.get("/", async (req, res) => {
  try {
    const docs = await collection("automations")
      .find(accountScope(req.accountId))
      .sort({ created_at: -1, _id: -1 })
      .toArray();

    return res.json({ automations: docs.map(formatDoc) });
  } catch (err) {
    console.error("[GET /api/automations] error:", err);
    return res.status(500).json({ error: err.message || "Failed to load automations" });
  }
});

router.post("/", requireRole("agent"), requireFeature("automations"), async (req, res) => {
  try {
    const body = req.body ?? {};
    if (!body.name || !body.trigger_type) {
      return res.status(400).json({ error: "name and trigger_type are required" });
    }

    const now = new Date().toISOString();
    const automation = normalizeAutomation(body, {
      userId: req.userId,
      accountId: req.accountId,
      description: null,
      trigger_config: {},
      is_active: false,
      created_at: now,
      updated_at: now,
    });

    const result = await collection("automations").insertOne(automation);
    const saved = { _id: result.insertedId, ...automation };

    if (Array.isArray(body.steps) && body.steps.length > 0) {
      await insertSteps(result.insertedId.toString(), body.steps);
    }

    return res.status(201).json({ automation: formatDoc(saved) });
  } catch (err) {
    console.error("[POST /api/automations] error:", err);
    return res.status(500).json({ error: err.message || "Failed to create automation" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const automation = await collection("automations").findOne({
      _id: parseId(req.params.id),
      ...accountScope(req.accountId),
    });
    if (!automation) return res.status(404).json({ error: "Not found" });

    const steps = await loadStepsTree(req.params.id);
    return res.json({ automation: formatDoc(automation), steps });
  } catch (err) {
    console.error("[GET /api/automations/:id] error:", err);
    return res.status(500).json({ error: err.message || "Failed to load automation" });
  }
});

router.patch("/:id", requireRole("agent"), async (req, res) => {
  try {
    const query = { _id: parseId(req.params.id), ...accountScope(req.accountId) };
    const existing = await collection("automations").findOne(query);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const update = normalizeAutomation(req.body ?? {}, {
      updated_at: new Date().toISOString(),
    });
    delete update.created_at;
    delete update.userId;
    delete update.accountId;

    if (Object.keys(update).length > 0) {
      await collection("automations").updateOne(query, { $set: update });
    }

    if (Array.isArray(req.body?.steps)) {
      await collection("automation_steps").deleteMany({ automation_id: req.params.id });
      await insertSteps(req.params.id, req.body.steps);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("[PATCH /api/automations/:id] error:", err);
    return res.status(500).json({ error: err.message || "Failed to update automation" });
  }
});

router.delete("/:id", requireRole("agent"), async (req, res) => {
  try {
    const result = await collection("automations").deleteOne({
      _id: parseId(req.params.id),
      ...accountScope(req.accountId),
    });
    if (result.deletedCount > 0) {
      await collection("automation_steps").deleteMany({ automation_id: req.params.id });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/automations/:id] error:", err);
    return res.status(500).json({ error: err.message || "Failed to delete automation" });
  }
});

router.post("/:id/duplicate", requireRole("agent"), async (req, res) => {
  try {
    const original = await collection("automations").findOne({
      _id: parseId(req.params.id),
      ...accountScope(req.accountId),
    });
    if (!original) return res.status(404).json({ error: "Not found" });

    const now = new Date().toISOString();
    const copy = {
      ...original,
      _id: undefined,
      userId: req.userId,
      accountId: req.accountId,
      name: `${original.name} (Copy)`,
      is_active: false,
      created_at: now,
      updated_at: now,
    };
    delete copy._id;
    delete copy.id;
    const result = await collection("automations").insertOne(copy);

    const steps = await collection("automation_steps")
      .find({ automation_id: req.params.id })
      .sort({ position: 1 })
      .toArray();
    if (steps.length > 0) {
      const idMap = new Map();
      for (const step of steps) idMap.set(step.id, crypto.randomUUID());
      const copiedSteps = steps.map((step) => ({
        ...step,
        _id: undefined,
        id: idMap.get(step.id),
        automation_id: result.insertedId.toString(),
        parent_step_id: step.parent_step_id ? idMap.get(step.parent_step_id) : null,
      }));
      for (const step of copiedSteps) delete step._id;
      await collection("automation_steps").insertMany(copiedSteps);
    }

    return res.status(201).json({
      automation: formatDoc({ _id: result.insertedId, ...copy }),
    });
  } catch (err) {
    console.error("[POST /api/automations/:id/duplicate] error:", err);
    return res.status(500).json({ error: err.message || "Failed to duplicate automation" });
  }
});

async function insertSteps(automationId, steps) {
  const rows = [];

  function walk(items, parentId = null, branch = null) {
    items.forEach((step, position) => {
      const id = step.id || crypto.randomUUID();
      rows.push({
        id,
        automation_id: automationId,
        parent_step_id: parentId,
        branch,
        step_type: step.step_type,
        step_config: step.step_config ?? {},
        position,
      });
      if (step.step_type === "condition" && step.branches) {
        if (step.branches.yes) walk(step.branches.yes, id, "yes");
        if (step.branches.no) walk(step.branches.no, id, "no");
      }
    });
  }

  walk(steps);
  if (rows.length > 0) await collection("automation_steps").insertMany(rows);
}

async function loadStepsTree(automationId) {
  const rows = await collection("automation_steps")
    .find({ automation_id: automationId })
    .sort({ position: 1 })
    .toArray();

  const byId = new Map();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      step_type: row.step_type,
      step_config: row.step_config ?? {},
      branches: { yes: [], no: [] },
    });
  }

  const roots = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    if (row.parent_step_id) {
      const parent = byId.get(row.parent_step_id);
      if (parent) parent.branches[row.branch || "yes"].push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function executeAutomation(req, automation, context = {}) {
  const steps = await loadStepsTree(automation._id.toString());
  const executed = [];
  let status = "success";
  let errorMessage = null;

  async function runStep(step) {
    try {
      const cfg = step.step_config ?? {};
      if (step.step_type === "send_message" || step.step_type === "send_template") {
        if (!context.contact_id && !cfg.contact_id) {
          executed.push({ step_id: step.id, step_type: step.step_type, status: "skipped", detail: "No contact_id supplied" });
          return;
        }
        await sendMessageForAccount({
          accountId: req.accountId,
          userId: req.userId,
          contactId: context.contact_id || cfg.contact_id,
          body: {
            message_type: step.step_type === "send_template" ? "template" : (cfg.message_type || "text"),
            content_text: cfg.content_text || cfg.message || "",
            template_name: cfg.template_name,
            template_language: cfg.language || cfg.template_language,
            template_params: cfg.template_params || [],
            media_url: cfg.media_url,
          },
          senderType: "bot",
        });
      } else if (step.step_type === "update_contact_field" && context.contact_id) {
        await collection("contacts").updateOne(
          { _id: parseId(context.contact_id), ...accountScope(req.accountId) },
          { $set: { [cfg.field || "status"]: cfg.value, updated_at: new Date().toISOString() } },
        );
      } else if (step.step_type === "add_tag" && context.contact_id && cfg.tag_id) {
        await collection("contact_tags").updateOne(
          { contact_id: context.contact_id, tag_id: cfg.tag_id },
          { $setOnInsert: { accountId: req.accountId, contact_id: context.contact_id, tag_id: cfg.tag_id } },
          { upsert: true },
        );
      }
      executed.push({ step_id: step.id, step_type: step.step_type, status: "success" });
    } catch (err) {
      status = "failed";
      errorMessage = err.message;
      executed.push({ step_id: step.id, step_type: step.step_type, status: "failed", detail: err.message });
    }
  }

  for (const step of steps) {
    await runStep(step);
  }

  await collection("automation_logs").insertOne({
    accountId: req.accountId,
    automation_id: automation._id.toString(),
    userId: req.userId,
    contact_id: context.contact_id || null,
    trigger_event: context.trigger_event || automation.trigger_type,
    steps_executed: executed,
    status,
    error_message: errorMessage,
    created_at: new Date().toISOString(),
  });
  await collection("automations").updateOne(
    { _id: automation._id },
    { $inc: { execution_count: 1 }, $set: { last_executed_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
  );

  return { automation_id: automation._id.toString(), status, steps_executed: executed };
}

export default router;
