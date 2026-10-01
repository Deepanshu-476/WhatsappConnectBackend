import express from "express";
import mongoose from "mongoose";
import { requireAuth } from "../middleware/auth.js";
import { AccountMember } from "../models/account-member.js";
import { User } from "../models/user.js";

const router = express.Router();

const PUBLIC_TABLES = new Set(["accounts", "profiles", "users"]);

function getCollection(tableName) {
  return mongoose.connection.db.collection(tableName);
}

function toSnakeCase(value) {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function toDbField(field) {
  if (field === "id") return "_id";
  if (field.includes("->>")) return field.replace(/->>/g, ".");
  if (field === "user_id") return "userId";
  if (field === "account_id") return "accountId";
  if (field === "account_role") return "role";
  if (field === "full_name") return "fullName";
  if (field === "avatar_url") return "avatarUrl";
  if (field === "default_currency") return "defaultCurrency";
  if (field === "owner_user_id") return "ownerId";
  return field;
}

function toPublicField(field) {
  if (field === "_id") return "id";
  if (field === "userId") return "user_id";
  if (field === "accountId") return "account_id";
  if (field === "fullName") return "full_name";
  if (field === "avatarUrl") return "avatar_url";
  if (field === "defaultCurrency") return "default_currency";
  if (field === "ownerId") return "owner_user_id";
  if (field === "createdAt") return "created_at";
  if (field === "updatedAt") return "updated_at";
  return toSnakeCase(field);
}

function normalizeWriteDoc(doc) {
  const normalized = {};
  for (const [key, value] of Object.entries(doc ?? {})) {
    normalized[toDbField(key)] = value;
  }
  return normalized;
}

function upsertFilterFor(doc, onConflict) {
  const fields = String(onConflict || "")
    .split(",")
    .map((field) => toDbField(field.trim()))
    .filter(Boolean);

  if (fields.length > 0) {
    return Object.fromEntries(
      fields
        .filter((field) => doc[field] !== undefined && doc[field] !== null)
        .map((field) => [field, doc[field]]),
    );
  }

  if (doc._id) return { _id: parseId(doc._id) };
  if (doc.id) return { _id: parseId(doc.id) };
  return null;
}

function formatDoc(doc) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const formatted = {};

  for (const [key, value] of Object.entries(plain)) {
    if (key === "__v" || key === "passwordHash") continue;
    const publicKey = toPublicField(key);
    formatted[publicKey] =
      value instanceof mongoose.Types.ObjectId ? value.toString() : value;
  }

  return formatted;
}

function parseId(val) {
  if (typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val)) {
    return new mongoose.Types.ObjectId(val);
  }
  return val;
}

function parseValue(field, val) {
  if (field === "_id" || field.endsWith("Id")) {
    return parseId(val);
  }
  if (typeof val === "string" && /^[0-9a-fA-F]{24}$/.test(val)) {
    return parseId(val);
  }
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null") return null;
  return val;
}

function splitTopLevel(value) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (const char of String(value)) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  if (current) parts.push(current);
  return parts;
}

function parseFilterExpression(expression) {
  const firstDot = expression.indexOf(".");
  const secondDot = firstDot >= 0 ? expression.indexOf(".", firstDot + 1) : -1;
  if (firstDot < 0 || secondDot < 0) return null;

  return {
    field: toDbField(expression.slice(0, firstDot)),
    operator: expression.slice(firstDot + 1, secondDot),
    value: expression.slice(secondDot + 1),
  };
}

function conditionFor(field, operator, rawValue) {
  const value = parseValue(field, rawValue);
  if (operator === "eq") return value;
  if (operator === "neq") return { $ne: value };
  if (operator === "gt") return { $gt: value };
  if (operator === "gte") return { $gte: value };
  if (operator === "lt") return { $lt: value };
  if (operator === "lte") return { $lte: value };
  if (operator === "is") return rawValue === "null" ? null : value;
  if (operator === "ilike" || operator === "like") {
    const clean = String(rawValue).replace(/^[%*]+|[%*]+$/g, "");
    return operator === "ilike" ? { $regex: clean, $options: "i" } : { $regex: clean };
  }
  if (operator === "in") {
    const clean = String(rawValue).replace(/^\(|\)$/g, "");
    return { $in: clean.split(",").map((v) => parseValue(field, v)) };
  }
  return value;
}

