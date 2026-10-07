import mongoose from "mongoose";
import { Subscription } from "../models/subscription.js";
import { SubscriptionPlan, DEFAULT_PLANS } from "../models/subscription-plan.js";
import { AccountMember } from "../models/account-member.js";
import { collections } from "../models/collection-models.js";
import { collection, parseId, accountScope, stripSecrets } from "../utils/crud.js";

const TRIAL_DAYS = 7;

/**
 * Ensure default plans exist in the database.
 */
export async function ensureDefaultPlans() {
  try {
    for (const plan of DEFAULT_PLANS) {
      await SubscriptionPlan.findOneAndUpdate(
        { slug: plan.slug },
        { $setOnInsert: plan },
        { upsert: true, new: true },
      );
    }
  } catch (err) {
    console.error("[ensureDefaultPlans] error:", err);
  }
}

/**
 * Create or provision a 7-day trial subscription for an account.
 */
export async function createTrialSubscription(accountId) {
  const parsedId = parseId(accountId);
  const existing = await Subscription.findOne({ accountId: parsedId }).lean();
  if (existing) {
    return existing;
  }

  await ensureDefaultPlans();
  const proPlan = await SubscriptionPlan.findOne({ slug: "professional" }).lean() || DEFAULT_PLANS[1];

  const now = new Date();
  const trialEnd = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const trialSub = await Subscription.create({
    accountId: parsedId,
    planId: proPlan._id || proPlan.slug,
    planSlug: proPlan.slug,
    planName: `${proPlan.name} (Trial)`,
    billingInterval: "monthly",
    status: "TRIALING",
    trialStartAt: now,
    trialEndAt: trialEnd,
    currentPeriodStartAt: now,
    currentPeriodEndAt: trialEnd,
    nextBillingAt: trialEnd,
    cancelAtPeriodEnd: false,
    provider: "trial",
    features: proPlan.features || [],
    limits: proPlan.limits || {},
  });

  await recordAudit(parsedId, "TRIAL_CREATED", {
    planSlug: proPlan.slug,
    trialStartAt: now,
    trialEndAt: trialEnd,
  });

  return trialSub.toObject();
}

/**
 * Get authoritative subscription state with server-side expiry reconciliation.
 */
