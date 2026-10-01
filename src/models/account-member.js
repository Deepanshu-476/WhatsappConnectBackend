import mongoose from "mongoose";

export const ACCOUNT_ROLES = ["owner", "admin", "agent", "viewer"];

const accountMemberSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ACCOUNT_ROLES,
      default: "owner",
      required: true,
    },
  },
  { timestamps: true },
);

accountMemberSchema.index({ accountId: 1, userId: 1 }, { unique: true });

export const AccountMember = mongoose.model("AccountMember", accountMemberSchema);
