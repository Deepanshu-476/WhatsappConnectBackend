import { collections } from "../models/collection-models.js";
import { accountScope, collection, parseId, publicDoc, stripSecrets, timestamps } from "../utils/crud.js";

async function writeAuditLog(req, action, collectionName, entityId, metadata = {}) {
  if (!req.accountId && !req.userId) return;
  try {
    await collection(collections.auditLogs).insertOne({
      accountId: req.accountId || null,
      userId: req.userId || null,
      action,
      entity: collectionName,
      entityId: entityId?.toString?.() ?? entityId ?? null,
      metadata: stripSecrets(metadata),
      ip: req.ip,
      userAgent: req.get?.("user-agent") || "",
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[auditLog] failed:", err);
  }
}

export function resourceController(collectionName, options = {}) {
  const {
    listKey = "items",
    minWriteRole = "agent",
    scopeByAccount = true,
    defaults = {},
    sortable = { created_at: -1, _id: -1 },
  } = options;

  function scopedQuery(req, extra = {}) {
    const query = { ...extra };
    if (scopeByAccount && req.accountId) {
      Object.assign(query, accountScope(req.accountId));
    }
    return query;
  }

  return {
    minWriteRole,

    async list(req, res) {
      try {
        const docs = await collection(collectionName)
          .find(scopedQuery(req))
          .sort(sortable)
          .toArray();
        return res.json({ [listKey]: docs.map(publicDoc), data: docs.map(publicDoc) });
      } catch (err) {
        console.error(`[GET ${collectionName}] error:`, err);
        return res.status(500).json({ error: err.message || "Failed to list records" });
      }
    },

    async create(req, res) {
      try {
        const doc = {
          ...defaults,
          ...(req.body ?? {}),
          ...(scopeByAccount && req.accountId ? { accountId: req.accountId } : {}),
          ...(req.userId ? { userId: req.userId } : {}),
          ...timestamps(true),
        };
        delete doc.id;
        delete doc._id;

        const result = await collection(collectionName).insertOne(doc);
        await writeAuditLog(req, "create", collectionName, result.insertedId, { fields: Object.keys(doc) });
        return res.status(201).json({ item: publicDoc({ _id: result.insertedId, ...doc }), data: publicDoc({ _id: result.insertedId, ...doc }) });
      } catch (err) {
        console.error(`[POST ${collectionName}] error:`, err);
        return res.status(500).json({ error: err.message || "Failed to create record" });
      }
    },

    async read(req, res) {
      try {
        const doc = await collection(collectionName).findOne(scopedQuery(req, { _id: parseId(req.params.id) }));
        if (!doc) return res.status(404).json({ error: "Not found" });
        return res.json({ item: publicDoc(doc), data: publicDoc(doc) });
      } catch (err) {
        console.error(`[GET ${collectionName}/:id] error:`, err);
        return res.status(500).json({ error: err.message || "Failed to read record" });
      }
    },

    async update(req, res) {
      try {
        const update = { ...(req.body ?? {}), ...timestamps(false) };
        delete update.id;
        delete update._id;
        const query = scopedQuery(req, { _id: parseId(req.params.id) });
        const result = await collection(collectionName).findOneAndUpdate(
          query,
          { $set: update },
          { returnDocument: "after" },
        );
        if (!result) return res.status(404).json({ error: "Not found" });
        await writeAuditLog(req, "update", collectionName, result._id, { fields: Object.keys(update) });
        return res.json({ item: publicDoc(result), data: publicDoc(result) });
      } catch (err) {
        console.error(`[PATCH ${collectionName}/:id] error:`, err);
        return res.status(500).json({ error: err.message || "Failed to update record" });
      }
    },

    async remove(req, res) {
      try {
        const result = await collection(collectionName).deleteOne(scopedQuery(req, { _id: parseId(req.params.id) }));
        if (result.deletedCount === 0) return res.status(404).json({ error: "Not found" });
        await writeAuditLog(req, "delete", collectionName, req.params.id);
        return res.json({ ok: true });
      } catch (err) {
        console.error(`[DELETE ${collectionName}/:id] error:`, err);
        return res.status(500).json({ error: err.message || "Failed to delete record" });
      }
    },
  };
}

