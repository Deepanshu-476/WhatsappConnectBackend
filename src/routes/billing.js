import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import {
  getAuthoritativeSubscription,
  cancelSubscription,
  reactivateSubscription,
  ensureDefaultPlans,
} from "../services/subscription-service.js";
import {
  createCheckoutOrder,
  verifyAndActivatePayment,
  processRazorpayWebhook,
  getPaymentConfig,
} from "../services/payment-service.js";
import {
  createInvoice,
  generateInvoiceHtml,
} from "../services/invoice-service.js";
import { SubscriptionPlan, DEFAULT_PLANS } from "../models/subscription-plan.js";
import { BillingInvoice } from "../models/billing-invoice.js";
import { BusinessDetails } from "../models/business-details.js";
import { Payment } from "../models/payment.js";
import { parseId, accountScope, publicDoc } from "../utils/crud.js";

const router = express.Router();

export const DEFAULT_ADDONS = [
  {
    slug: "extra-users",
    name: "Extra 5 Team Members",
    description: "Expand your support and sales team with 5 additional user seats.",
    monthlyPrice: 999,
    yearlyPrice: 9990,
    entitlementType: "limit_boost",
    limitBoost: { metric: "maxUsers", amount: 5 },
  },
  {
    slug: "ai-agent-pro",
    name: "AI Agent Pro Add-on",
    description: "Add 2 additional autonomous AI agents with custom knowledge bases and routing.",
    monthlyPrice: 1499,
    yearlyPrice: 14990,
    entitlementType: "limit_boost",
    limitBoost: { metric: "maxAiAgents", amount: 2 },
  },
  {
    slug: "extra-channel",
    name: "Extra WhatsApp Channel",
    description: "Connect an additional official WhatsApp Business phone number.",
    monthlyPrice: 1999,
    yearlyPrice: 19990,
    entitlementType: "limit_boost",
    limitBoost: { metric: "maxChannels", amount: 1 },
  },
  {
    slug: "integrations-api",
    name: "Custom Webhooks & REST API",
    description: "Unlock high-throughput programmatic REST API access and inbound/outbound webhooks.",
    monthlyPrice: 999,
    yearlyPrice: 9990,
    entitlementType: "feature_flag",
    feature: "api",
  },
];

// ----------------------------------------------------
// Public / Unauthenticated Webhook Route
// ----------------------------------------------------
router.post("/webhook", async (req, res) => {
  try {
    const signature = req.get("x-razorpay-signature") || "";
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    const result = await processRazorpayWebhook({
      rawBody,
      signatureHeader: signature,
    });

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[Billing Webhook] error:", err);
    return res.status(400).json({ error: err.message || "Webhook processing failed" });
  }
});

// ----------------------------------------------------
// Authenticated & Tenant Scoped Routes
// ----------------------------------------------------
router.use(requireAuth);
router.use(attachAccount);

/**
 * GET /api/billing/subscription
 * Get current authoritative subscription status, days remaining, limits, and usage.
 * RBAC: admin or owner.
 */
router.get("/subscription", requireAccountRole("admin"), async (req, res) => {
  try {
    const subscription = await getAuthoritativeSubscription(req.accountId);
    const paymentConfig = getPaymentConfig();
    return res.json({
      data: {
        subscription,
        config: paymentConfig,
        userRole: req.accountRole,
      },
    });
  } catch (err) {
    console.error("[GET /api/billing/subscription] error:", err);
    return res.status(500).json({ error: err.message || "Failed to load subscription" });
  }
});

/**
 * GET /api/billing/plans
 * Get all available subscription plans.
 */
router.get("/plans", requireAccountRole("admin"), async (_req, res) => {
  try {
    await ensureDefaultPlans();
    const plans = await SubscriptionPlan.find({ active: true })
      .sort({ displayOrder: 1 })
      .lean();

    return res.json({
      plans: plans.map(publicDoc),
      data: plans.map(publicDoc),
    });
  } catch (err) {
    console.error("[GET /api/billing/plans] error:", err);
    return res.status(500).json({ error: err.message || "Failed to load plans" });
  }
});

/**
 * GET /api/billing/plans/:slug
 * Get specific plan by slug.
 */
