import { AccountMember } from "../models/account-member.js";

const ROLE_RANK = {
  viewer: 1,
  agent: 2,
  admin: 3,
  owner: 4,
};

export async function attachAccount(req, res, next) {
  try {
    if (req.isInternal) return next();

    const member = await AccountMember.findOne({ userId: req.userId }).lean();
    if (!member) {
      return res.status(403).json({ error: "Profile is not linked to an account" });
    }

    req.accountId = member.accountId.toString();
    req.accountRole = member.role;
    return next();
  } catch (err) {
    console.error("[attachAccount] error:", err);
    return res.status(500).json({ error: err.message || "Could not load account" });
  }
}

export function requireAccountRole(minRole) {
  return (req, res, next) => {
    if (req.isInternal) return next();
    if ((ROLE_RANK[req.accountRole] ?? 0) < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: `This action requires '${minRole}' role or higher` });
    }
    return next();
  };
}

