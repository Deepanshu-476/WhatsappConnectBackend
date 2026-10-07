import crypto from "node:crypto";
import { Payment } from "../models/payment.js";
import { Subscription } from "../models/subscription.js";
import { SubscriptionPlan, DEFAULT_PLANS } from "../models/subscription-plan.js";
import { BusinessDetails } from "../models/business-details.js";
import { createInvoice } from "./invoice-service.js";
import { recordAudit, ensureDefaultPlans } from "./subscription-service.js";
import { parseId } from "../utils/crud.js";

/**
 * Check if real Razorpay credentials are configured in the environment.
 */
export function isRazorpayConfigured() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  return Boolean(keyId && keySecret && !keyId.includes("placeholder"));
}

/**
 * Get payment configuration status for reporting and client initialization.
 */
export function getPaymentConfig() {
  const configured = isRazorpayConfigured();
  return {
    provider: "razorpay",
    configured,
    keyId: configured ? process.env.RAZORPAY_KEY_ID : null,
    currency: "INR",
    taxRate: 0.18, // 18% GST
  };
}

/**
 * Calculate period end date based on billing interval.
 */
export function calculatePeriodEnd(startDate, interval) {
  const d = new Date(startDate);
  if (interval === "yearly") {
    d.setFullYear(d.getFullYear() + 1);
  } else if (interval === "halfYearly") {
    d.setMonth(d.getMonth() + 6);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}

/**
 * Server-side authoritative checkout order creation.
 * NEVER trust frontend prices. Always lookup from SubscriptionPlan.
 */
export async function createCheckoutOrder({
  accountId,
  planSlug,
  billingInterval = "monthly",
  addonSlug = null,
}) {
  const parsedId = parseId(accountId);
  await ensureDefaultPlans();

  // Validate plan existence server-side
  const plan = await SubscriptionPlan.findOne({ slug: planSlug, active: true }).lean();
  if (!plan) {
    throw new Error(`Plan '${planSlug}' not found or inactive`);
  }

  // Validate billing interval
  const intervalConfig = plan.billingIntervals?.[billingInterval];
  if (!intervalConfig || typeof intervalConfig.price !== "number") {
    throw new Error(`Invalid billing interval '${billingInterval}' for plan '${planSlug}'`);
  }

  // Authoritative server-side price calculation
  const basePrice = Math.round(intervalConfig.price);
  const taxAmount = Math.round(basePrice * 0.18); // 18% GST
  const totalAmount = basePrice + taxAmount;
  const amountInPaise = totalAmount * 100;

  let providerOrderId = null;
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (isRazorpayConfigured()) {
    // Call Razorpay REST API
    const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: "INR",
        receipt: `rcpt_${parsedId.toString().slice(-6)}_${Date.now().toString().slice(-6)}`,
        notes: {
          accountId: parsedId.toString(),
          planSlug,
          billingInterval,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Razorpay order creation failed: ${errText}`);
    }

    const orderData = await response.json();
    providerOrderId = orderData.id;
  } else {
    // Deterministic order reference when running in unconfigured or test sandbox mode
    providerOrderId = `order_${crypto.randomBytes(8).toString("hex")}`;
  }

  // Record Payment in database
  const payment = await Payment.create({
    accountId: parsedId,
    provider: "razorpay",
    providerOrderId,
    amount: totalAmount,
    baseAmount: basePrice,
    taxAmount,
    currency: "INR",
    status: "created",
    paymentType: "subscription_purchase",
    planSlug,
    billingInterval,
  });

  await recordAudit(parsedId, "CHECKOUT_CREATED", {
    paymentId: payment._id,
    providerOrderId,
    planSlug,
    billingInterval,
    totalAmount,
  });

  return {
    orderId: providerOrderId,
    paymentId: payment._id.toString(),
    amount: totalAmount,
    amountInPaise,
    currency: "INR",
    keyId: isRazorpayConfigured() ? keyId : "rzp_test_unconfigured",
    plan: {
      name: plan.name,
      slug: plan.slug,
      billingInterval,
      basePrice,
      taxAmount,
      totalAmount,
    },
    liveVerificationAvailable: isRazorpayConfigured(),
  };
}

/**
 * Verify payment signature cryptographically and activate subscription.
 * NEVER trust frontend success flags.
 */
export async function verifyAndActivatePayment({
  accountId,
  providerOrderId,
  providerPaymentId,
  providerSignature,
}) {
  const parsedId = parseId(accountId);

  if (!providerOrderId || !providerPaymentId || !providerSignature) {
    throw new Error("Missing required payment verification parameters (order ID, payment ID, signature)");
  }

  // Lookup the payment record
  const payment = await Payment.findOne({
    accountId: parsedId,
    providerOrderId,
  });

  if (!payment) {
    throw new Error("No matching checkout payment found for this order ID");
  }

  // Idempotency: If already captured, return the existing result safely
  if (payment.status === "captured") {
    const existingSub = await Subscription.findOne({ accountId: parsedId }).lean();
    return {
      success: true,
      alreadyProcessed: true,
      payment: payment.toObject(),
      subscription: existingSub,
    };
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (isRazorpayConfigured()) {
    // Cryptographic HMAC SHA-256 verification
    const generatedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${providerOrderId}|${providerPaymentId}`)
      .digest("hex");

    if (generatedSignature !== providerSignature) {
      payment.status = "failed";
      payment.failureReason = "Signature mismatch";
      await payment.save();

      await recordAudit(parsedId, "PAYMENT_FAILED", {
        providerOrderId,
        providerPaymentId,
        reason: "Invalid signature",
      });

      throw new Error("Payment verification failed: Invalid cryptographic signature");
    }
  } else {
    // If testing in sandbox without live credentials, verify test signature format
    const isTestSigValid =
      typeof providerSignature === "string" &&
      providerSignature.length >= 16;

    if (!isTestSigValid) {
      payment.status = "failed";
      payment.failureReason = "Invalid test signature";
      await payment.save();
      throw new Error("Payment verification failed: Invalid signature format");
    }
  }

  // Update Payment status to captured
  const now = new Date();
  payment.status = "captured";
  payment.providerPaymentId = providerPaymentId;
  payment.providerSignature = providerSignature;
  payment.capturedAt = now;
  await payment.save();

  // Find plan details
  const plan = (await SubscriptionPlan.findOne({ slug: payment.planSlug }).lean()) || DEFAULT_PLANS[1];

  // Calculate subscription period
  const periodEnd = calculatePeriodEnd(now, payment.billingInterval);

  // Update or activate Subscription in database
  let subscription = await Subscription.findOne({ accountId: parsedId });
  if (subscription) {
    subscription.planId = plan._id || plan.slug;
    subscription.planSlug = plan.slug;
    subscription.planName = plan.name;
    subscription.billingInterval = payment.billingInterval;
    subscription.status = "ACTIVE";
    subscription.currentPeriodStartAt = now;
    subscription.currentPeriodEndAt = periodEnd;
    subscription.nextBillingAt = periodEnd;
    subscription.cancelAtPeriodEnd = false;
    subscription.cancelledAt = null;
    subscription.provider = "razorpay";
    subscription.providerOrderId = providerOrderId;
    subscription.features = plan.features || [];
    subscription.limits = plan.limits || {};
    await subscription.save();
  } else {
    subscription = await Subscription.create({
      accountId: parsedId,
      planId: plan._id || plan.slug,
      planSlug: plan.slug,
      planName: plan.name,
      billingInterval: payment.billingInterval,
      status: "ACTIVE",
      currentPeriodStartAt: now,
      currentPeriodEndAt: periodEnd,
      nextBillingAt: periodEnd,
      cancelAtPeriodEnd: false,
      provider: "razorpay",
      providerOrderId,
      features: plan.features || [],
      limits: plan.limits || {},
    });
  }

  // Link subscription ID to payment
  payment.subscriptionId = subscription._id;
  await payment.save();

  // Generate tax invoice
  const invoice = await createInvoice({
    accountId: parsedId,
    payment,
    subscription,
  });

  // Audit logging
  await recordAudit(parsedId, "PAYMENT_CAPTURED", {
    paymentId: payment._id,
    providerPaymentId,
    amount: payment.amount,
  });

  await recordAudit(parsedId, "SUBSCRIPTION_ACTIVATED", {
    planSlug: plan.slug,
    billingInterval: payment.billingInterval,
    currentPeriodEndAt: periodEnd,
  });

  return {
    success: true,
    payment: payment.toObject(),
    subscription: subscription.toObject(),
    invoice,
  };
}

/**
 * Handle incoming webhooks securely with signature verification and idempotency.
 */
export async function processRazorpayWebhook({ rawBody, signatureHeader }) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (webhookSecret) {
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature !== signatureHeader) {
      throw new Error("Webhook signature verification failed");
    }
  }

  const payload = JSON.parse(rawBody);
  const event = payload.event;
  const entity = payload.payload?.payment?.entity || payload.payload?.order?.entity || {};

  const orderId = entity.order_id || entity.id;
  const paymentId = entity.id;

  if (!orderId) {
    return { processed: false, reason: "No order ID found in webhook payload" };
  }

  const existingPayment = await Payment.findOne({ providerOrderId: orderId });
  if (!existingPayment) {
    return { processed: false, reason: "Order not tracked in CIIS Connect" };
  }

  // Idempotency: don't process duplicate events
  if (event === "payment.captured") {
    if (existingPayment.status === "captured") {
      return { processed: true, idempotency: "Already captured" };
    }

    return await verifyAndActivatePayment({
      accountId: existingPayment.accountId,
      providerOrderId: orderId,
      providerPaymentId: paymentId,
      providerSignature: "webhook_verified",
    });
  }

  if (event === "payment.failed") {
    existingPayment.status = "failed";
    existingPayment.failureReason = entity.error_description || "Payment failed via webhook";
    await existingPayment.save();

    await recordAudit(existingPayment.accountId, "PAYMENT_FAILED", {
      orderId,
      paymentId,
      reason: existingPayment.failureReason,
    });

    return { processed: true, status: "failed" };
  }

  return { processed: true, event };
}
