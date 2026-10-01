import bcrypt from "bcryptjs";
import express from "express";
import mongoose from "mongoose";

import { Account } from "../models/account.js";
import { AccountMember } from "../models/account-member.js";
import { User } from "../models/user.js";
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  signSession,
} from "../middleware/auth.js";

const router = express.Router();

function publicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    created_at: user.createdAt?.toISOString?.() ?? new Date().toISOString(),
    user_metadata: {
      full_name: user.fullName,
      avatar_url: user.avatarUrl,
    },
  };
}

async function buildAuthPayload(userId) {
  const user = await User.findById(userId).lean();

  if (!user) {
    return null;
  }

  const member = await AccountMember.findOne({ userId: user._id }).lean();
  const account = member
    ? await Account.findById(member.accountId).lean()
    : null;

  return {
    user: publicUser(user),
    profile: {
      id: user._id.toString(),
      full_name: user.fullName,
      email: user.email,
      avatar_url: user.avatarUrl,
      role: null,
      beta_features: user.betaFeatures ?? [],
      account_id: member?.accountId?.toString() ?? null,
      account_role: member?.role ?? null,
    },
    account: account
      ? {
          id: account._id.toString(),
          name: account.name,
          default_currency: account.defaultCurrency ?? "USD",
        }
      : null,
  };
}

router.post("/signup", async (req, res) => {
  const { fullName, email, password } = req.body ?? {};

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail }).lean();

  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      fullName: String(fullName).trim(),
      email: normalizedEmail,
      passwordHash,
    });

    const account = await Account.create({
      name: `${user.fullName || user.email}'s account`,
      ownerId: user._id,
    });

    await AccountMember.create({
      accountId: account._id,
      userId: user._id,
      role: "owner",
    });

    const token = signSession(user._id.toString());
    setSessionCookie(res, token);
    const payload = await buildAuthPayload(user._id);

    return res.status(201).json(payload);
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ error: err.message || "Failed to create account" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await User.findOne({ email: String(email).trim().toLowerCase() });

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signSession(user._id.toString());
  setSessionCookie(res, token);

  return res.json(await buildAuthPayload(user._id));
});

router.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const payload = await buildAuthPayload(req.userId);

  if (!payload) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.json(payload);
});

export default router;
