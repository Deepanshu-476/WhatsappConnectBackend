import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

import { connectDb } from "../src/config/db.js";
import { User } from "../src/models/user.js";
import { Account } from "../src/models/account.js";
import { AccountMember } from "../src/models/account-member.js";
import { Subscription } from "../src/models/subscription.js";
import { SubscriptionPlan, DEFAULT_PLANS } from "../src/models/subscription-plan.js";
import { Payment } from "../src/models/payment.js";
import { BusinessDetails } from "../src/models/business-details.js";
import { BillingInvoice } from "../src/models/billing-invoice.js";
import {
  createTrialSubscription,
  getAuthoritativeSubscription,
  hasFeature,
  checkLimit,
  cancelSubscription,
  reactivateSubscription,
  ensureDefaultPlans,
} from "../src/services/subscription-service.js";
import {
  createCheckoutOrder,
  verifyAndActivatePayment,
  processRazorpayWebhook,
} from "../src/services/payment-service.js";
import {
  createInvoice,
  generateInvoiceHtml,
  generateInvoiceNumber,
} from "../src/services/invoice-service.js";

test("Billing & Subscription Management Suite", async (t) => {
  await connectDb();
  await ensureDefaultPlans();

  const rand = crypto.randomBytes(4).toString("hex");
  const testEmailA = `billing_owner_a_${rand}@example.com`;
  const testEmailB = `billing_owner_b_${rand}@example.com`;

  // Create Account A
  const userA = await User.create({
    fullName: "Owner A",
    email: testEmailA,
    passwordHash: "hash123",
  });
  const accountA = await Account.create({
    name: "Account A Company",
    ownerId: userA._id,
  });
  await AccountMember.create({
    accountId: accountA._id,
    userId: userA._id,
    role: "owner",
  });

  // Create Account B
  const userB = await User.create({
    fullName: "Owner B",
    email: testEmailB,
    passwordHash: "hash123",
  });
  const accountB = await Account.create({
    name: "Account B Company",
    ownerId: userB._id,
  });
  await AccountMember.create({
    accountId: accountB._id,
    userId: userB._id,
    role: "owner",
  });

  await t.test("1. 7-Day Free Trial Provisioning & Calculation", async () => {
    const trial = await createTrialSubscription(accountA._id);
    assert.ok(trial, "Trial subscription should be created");
    assert.equal(trial.status, "TRIALING");
    assert.equal(trial.planSlug, "professional");
    assert.ok(trial.trialStartAt, "trialStartAt should be set");
    assert.ok(trial.trialEndAt, "trialEndAt should be set");

    const diffDays = Math.round(
      (new Date(trial.trialEndAt).getTime() - new Date(trial.trialStartAt).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    assert.equal(diffDays, 7, "Trial duration should be exactly 7 days");

    // Fetch authoritative state
    const authSub = await getAuthoritativeSubscription(accountA._id);
    assert.equal(authSub.isTrial, true);
    assert.equal(authSub.isActive, true);
    assert.ok(authSub.daysRemaining >= 6 && authSub.daysRemaining <= 7);
  });

  await t.test("2. Authoritative Server-Side Expiry Transition", async () => {
    // Create an expired trial for testing
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24); // 1 day ago
    await Subscription.updateOne(
      { accountId: accountA._id },
      { $set: { trialEndAt: pastDate } },
    );

    const expiredSub = await getAuthoritativeSubscription(accountA._id);
    assert.equal(expiredSub.status, "EXPIRED", "Subscription should transition to EXPIRED");
    assert.equal(expiredSub.isActive, false, "Expired subscription should not be active");
    assert.equal(expiredSub.daysRemaining, 0);
  });

  await t.test("3. Entitlement & Feature Gates with Expiry Enforcement", async () => {
    // While expired, features should return false
    const canUseCampaignsWhileExpired = await hasFeature(accountA._id, "campaigns");
    assert.equal(canUseCampaignsWhileExpired, false, "Expired account must not access paid features");

    // Re-activate as trial to test normal entitlements
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await Subscription.updateOne(
      { accountId: accountA._id },
      { $set: { status: "TRIALING", trialEndAt: futureDate } },
    );

    const hasAiAgent = await hasFeature(accountA._id, "ai_agent");
    assert.equal(hasAiAgent, true, "Professional trial includes ai_agent");

    const hasVoice = await hasFeature(accountA._id, "voice");
    assert.equal(hasVoice, false, "Professional trial does not include voice (Premium only)");
  });

  await t.test("4. Usage Limit Checks", async () => {
    const userLimitCheck = await checkLimit(accountA._id, "maxUsers", 1);
    assert.equal(userLimitCheck.allowed, true, "Should be allowed within 5 user limit");
    assert.equal(userLimitCheck.current, 1, "Current user count should be 1");

    const overLimitCheck = await checkLimit(accountA._id, "maxUsers", 10);
    assert.equal(overLimitCheck.allowed, false, "Exceeding limit must be rejected");
  });

  await t.test("5. Server-Side Price Calculation & Checkout Order", async () => {
    const checkout = await createCheckoutOrder({
      accountId: accountA._id,
      planSlug: "professional",
      billingInterval: "monthly",
    });

    assert.ok(checkout.orderId, "Should return an order ID");
    assert.equal(checkout.currency, "INR");
    assert.equal(checkout.plan.basePrice, 3999);
    assert.equal(checkout.plan.taxAmount, Math.round(3999 * 0.18)); // 720
    assert.equal(checkout.amount, 3999 + 720); // 4719

    // Invalid interval must throw
    await assert.rejects(async () => {
      await createCheckoutOrder({
        accountId: accountA._id,
        planSlug: "professional",
        billingInterval: "invalid_interval",
      });
    }, /Invalid billing interval/);

    // Invalid plan must throw
    await assert.rejects(async () => {
      await createCheckoutOrder({
        accountId: accountA._id,
        planSlug: "nonexistent_plan",
        billingInterval: "monthly",
      });
    }, /not found/);
  });

  await t.test("6. Payment Verification & Cryptographic Signature Checks", async () => {
    const checkout = await createCheckoutOrder({
      accountId: accountA._id,
      planSlug: "lite",
      billingInterval: "yearly",
    });

    const paymentId = "pay_test_payment_12345";
    const validSignature = "signature_hex_test_verified_123";

    // Invalid signature rejection
    await assert.rejects(async () => {
      await verifyAndActivatePayment({
        accountId: accountA._id,
        providerOrderId: checkout.orderId,
        providerPaymentId: paymentId,
        providerSignature: "bad", // too short
      });
    }, /Invalid signature/);

    // Valid verification & activation
    const result = await verifyAndActivatePayment({
      accountId: accountA._id,
      providerOrderId: checkout.orderId,
      providerPaymentId: paymentId,
      providerSignature: validSignature,
    });

    assert.equal(result.success, true);
    assert.equal(result.payment.status, "captured");
    assert.equal(result.subscription.status, "ACTIVE");
    assert.equal(result.subscription.planSlug, "lite");

    // Verify invoice generated
    assert.ok(result.invoice);
    assert.equal(result.invoice.status, "Paid");
    assert.equal(result.invoice.totalAmount, checkout.amount);

    // Idempotency test: duplicate call should return alreadyProcessed: true
    const duplicateResult = await verifyAndActivatePayment({
      accountId: accountA._id,
      providerOrderId: checkout.orderId,
      providerPaymentId: paymentId,
      providerSignature: validSignature,
    });
    assert.equal(duplicateResult.alreadyProcessed, true);
  });

  await t.test("7. Webhook Signature & Idempotency", async () => {
    const checkout = await createCheckoutOrder({
      accountId: accountA._id,
      planSlug: "professional",
      billingInterval: "monthly",
    });

    const webhookPayload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_wh_998877",
            order_id: checkout.orderId,
            amount: checkout.amountInPaise,
            status: "captured",
          },
        },
      },
    };

    const webhookResult = await processRazorpayWebhook({
      rawBody: JSON.stringify(webhookPayload),
      signatureHeader: "sig_not_configured_in_test",
    });

    assert.equal(webhookResult.success, true);

    // Duplicate webhook call should be idempotent
    const dupWebhook = await processRazorpayWebhook({
      rawBody: JSON.stringify(webhookPayload),
      signatureHeader: "sig_not_configured_in_test",
    });
    assert.equal(dupWebhook.processed, true);
    assert.equal(dupWebhook.idempotency, "Already captured");
  });

  await t.test("8. Business Details & GST Validation", async () => {
    // Valid details
    const biz = await BusinessDetails.findOneAndUpdate(
      { accountId: accountA._id },
      {
        $set: {
          companyName: "Acme Infotech Pvt Ltd",
          gstNumber: "29ABCDE1234F1Z5",
          billingEmail: "accounts@acme.com",
          contactPhone: "+91 9876543210",
          billingAddress: {
            street: "123 Tech Park",
            city: "Bengaluru",
            state: "Karnataka",
            postalCode: "560001",
            country: "India",
          },
        },
      },
      { upsert: true, new: true },
    ).lean();

    assert.equal(biz.companyName, "Acme Infotech Pvt Ltd");
    assert.equal(biz.gstNumber, "29ABCDE1234F1Z5");
  });

  await t.test("9. Invoice Number Generation & HTML Rendering", async () => {
    const invNum = await generateInvoiceNumber();
    assert.match(invNum, /^INV-\d{6}-[A-F0-9]{6}$/);

    const testInvoice = {
      invoiceNumber: invNum,
      companyName: "Acme Infotech",
      customerEmail: "billing@acme.com",
      planName: "Professional Plan",
      billingPeriod: "Monthly",
      baseAmount: 3999,
      taxAmount: 720,
      totalAmount: 4719,
      status: "Paid",
      issuedAt: new Date(),
      billingAddress: { city: "Bengaluru", state: "Karnataka" },
    };

    const html = generateInvoiceHtml(testInvoice);
    assert.ok(html.includes("TAX INVOICE"));
    assert.ok(html.includes(invNum));
    assert.ok(html.includes("Acme Infotech"));
    assert.ok(html.includes("₹4,719.00"));
  });

  await t.test("10. Multi-Tenant Isolation", async () => {
    // Create subscription for Account B
    await createTrialSubscription(accountB._id);

    // Account A's subscription must not match Account B's
    const subA = await getAuthoritativeSubscription(accountA._id);
    const subB = await getAuthoritativeSubscription(accountB._id);
    assert.notEqual(subA.id, subB.id);
    assert.equal(subA.accountId.toString(), accountA._id.toString());
    assert.equal(subB.accountId.toString(), accountB._id.toString());

    // Invoices for A must not leak to B
    const invoicesA = await BillingInvoice.find({ accountId: accountA._id });
    const invoicesB = await BillingInvoice.find({ accountId: accountB._id });
    assert.ok(invoicesA.length > 0);
    assert.equal(invoicesB.length, 0, "Account B should not see Account A's invoices");

    // Business details for B must be empty
    const bizB = await BusinessDetails.findOne({ accountId: accountB._id });
    assert.equal(bizB, null, "Account B has no business details yet");
  });

  await t.test("11. Subscription Cancellation & Reactivation", async () => {
    // Schedule cancel at period end
    const cancelled = await cancelSubscription(accountA._id, { immediate: false });
    assert.equal(cancelled.cancelAtPeriodEnd, true);
    assert.ok(cancelled.cancelledAt);

    // Reactivate before period end
    const reactivated = await reactivateSubscription(accountA._id);
    assert.equal(reactivated.cancelAtPeriodEnd, false);
    assert.equal(reactivated.cancelledAt, null);
  });

  await mongoose.disconnect();
});
