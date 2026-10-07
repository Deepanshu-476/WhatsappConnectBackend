import mongoose from "mongoose";

const SENSITIVE_KEY_PATTERN = /(^|_|\b)(access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|credential|private[_-]?key|client[_-]?secret|webhook[_-]?secret)($|_|\b)/i;
const MASK = "****************";

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
    else if (SENSITIVE_KEY_PATTERN.test(key)) out[key] = maskSecret(value);
    else if (value instanceof mongoose.Types.ObjectId) out[key] = value.toString();
    else out[key] = redactSecrets(value);
  }
  return out;
}

export function maskSecret(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string") return MASK;
  if (value.length <= 8) return MASK;
  return `${value.slice(0, 3)}${MASK}${value.slice(-4)}`;
}

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  const out = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? maskSecret(nestedValue) : redactSecrets(nestedValue);
  }
  return out;
}

export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item));
  if (!value || typeof value !== "object" || value instanceof Date || value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  const out = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = stripSecrets(nestedValue);
    }
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