function addFieldCondition(query, field, condition) {
  if (field === "accountId") {
    addAndCondition(query, { $or: [{ accountId: condition }, { account_id: condition }] });
    return;
  }

  if (
    condition &&
    typeof condition === "object" &&
    !Array.isArray(condition) &&
    query[field] &&
    typeof query[field] === "object" &&
    !Array.isArray(query[field])
  ) {
    query[field] = { ...query[field], ...condition };
  } else {
    query[field] = condition;
  }
}

function addAndCondition(query, condition) {
  query.$and = [...(query.$and ?? []), condition];
}

function mongoQueryFromExpression(expression) {
  if (expression.startsWith("and(") && expression.endsWith(")")) {
    const children = splitTopLevel(expression.slice(4, -1))
      .map(mongoQueryFromExpression)
      .filter(Boolean);
    return children.length === 1 ? children[0] : { $and: children };
  }

  const parsed = parseFilterExpression(expression);
  if (!parsed) return null;
  return { [parsed.field]: conditionFor(parsed.field, parsed.operator, parsed.value) };
}

function applyFilters(query, params) {
  for (const [key, rawVal] of Object.entries(params)) {
    if (
      ["select", "order", "limit", "offset", "range", "count", "head", "upsert", "onConflict"].includes(
        key,
      )
    ) {
      continue;
    }

    const val = String(rawVal);
    if (key === "or") {
      const clauses = splitTopLevel(val).map(mongoQueryFromExpression).filter(Boolean);
      if (clauses.length > 0) addAndCondition(query, { $or: clauses });
    } else if (key.startsWith("contains.")) {
      const field = toDbField(key.slice(9));
      const parsed = JSON.parse(val);
      addFieldCondition(query, field, { $all: Array.isArray(parsed) ? parsed : [parsed] });
    } else if (/^(eq|neq|in|ilike|like|is|gt|gte|lt|lte)\./.test(key)) {
      const dot = key.indexOf(".");
      const operator = key.slice(0, dot);
      const field = toDbField(key.slice(dot + 1));
      addFieldCondition(query, field, conditionFor(field, operator, val));
    } else {
      const field = toDbField(key);
      query[field] = parseValue(field, val);
    }
  }
}

function addAccountScope(table, query, accountId) {
  if (accountId && !PUBLIC_TABLES.has(table)) {
    addAndCondition(query, { $or: [{ accountId }, { account_id: accountId }] });
  }
}

async function resolveAccount(req, _res, next) {
  try {
    if (req.isInternal) {
      return next();
    }

    if (req.userId) {
      const member = await AccountMember.findOne({ userId: req.userId }).lean();
      if (member) {
        req.accountId = member.accountId.toString();
      }
    }
  } catch (err) {
    console.error("resolveAccount error:", err);
  }
  next();
}

router.use(requireAuth);
router.use(resolveAccount);

