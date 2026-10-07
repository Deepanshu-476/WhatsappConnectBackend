import mongoose from "mongoose";

export function collection(name) {
  return mongoose.connection.db.collection(name);
}

export function parseId(value) {
  if (typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
}

export function publicDoc(doc) {
  if (!doc) return null;
  const out = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key === "_id") out.id = value.toString();
    else if (key === "userId") out.user_id = value?.toString?.() ?? value;
    else if (key === "accountId") out.account_id = value?.toString?.() ?? value;
    else if (key === "createdAt") out.created_at = value;
    else if (key === "updatedAt") out.updated_at = value;
    else if (value instanceof mongoose.Types.ObjectId) out[key] = value.toString();
    else out[key] = value;
  }
  return out;
}

export function accountScope(accountId) {
  if (!accountId) return {};
  const parsed = parseId(accountId);
  const str = accountId.toString();
  return {
    $or: [
      { accountId: parsed },
      { accountId: str },
      { account_id: parsed },
      { account_id: str },
    ],
  };
}

export function timestamps(isNew = false) {
  const now = new Date().toISOString();
  return isNew ? { created_at: now, updated_at: now } : { updated_at: now };
}

