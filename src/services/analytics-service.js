import { collections } from "../models/collection-models.js";
import { accountScope, collection } from "../utils/crud.js";

export async function countCollection(collectionName, accountId, extra = {}) {
  return collection(collectionName).countDocuments({ ...extra, ...accountScope(accountId) });
}

export async function messageStatusCounts(accountId) {
  const rows = await collection(collections.messages).aggregate([
    { $match: accountScope(accountId) },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).toArray();
  return rows.reduce((acc, row) => {
    acc[row._id || "unknown"] = row.count;
    return acc;
  }, {});
}

export async function walletBalance(accountId) {
  const rows = await collection(collections.walletTransactions).aggregate([
    { $match: accountScope(accountId) },
    { $group: { _id: "$type", amount: { $sum: "$amount" } } },
  ]).toArray();
  return rows.reduce((total, row) => {
    const amount = Number(row.amount || 0);
    return row._id === "debit" ? total - amount : total + amount;
  }, 0);
}

export async function dashboardSummary(accountId) {
  const [contacts, conversations, campaigns, leads, unread, statuses, balance, invoices] = await Promise.all([
    countCollection(collections.contacts, accountId),
    countCollection(collections.conversations, accountId),
    countCollection(collections.campaigns, accountId),
    countCollection(collections.leads, accountId),
    countCollection(collections.conversations, accountId, { unread_count: { $gt: 0 } }),
    messageStatusCounts(accountId),
    walletBalance(accountId),
    collection(collections.billingInvoices).find(accountScope(accountId)).sort({ issued_at: -1, created_at: -1 }).limit(5).toArray(),
  ]);
  return {
    contacts,
    conversations,
    campaigns,
    leads,
    unread_conversations: unread,
    messages: statuses,
    wallet_balance: balance,
    recent_invoices: invoices,
  };
}
