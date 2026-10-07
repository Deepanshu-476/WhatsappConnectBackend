import mongoose from "mongoose";

export const PAYMENT_STATUSES = [
  "created",
  "pending",
  "captured",
  "failed",
  "refunded",
];

export const PAYMENT_TYPES = [
  "subscription_purchase",
  "subscription_renewal",
  "plan_upgrade",
  "plan_downgrade",
  "addon_purchase",
  "refund",
];

const paymentSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      default: null,
      index: true,
    },
    provider: {
      type: String,
      default: "razorpay",
    },
    providerPaymentId: {
      type: String,
      default: null,
      sparse: true,
      index: true,
    },
    providerOrderId: {
      type: String,
      default: null,
      index: true,
    },
    providerSignature: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      required: true,
    },
    baseAmount: {
      type: Number,
      required: true,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: "created",
      index: true,
    },
    paymentType: {
      type: String,
      enum: PAYMENT_TYPES,
      default: "subscription_purchase",
    },
    planSlug: {
      type: String,
      default: null,
    },
    billingInterval: {
      type: String,
      default: "monthly",
    },
    paymentMethod: {
      type: String,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    capturedAt: {
      type: Date,
      default: null,
    },
    rawResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

paymentSchema.index({ accountId: 1, createdAt: -1 });

export const Payment = mongoose.model("Payment", paymentSchema);
