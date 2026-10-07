import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import express from "express";
import mongoose from "mongoose";
import nodemailer from "nodemailer";

import { Account } from "../models/account.js";
import { AccountMember } from "../models/account-member.js";
import { User } from "../models/user.js";
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
  signSession,
} from "../middleware/auth.js";
import {
  createTrialSubscription,
  getAuthoritativeSubscription,
} from "../services/subscription-service.js";

const router = express.Router();

function getSiteUrl() {
  return (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim();
}

function getMailTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error("EMAIL_USER and EMAIL_PASS are required to send password reset emails");
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.EMAIL_PORT || 465),
    secure: String(process.env.EMAIL_SECURE || "true") !== "false",
    auth: { user, pass },
  });
}

async function sendPasswordResetEmail({ to, token }) {
  const resetUrl = `${getSiteUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const transporter = getMailTransporter();
  const year = new Date().getFullYear();

  await transporter.sendMail({
    from: `"CIIS Connect" <${fromAddress}>`,
    to,
    subject: "Reset your CIIS Connect password",
    text: [
      "Reset your CIIS Connect password",
      "",
      "We received a request to create a new password for your CIIS Connect account.",
      `Reset your password here: ${resetUrl}`,
      "",
      "This secure link will expire in 1 hour.",
      "If you did not request this email, you can safely ignore it.",
    ].join("\n"),
    html: `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Reset your CIIS Connect password</title>
        </head>
        <body style="margin:0;background:#f4f7fb;padding:0;font-family:Arial,Helvetica,sans-serif;color:#172033;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;margin:0;padding:32px 12px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e5eaf1;border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(23,32,51,0.08);">
                  <tr>
                    <td style="background:#111827;padding:28px 32px;">
                      <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#a7f3d0;font-weight:700;">CIIS Connect</div>
                      <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;color:#ffffff;font-weight:800;">Reset your password</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:34px 32px 28px;">
                      <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#344054;">Hello,</p>
                      <p style="margin:0 0 22px;font-size:16px;line-height:1.65;color:#344054;">We received a request to create a new password for your CIIS Connect account. Click the button below to continue.</p>
                      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0;">
                        <tr>
                          <td>
                            <a href="${resetUrl}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:8px;">Reset password</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#667085;">This secure link will expire in <strong>1 hour</strong>.</p>
                      <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#667085;">If the button does not work, copy and paste this link into your browser:</p>
                      <p style="margin:0 0 22px;font-size:13px;line-height:1.6;word-break:break-all;color:#2563eb;"><a href="${resetUrl}" style="color:#2563eb;">${resetUrl}</a></p>
                      <div style="border-top:1px solid #e5eaf1;margin:26px 0 0;padding-top:20px;">
                        <p style="margin:0;font-size:13px;line-height:1.6;color:#667085;">If you did not request a password reset, you can safely ignore this email. Your password will not change unless this link is used.</p>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f8fafc;padding:20px 32px;text-align:center;">
                      <p style="margin:0;font-size:12px;line-height:1.5;color:#98a2b3;">&copy; ${year} CIIS Connect. This is an automated security email.</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  });
}

async function sendTestEmail(to) {
  const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const transporter = getMailTransporter();
  const year = new Date().getFullYear();

  await transporter.sendMail({
    from: `"CIIS Connect" <${fromAddress}>`,
    to,
    subject: "CIIS Connect email test",
    text: "This is a test email from CIIS Connect. Email sending is configured successfully.",
    html: `
      <!doctype html>
      <html lang="en">
        <body style="margin:0;background:#f4f7fb;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#172033;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5eaf1;border-radius:14px;overflow:hidden;">
                  <tr>
                    <td style="background:#111827;padding:26px 30px;">
                      <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:#a7f3d0;font-weight:700;">CIIS Connect</div>
                      <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;color:#ffffff;">Email test successful</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:30px;">
                      <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:#344054;">Your CIIS Connect email configuration is working.</p>
                      <p style="margin:0;font-size:14px;line-height:1.6;color:#667085;">Password reset emails will use this same backend mail service and template style.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background:#f8fafc;padding:18px 30px;text-align:center;">
                      <p style="margin:0;font-size:12px;color:#98a2b3;">&copy; ${year} CIIS Connect</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  });
}

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
  const subscription = member
    ? await getAuthoritativeSubscription(member.accountId)
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
    subscription,
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

    // Automatically provision 7-day free trial
    await createTrialSubscription(account._id);

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

  if (!user.passwordHash) {
    return res.status(401).json({
      error: "Password reset required. Please use forgot password to set a new password.",
      code: "PASSWORD_RESET_REQUIRED",
    });
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

router.post("/forgot-password", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const user = await User.findOne({ email });

  if (!user) {
    return res.json({ ok: true });
  }

  try {
    const token = crypto.randomBytes(32).toString("hex");
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          passwordResetTokenHash: crypto.createHash("sha256").update(token).digest("hex"),
          passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
        },
      },
    );

    await sendPasswordResetEmail({ to: user.email, token });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Password reset email error:", err);
    return res.status(500).json({ error: "Failed to send password reset email" });
  }
});

router.post("/reset-password", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");

  if (!token || !password) {
    return res.status(400).json({ error: "Token and password are required" });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpires: { $gt: new Date() },
  });

  if (!user) {
    return res.status(400).json({ error: "Reset link is invalid or expired" });
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await bcrypt.hash(password, 12),
        fullName: user.fullName || user.email,
      },
      $unset: {
        passwordResetTokenHash: "",
        passwordResetExpires: "",
      },
    },
  );

  return res.json({ ok: true });
});

router.post("/test-email", async (req, res) => {
  const internalSecret = process.env.INTERNAL_API_SECRET;
  const suppliedInternalSecret = req.get("x-internal-api-secret");

  if (!internalSecret || suppliedInternalSecret !== internalSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const to = String(req.body?.email || process.env.EMAIL_USER || "").trim().toLowerCase();

  if (!to) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    await sendTestEmail(to);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Test email error:", err);
    return res.status(500).json({ error: "Failed to send test email" });
  }
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