router.get("/profiles", async (req, res) => {
  try {
    const members = await AccountMember.find(req.accountId ? { accountId: req.accountId } : {})
      .lean();
    const userIds = members.map((member) => member.userId);
    const users = await User.find({ _id: { $in: userIds } }).lean();
    const memberByUserId = new Map(
      members.map((member) => [member.userId.toString(), member]),
    );

    let docs = users.map((user) => {
      const member = memberByUserId.get(user._id.toString());
      return {
        id: user._id.toString(),
        user_id: user._id.toString(),
        full_name: user.fullName,
        email: user.email,
        avatar_url: user.avatarUrl ?? null,
        beta_features: user.betaFeatures ?? [],
        account_id: member?.accountId?.toString() ?? null,
        account_role: member?.role ?? null,
        created_at: user.createdAt,
        updated_at: user.updatedAt,
      };
    });

    const query = {};
    applyFilters(query, req.query);
    docs = docs.filter((doc) =>
      Object.entries(query).every(([field, expected]) => {
        const publicField = toPublicField(field);
        const value = doc[publicField] ?? doc[field];
        if (expected && typeof expected === "object" && "$in" in expected) {
          return expected.$in.map(String).includes(String(value));
        }
        return String(value) === String(expected);
      }),
    );

    return res.json({ data: docs, error: null, count: docs.length });
  } catch (err) {
    console.error("GET /api/data/profiles error:", err);
    return res.status(500).json({ data: null, error: { message: err.message }, count: null });
  }
});

// RPC handler
router.post("/rpc/:fn", async (req, res) => {
  const { fn } = req.params;
  const args = req.body ?? {};

  try {
    if (fn === "filter_contacts_by_tags") {
      const { p_tag_ids = [], p_search = "", p_limit = 25, p_offset = 0 } = args;
      const contactTagsCol = getCollection("contact_tags");
      const contactsCol = getCollection("contacts");

      let contactIds = [];
      if (p_tag_ids && p_tag_ids.length > 0) {
        const ctRows = await contactTagsCol
          .find({ tag_id: { $in: p_tag_ids } })
          .toArray();
        contactIds = ctRows.map((ct) => ct.contact_id);
      }

      const query = {};
      addAccountScope("contacts", query, req.accountId);
      if (p_tag_ids && p_tag_ids.length > 0) {
        query._id = { $in: contactIds.map((id) => parseId(id)) };
      }
      if (p_search && typeof p_search === "string" && p_search.trim()) {
        const searchRegex = new RegExp(p_search.trim(), "i");
        addAndCondition(query, {
          $or: [
            { name: searchRegex },
            { phone: searchRegex },
            { email: searchRegex },
          ],
        });
      }

      const total = await contactsCol.countDocuments(query);
      const docs = await contactsCol
        .find(query)
        .sort({ created_at: -1 })
        .skip(Number(p_offset) || 0)
        .limit(Number(p_limit) || 25)
        .toArray();

      return res.json({
        data: docs.map(formatDoc),
        error: null,
        count: total,
      });
    }

    // Generic RPC fallback
    return res.json({ data: [], error: null });
  } catch (err) {
    console.error(`RPC error for ${fn}:`, err);
    return res.status(500).json({ data: null, error: { message: err.message } });
  }
});

// Generic GET table query
router.get("/:table", async (req, res) => {
  const { table } = req.params;

  try {
    const col = getCollection(table);
    const query = {};
    addAccountScope(table, query, req.accountId);
    applyFilters(query, req.query);

    let cursor = col.find(query);

    // Sorting
    if (req.query.order) {
      const parts = String(req.query.order).split(".");
      const field = toDbField(parts[0]);
      const dir = parts[1] === "desc" ? -1 : 1;
      cursor = cursor.sort({ [field]: dir });
    } else {
      cursor = cursor.sort({ _id: -1 });
    }

    // Pagination
    const limit = req.query.limit ? Number(req.query.limit) : 0;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    if (offset > 0) cursor = cursor.skip(offset);
    if (limit > 0) cursor = cursor.limit(limit);

    const totalCount = req.query.count === "exact" ? await col.countDocuments(query) : null;
    const docs = req.query.head === "true" ? [] : await cursor.toArray();

    return res.json({
      data: docs.map(formatDoc),
      error: null,
      count: totalCount !== null ? totalCount : docs.length,
    });
  } catch (err) {
    console.error(`GET /api/data/${table} error:`, err);
    return res.status(500).json({ data: null, error: { message: err.message }, count: null });
  }
});

