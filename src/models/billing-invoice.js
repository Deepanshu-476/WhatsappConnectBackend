import mongoose from "mongoose";

const billingInvoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      default: null,
    },
    type: {
      type: String,
      default: "Subscription Purchase",
    },
    companyName: {
      type: String,
      default: "",
    },
    customerEmail: {
      type: String,
      default: "",
    },
    billingAddress: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    gstNumber: {
      type: String,
      default: "",
    },
    planName: {
      type: String,
      required: true,
    },
    billingPeriod: {
      type: String,
      default: "",
    },
    baseAmount: {
      type: Number,
      required: true,
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    status: {
      type: String,
      enum: ["Paid", "Pending", "Failed", "Refunded"],
      default: "Paid",
    },
    issuedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    providerReference: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "billing_invoices",
  },
);

billingInvoiceSchema.index({ accountId: 1, issuedAt: -1 });

export const BillingInvoice = mongoose.model(
  "BillingInvoice",
  billingInvoiceSchema,
);