router.get("/plans/:slug", requireAccountRole("admin"), async (req, res) => {
  try {
    await ensureDefaultPlans();
    const plan = await SubscriptionPlan.findOne({
      $or: [{ slug: req.params.slug }, { _id: parseId(req.params.slug) }],
    }).lean();

    if (!plan) {
      return res.status(404).json({ error: "Plan not found" });
    }

    return res.json({ plan: publicDoc(plan), data: publicDoc(plan) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load plan" });
  }
});

/**
 * POST /api/billing/checkout
 * Create server-calculated checkout order for Razorpay.
 * RBAC: Owner only.
 */
router.post("/checkout", requireAccountRole("owner"), async (req, res) => {
  try {
    const { planSlug, billingInterval = "monthly", addonSlug } = req.body ?? {};

    if (!planSlug) {
      return res.status(400).json({ error: "Plan slug is required" });
    }

    const checkout = await createCheckoutOrder({
      accountId: req.accountId,
      planSlug,
      billingInterval,
      addonSlug,
    });

    return res.status(200).json({ data: checkout });
  } catch (err) {
    console.error("[POST /api/billing/checkout] error:", err);
    return res.status(400).json({ error: err.message || "Failed to create checkout order" });
  }
});

/**
 * POST /api/billing/verify-payment
 * Verify cryptographic payment signature and activate subscription.
 * RBAC: Owner only.
 */
router.post("/verify-payment", requireAccountRole("owner"), async (req, res) => {
  try {
    const { providerOrderId, providerPaymentId, providerSignature } = req.body ?? {};

    if (!providerOrderId || !providerPaymentId || !providerSignature) {
      return res.status(400).json({
        error: "Missing required verification parameters (orderId, paymentId, signature)",
      });
    }

    const activation = await verifyAndActivatePayment({
      accountId: req.accountId,
      providerOrderId,
      providerPaymentId,
      providerSignature,
    });

    return res.status(200).json({ data: activation });
  } catch (err) {
    console.error("[POST /api/billing/verify-payment] error:", err);
    return res.status(400).json({ error: err.message || "Payment verification failed" });
  }
});

/**
 * GET /api/billing/invoices
 * List billing invoices for the current account.
 */
router.get("/invoices", requireAccountRole("admin"), async (req, res) => {
  try {
    const invoices = await BillingInvoice.find({ accountId: parseId(req.accountId) })
      .sort({ issuedAt: -1, createdAt: -1 })
      .lean();

    return res.json({
      invoices: invoices.map(publicDoc),
      data: invoices.map(publicDoc),
    });
  } catch (err) {
    console.error("[GET /api/billing/invoices] error:", err);
    return res.status(500).json({ error: err.message || "Failed to list invoices" });
  }
});

/**
 * GET /api/billing/invoices/:id
 * Get single invoice with tenant isolation.
 */
router.get("/invoices/:id", requireAccountRole("admin"), async (req, res) => {
  try {
    const invoice = await BillingInvoice.findOne({
      _id: parseId(req.params.id),
      accountId: parseId(req.accountId),
    }).lean();

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    return res.json({ invoice: publicDoc(invoice), data: publicDoc(invoice) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load invoice" });
  }
});

/**
 * GET /api/billing/invoices/:id/download
 * Download printable HTML invoice with tenant isolation.
 */
router.get("/invoices/:id/download", requireAccountRole("admin"), async (req, res) => {
  try {
    const invoice = await BillingInvoice.findOne({
      _id: parseId(req.params.id),
      accountId: parseId(req.accountId),
    }).lean();

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const html = generateInvoiceHtml(invoice);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${invoice.invoiceNumber}.html"`);
    return res.send(html);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to generate invoice download" });
  }
});

/**
 * GET /api/billing/business-details
 * Get business billing details.
 */
router.get("/business-details", requireAccountRole("admin"), async (req, res) => {
  try {
    const details = await BusinessDetails.findOne({
      accountId: parseId(req.accountId),
    }).lean();

    return res.json({ data: details ? publicDoc(details) : null });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load business details" });
  }
});

/**
 * PUT /api/billing/business-details
 * Update business billing details with tenant isolation and validation.
 * RBAC: Owner only.
 */
router.put("/business-details", requireAccountRole("owner"), async (req, res) => {
  try {
    const { companyName, billingAddress, gstNumber, billingEmail, contactPhone } = req.body ?? {};

    if (!companyName || typeof companyName !== "string" || !companyName.trim()) {
      return res.status(400).json({ error: "Company name is required" });
    }

    if (gstNumber) {
      const normalizedGst = String(gstNumber).trim().toUpperCase();
      // Indian GSTIN format check: 15 alphanumeric characters
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(normalizedGst)) {
        return res.status(400).json({
          error: "Invalid GST number format. Must be a valid 15-character GSTIN (e.g. 29ABCDE1234F1Z5)",
        });
      }
    }

    const updated = await BusinessDetails.findOneAndUpdate(
      { accountId: parseId(req.accountId) },
      {
        $set: {
          companyName: companyName.trim(),
          billingAddress: billingAddress || {},
          gstNumber: gstNumber ? String(gstNumber).trim().toUpperCase() : "",
          billingEmail: billingEmail ? String(billingEmail).trim().toLowerCase() : "",
          contactPhone: contactPhone ? String(contactPhone).trim() : "",
        },
      },
      { upsert: true, new: true },
    ).lean();

    return res.json({ data: publicDoc(updated) });
  } catch (err) {
    console.error("[PUT /api/billing/business-details] error:", err);
    return res.status(500).json({ error: err.message || "Failed to update business details" });
  }
});

/**
 * POST /api/billing/subscription/cancel
 * Cancel subscription (default: at period end).
 * RBAC: Owner only.
 */
router.post("/subscription/cancel", requireAccountRole("owner"), async (req, res) => {
  try {
    const { immediate = false } = req.body ?? {};
    const result = await cancelSubscription(req.accountId, { immediate });
    return res.json({ data: publicDoc(result) });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to cancel subscription" });
  }
});

/**
 * POST /api/billing/subscription/reactivate
 * Reactivate a subscription that was scheduled to cancel at period end.
 * RBAC: Owner only.
 */
router.post("/subscription/reactivate", requireAccountRole("owner"), async (req, res) => {
  try {
    const result = await reactivateSubscription(req.accountId);
    return res.json({ data: publicDoc(result) });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to reactivate subscription" });
  }
});

/**
 * GET /api/billing/addons
 * List available add-ons.
 */
router.get("/addons", requireAccountRole("admin"), async (_req, res) => {
  return res.json({ data: DEFAULT_ADDONS });
});

/**
 * GET /api/billing/payments
 * List payment history for current account.
 */
router.get("/payments", requireAccountRole("admin"), async (req, res) => {
  try {
    const payments = await Payment.find({ accountId: parseId(req.accountId) })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ data: payments.map(publicDoc) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Failed to load payments" });
  }
});

export default router;
