import mongoose from "mongoose";

export const SUBSCRIPTION_STATUSES = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAYMENT_FAILED",
  "CANCELLED",
  "EXPIRED",
  "SUSPENDED",
];

export const BILLING_INTERVALS = ["monthly", "halfYearly", "yearly"];

const subscriptionSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    planSlug: {
      type: String,
      required: true,
      trim: true,
    },
    planName: {
      type: String,
      required: true,
      trim: true,
    },
    billingInterval: {
      type: String,
      enum: BILLING_INTERVALS,
      default: "monthly",
    },
    status: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: "TRIALING",
      index: true,
    },
    trialStartAt: {
      type: Date,
      default: null,
    },
    trialEndAt: {
      type: Date,
      default: null,
    },
    currentPeriodStartAt: {
      type: Date,
      default: null,
    },
    currentPeriodEndAt: {
      type: Date,
      default: null,
      index: true,
    },
    nextBillingAt: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    provider: {
      type: String,
      default: "razorpay",
    },
    providerCustomerId: {
      type: String,
      default: null,
    },
    providerSubscriptionId: {
      type: String,
      default: null,
      index: true,
    },
    providerOrderId: {
      type: String,
      default: null,
      index: true,
    },
    addons: {
      type: [
        {
          slug: String,
          name: String,
          quantity: { type: Number, default: 1 },
          price: Number,
          interval: { type: String, default: "monthly" },
          activatedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    features: {
      type: [String],
      default: [],
    },
    limits: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

subscriptionSchema.index({ accountId: 1, status: 1 });

export const Subscription = mongoose.model("Subscription", subscriptionSchema);
