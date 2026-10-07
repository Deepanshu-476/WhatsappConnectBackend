import {
  getAuthoritativeSubscription,
  hasFeature,
  checkLimit,
} from "../services/subscription-service.js";

/**
 * Middleware requiring that the tenant has an active trial or paid subscription.
 * Allows expired accounts to still access billing, profile, and auth routes.
 */
export async function requireActiveSubscription(req, res, next) {
  if (req.isInternal) return next();

  if (!req.accountId) {
    return res.status(403).json({ error: "Profile is not linked to an account" });
  }

  try {
    const sub = await getAuthoritativeSubscription(req.accountId);
    req.subscription = sub;

    if (!sub.isActive) {
      return res.status(402).json({
        error: "Active subscription required. Your trial or plan has expired.",
        code: "SUBSCRIPTION_REQUIRED",
        status: sub.status,
        planSlug: sub.planSlug,
      });
    }

    return next();
  } catch (err) {
    console.error("[requireActiveSubscription] error:", err);
    return res.status(500).json({ error: "Failed to verify subscription status" });
  }
}

/**
 * Middleware requiring a specific feature entitlement.
 * Example: requireFeature("ai_agent") or requireFeature("automations")
 */
export function requireFeature(featureName) {
  return async (req, res, next) => {
    if (req.isInternal) return next();

    if (!req.accountId) {
      return res.status(403).json({ error: "Profile is not linked to an account" });
    }

    try {
      const allowed = await hasFeature(req.accountId, featureName);
      if (!allowed) {
        return res.status(403).json({
          error: `Your current plan does not include the '${featureName}' feature. Please upgrade to continue.`,
          code: "FEATURE_NOT_INCLUDED",
          feature: featureName,
        });
      }

      return next();
    } catch (err) {
      console.error(`[requireFeature:${featureName}] error:`, err);
      return res.status(500).json({ error: "Failed to verify feature entitlement" });
    }
  };
}

/**
 * Middleware requiring that usage of a metric remains within plan limits.
 * Example: requireLimit("maxUsers") or requireLimit("maxChannels")
 */
export function requireLimit(metricName, requestedAmount = 1) {
  return async (req, res, next) => {
    if (req.isInternal) return next();

    if (!req.accountId) {
      return res.status(403).json({ error: "Profile is not linked to an account" });
    }

    try {
      const check = await checkLimit(req.accountId, metricName, requestedAmount);
      if (!check.allowed) {
        return res.status(403).json({
          error: `Plan limit exceeded for '${metricName}'. Current usage: ${check.current}, Limit: ${check.max}.`,
          code: "LIMIT_EXCEEDED",
          metric: metricName,
          current: check.current,
          max: check.max,
        });
      }

      return next();
    } catch (err) {
      console.error(`[requireLimit:${metricName}] error:`, err);
      return res.status(500).json({ error: "Failed to verify usage limit" });
    }
  };
}
