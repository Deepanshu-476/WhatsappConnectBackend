import mongoose from "mongoose";

const businessDetailsSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      unique: true,
      index: true,
    },
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    billingAddress: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      postalCode: { type: String, default: "" },
      country: { type: String, default: "India" },
    },
    gstNumber: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },
    billingEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },
    contactPhone: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true },
);

export const BusinessDetails = mongoose.model(
  "BusinessDetails",
  businessDetailsSchema,
);