export async function getAuthoritativeSubscription(accountId) {
  const parsedId = parseId(accountId);
  let sub = await Subscription.findOne({ accountId: parsedId })
    .sort({ createdAt: -1 })
    .lean();

  if (!sub) {
    sub = await createTrialSubscription(parsedId);
  }

  const now = new Date();

  // Server-side expiry check for TRIALING
  if (sub.status === "TRIALING" && sub.trialEndAt && new Date(sub.trialEndAt) < now) {
    await Subscription.updateOne(
      { _id: sub._id },
      { $set: { status: "EXPIRED", updatedAt: now } },
    );
    sub.status = "EXPIRED";
  }

  // Server-side expiry check for ACTIVE subscriptions
  if (sub.status === "ACTIVE" && sub.currentPeriodEndAt && new Date(sub.currentPeriodEndAt) < now) {
    const nextStatus = sub.cancelAtPeriodEnd ? "CANCELLED" : "PAST_DUE";
    await Subscription.updateOne(
      { _id: sub._id },
      { $set: { status: nextStatus, updatedAt: now } },
    );
    sub.status = nextStatus;
  }

  // Calculate days remaining
  let daysRemaining = 0;
  if (sub.status === "TRIALING" && sub.trialEndAt) {
    const diffMs = new Date(sub.trialEndAt).getTime() - now.getTime();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  } else if (sub.status === "ACTIVE" && sub.currentPeriodEndAt) {
    const diffMs = new Date(sub.currentPeriodEndAt).getTime() - now.getTime();
    daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  // Fetch plan details
  const plan = await SubscriptionPlan.findOne({ slug: sub.planSlug }).lean();

  // Current usage stats
  const [memberCount, channelCount] = await Promise.all([
    AccountMember.countDocuments({ accountId: parsedId }),
    collection(collections.channelConfigs).countDocuments(accountScope(parsedId)),
  ]);

  return {
    ...sub,
    id: sub._id.toString(),
    plan: plan || null,
    daysRemaining,
    trialDaysRemaining: sub.status === "TRIALING" ? daysRemaining : 0,
    isTrial: sub.status === "TRIALING",
    isExpired: sub.status === "EXPIRED",
    isActive: sub.status === "ACTIVE" || sub.status === "TRIALING",
    usage: {
      users: memberCount,
      channels: channelCount,
    },
  };
}

/**
 * Check if the account has access to a specific feature flag.
 */
export async function hasFeature(accountId, featureKey) {
  const sub = await getAuthoritativeSubscription(accountId);

  // If expired, past due, or suspended, only allow access to core account/billing
  if (!sub.isActive) {
    return false;
  }

  // Standardize feature key (e.g. "billing.feature.ai_agent" or "ai_agent")
  const normalizedKey = String(featureKey).replace(/^billing\.feature\./, "").trim();

  // Check sub.features or plan features
  const allowedFeatures = new Set([
    ...(sub.features || []),
    ...(sub.plan?.features || []),
  ]);

  return allowedFeatures.has(normalizedKey);
}

/**
 * Check a numeric usage limit.
 */
export async function checkLimit(accountId, metricKey, requestedAmount = 1) {
  const sub = await getAuthoritativeSubscription(accountId);
  const parsedId = parseId(accountId);

  const limits = {
    ...(sub.plan?.limits || {}),
    ...(sub.limits || {}),
  };

  let maxAllowed = limits[metricKey] ?? Infinity;

  // Add any boosts from active add-ons
  if (Array.isArray(sub.addons)) {
    for (const addon of sub.addons) {
      if (addon.limitBoost && addon.limitBoost.metric === metricKey) {
        maxAllowed += (addon.limitBoost.amount || 0) * (addon.quantity || 1);
      }
    }
  }

  let currentUsage = 0;
  if (metricKey === "maxUsers") {
    currentUsage = await AccountMember.countDocuments({ accountId: parsedId });
  } else if (metricKey === "maxChannels") {
    currentUsage = await collection(collections.channelConfigs).countDocuments(accountScope(parsedId));
  } else if (metricKey === "maxContacts") {
    currentUsage = await collection(collections.contacts).countDocuments(accountScope(parsedId));
  } else if (metricKey === "maxAutomations") {
    currentUsage = await collection(collections.automations).countDocuments(accountScope(parsedId));
  }

  const allowed = (currentUsage + requestedAmount) <= maxAllowed;
  return {
    allowed,
    metric: metricKey,
    current: currentUsage,
    max: maxAllowed,
    requested: requestedAmount,
  };
}

/**
 * Cancel subscription (default: at period end).
 */
export async function cancelSubscription(accountId, { immediate = false } = {}) {
  const parsedId = parseId(accountId);
  const sub = await Subscription.findOne({ accountId: parsedId, status: { $in: ["ACTIVE", "TRIALING"] } });

  if (!sub) {
    throw new Error("No active subscription to cancel");
  }

  const now = new Date();
  if (immediate) {
    sub.status = "CANCELLED";
    sub.cancelledAt = now;
    sub.cancelAtPeriodEnd = false;
  } else {
    sub.cancelAtPeriodEnd = true;
    sub.cancelledAt = now;
  }

  await sub.save();

  await recordAudit(parsedId, "SUBSCRIPTION_CANCELLED", {
    immediate,
    planSlug: sub.planSlug,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  });

  return sub.toObject();
}

/**
 * Reactivate subscription (un-cancels if period hasn't ended).
 */
export async function reactivateSubscription(accountId) {
  const parsedId = parseId(accountId);
  const sub = await Subscription.findOne({
    accountId: parsedId,
    cancelAtPeriodEnd: true,
  });

  if (!sub) {
    throw new Error("No pending cancellation found");
  }

  sub.cancelAtPeriodEnd = false;
  sub.cancelledAt = null;
  await sub.save();

  await recordAudit(parsedId, "SUBSCRIPTION_REACTIVATED", {
    planSlug: sub.planSlug,
  });

  return sub.toObject();
}

/**
 * Helper to write audit log entry.
 */
export async function recordAudit(accountId, action, metadata = {}) {
  try {
    await collection(collections.auditLogs).insertOne({
      accountId: parseId(accountId),
      action,
      entity: "subscription",
      metadata: stripSecrets(metadata),
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[auditLog] failed:", err);
  }
}