// Generic POST (insert / upsert)
router.post("/:table", async (req, res) => {
  const { table } = req.params;
  const isUpsert = req.query.upsert === "true";
  const body = req.body;

  try {
    const col = getCollection(table);
    const now = new Date().toISOString();

    if (Array.isArray(body)) {
      const items = body.map((item) => {
        const doc = normalizeWriteDoc(item);
        if (req.accountId && !doc.accountId && !PUBLIC_TABLES.has(table)) {
          doc.accountId = req.accountId;
        }
        if (!doc.created_at) doc.created_at = now;
        doc.updated_at = now;
        return doc;
      });

      if (isUpsert) {
        const saved = [];
        for (const item of items) {
          const filter = upsertFilterFor(item, req.query.onConflict);
          const doc = { ...item };
          delete doc.id;
          delete doc._id;

          if (filter && Object.keys(filter).length > 0) {
            const result = await col.findOneAndUpdate(
              filter,
              { $set: doc, $setOnInsert: { created_at: doc.created_at ?? now } },
              { upsert: true, returnDocument: "after" },
            );
            saved.push(formatDoc(result));
          } else {
            const result = await col.insertOne(doc);
            saved.push(formatDoc({ _id: result.insertedId, ...doc }));
          }
        }

        return res.json({ data: saved, error: null });
      }

      const result = await col.insertMany(items);
      const inserted = items.map((it, idx) => ({
        ...it,
        id: result.insertedIds[idx].toString(),
      }));

      return res.status(201).json({ data: inserted, error: null });
    } else {
      const doc = normalizeWriteDoc(body);
      if (req.accountId && !doc.accountId && !PUBLIC_TABLES.has(table)) {
        doc.accountId = req.accountId;
      }
      if (!doc.created_at) doc.created_at = now;
      doc.updated_at = now;

      if (isUpsert) {
        const filter = upsertFilterFor(doc, req.query.onConflict);
        delete doc.id;
        delete doc._id;

        if (filter && Object.keys(filter).length > 0) {
          const result = await col.findOneAndUpdate(
            filter,
            { $set: doc, $setOnInsert: { created_at: doc.created_at ?? now } },
            { upsert: true, returnDocument: "after" },
          );
          return res.json({ data: formatDoc(result), error: null });
        }

        const result = await col.insertOne(doc);
        return res.status(201).json({
          data: formatDoc({ _id: result.insertedId, ...doc }),
          error: null,
        });
      } else {
        delete doc._id;
        const result = await col.insertOne(doc);
        return res.status(201).json({
          data: formatDoc({ _id: result.insertedId, ...doc }),
          error: null,
        });
      }
    }
  } catch (err) {
    console.error(`POST /api/data/${table} error:`, err);
    return res.status(500).json({ data: null, error: { message: err.message } });
  }
});

// Generic PATCH (update)
router.patch("/:table", async (req, res) => {
  const { table } = req.params;
  const updateData = normalizeWriteDoc(req.body);
  delete updateData.id;
  delete updateData._id;
  updateData.updated_at = new Date().toISOString();

  try {
    const col = getCollection(table);
    const query = {};
    addAccountScope(table, query, req.accountId);
    applyFilters(query, req.query);

    await col.updateMany(query, { $set: updateData });
    const updatedDocs = await col.find(query).toArray();

    return res.json({
      data: updatedDocs.map(formatDoc),
      error: null,
    });
  } catch (err) {
    console.error(`PATCH /api/data/${table} error:`, err);
    return res.status(500).json({ data: null, error: { message: err.message } });
  }
});

// Generic DELETE
router.delete("/:table", async (req, res) => {
  const { table } = req.params;

  try {
    const col = getCollection(table);
    const query = {};
    addAccountScope(table, query, req.accountId);
    applyFilters(query, req.query);

    await col.deleteMany(query);
    return res.json({ data: null, error: null });
  } catch (err) {
    console.error(`DELETE /api/data/${table} error:`, err);
    return res.status(500).json({ data: null, error: { message: err.message } });
  }
});

export default router;

