import { Account } from "../models/account.js";
import { AccountMember } from "../models/account-member.js";
import { User } from "../models/user.js";

export async function getAccount(req, res) {
  const member = await AccountMember.findOne({ userId: req.userId }).lean();
  const account = member ? await Account.findById(member.accountId).lean() : null;
  if (!account || !member) return res.status(404).json({ error: "Account not found" });
  return res.json({
    account: {
      id: account._id.toString(),
      name: account.name,
      default_currency: account.defaultCurrency ?? "USD",
      role: member.role,
    },
  });
}

export async function updateAccount(req, res) {
  const member = await AccountMember.findOne({ userId: req.userId }).lean();
  if (!member) return res.status(404).json({ error: "Account not found" });
  const update = {};
  if (req.body?.name !== undefined) update.name = req.body.name;
  if (req.body?.default_currency !== undefined) update.defaultCurrency = req.body.default_currency;
  const account = await Account.findByIdAndUpdate(member.accountId, update, { new: true }).lean();
  return res.json({ account: { id: account._id.toString(), name: account.name, default_currency: account.defaultCurrency ?? "USD" } });
}

export async function listMembers(req, res) {
  const members = await AccountMember.find({ accountId: req.accountId }).lean();
  const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).lean();
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  return res.json({
    members: members.map((m) => {
      const user = userById.get(m.userId.toString());
      return {
        user_id: m.userId.toString(),
        full_name: user?.fullName ?? "",
        email: user?.email ?? "",
        avatar_url: user?.avatarUrl ?? null,
        account_role: m.role,
      };
    }),
  });
}

