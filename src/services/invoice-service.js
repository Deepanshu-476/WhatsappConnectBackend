import crypto from "node:crypto";
import { BillingInvoice } from "../models/billing-invoice.js";
import { BusinessDetails } from "../models/business-details.js";
import { parseId } from "../utils/crud.js";

/**
 * Generate a unique sequential-style invoice number.
 */
export async function generateInvoiceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const randomSuffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `INV-${year}${month}-${randomSuffix}`;
}

/**
 * Create a billing invoice record from payment, subscription, and business details.
 */
export async function createInvoice({
  accountId,
  payment,
  subscription,
  businessDetails: explicitBiz = null,
}) {
  const parsedId = parseId(accountId);
  const invoiceNumber = await generateInvoiceNumber();

  const biz =
    explicitBiz ||
    (await BusinessDetails.findOne({ accountId: parsedId }).lean()) ||
    {};

  const baseAmount = Number(payment.baseAmount || payment.amount || 0);
  const taxAmount = Number(payment.taxAmount || 0);
  const totalAmount = Number(payment.amount || baseAmount + taxAmount);

  const billingPeriodStr = subscription.currentPeriodStartAt && subscription.currentPeriodEndAt
    ? `${new Date(subscription.currentPeriodStartAt).toLocaleDateString("en-IN")} to ${new Date(subscription.currentPeriodEndAt).toLocaleDateString("en-IN")}`
    : `${payment.billingInterval || "monthly"}`;

  const invoice = await BillingInvoice.create({
    invoiceNumber,
    accountId: parsedId,
    paymentId: payment._id || null,
    subscriptionId: subscription._id || null,
    type: payment.paymentType === "plan_upgrade" ? "Plan Upgrade" : "Subscription Purchase",
    companyName: biz.companyName || "CIIS Connect Customer",
    customerEmail: biz.billingEmail || "",
    billingAddress: biz.billingAddress || {},
    gstNumber: biz.gstNumber || "",
    planName: subscription.planName || payment.planSlug || "Professional Plan",
    billingPeriod: billingPeriodStr,
    baseAmount,
    taxAmount,
    totalAmount,
    currency: payment.currency || "INR",
    status: payment.status === "captured" ? "Paid" : "Pending",
    issuedAt: payment.capturedAt || new Date(),
    providerReference: payment.providerPaymentId || payment.providerOrderId || null,
  });

  return invoice.toObject();
}

/**
 * Render printable HTML for an invoice.
 */
export function generateInvoiceHtml(invoice) {
  const addr = invoice.billingAddress || {};
  const formattedAddress = [
    addr.street,
    addr.city,
    addr.state,
    addr.postalCode,
    addr.country,
  ]
    .filter(Boolean)
    .join(", ");

  const issuedDate = new Date(invoice.issuedAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoiceNumber} - CIIS Connect</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 40px;
      color: #1e293b;
      background-color: #fff;
    }
    .invoice-card {
      max-width: 800px;
      margin: 0 auto;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #f1f5f9;
      padding-bottom: 24px;
    }
    .brand-title {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.02em;
    }
    .brand-subtitle {
      font-size: 13px;
      color: #64748b;
      margin-top: 4px;
    }
    .invoice-badge {
      text-align: right;
    }
    .invoice-badge h2 {
      margin: 0;
      font-size: 22px;
      color: #0f172a;
    }
    .invoice-badge .num {
      font-family: monospace;
      font-size: 14px;
      color: #2563eb;
      font-weight: 600;
      margin-top: 4px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin: 32px 0;
    }
    .meta-col h3 {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin: 0 0 8px 0;
    }
    .meta-col p {
      margin: 0 0 4px 0;
      font-size: 14px;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 32px 0;
    }
    th {
      background: #f8fafc;
      padding: 12px 16px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 16px;
      font-size: 14px;
      border-bottom: 1px solid #f1f5f9;
    }
    .text-right {
      text-align: right;
    }
    .totals {
      width: 300px;
      margin-left: auto;
      margin-top: 16px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 14px;
      color: #64748b;
    }
    .totals-row.grand-total {
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      border-top: 2px solid #e2e8f0;
      padding-top: 12px;
      margin-top: 6px;
    }
    .status-tag {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      background: #dcfce7;
      color: #15803d;
    }
    .footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #f1f5f9;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
    }
    @media print {
      body { padding: 0; background: none; }
      .invoice-card { border: none; box-shadow: none; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="invoice-card">
    <div class="header">
      <div>
        <div class="brand-title">CIIS Connect</div>
        <div class="brand-subtitle">WhatsApp Business Automation & CRM Platform</div>
      </div>
      <div class="invoice-badge">
        <h2>TAX INVOICE</h2>
        <div class="num">${invoice.invoiceNumber}</div>
        <div style="margin-top: 6px;"><span class="status-tag">${invoice.status}</span></div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-col">
        <h3>Billed To</h3>
        <p><strong>${invoice.companyName || "Valued Customer"}</strong></p>
        ${formattedAddress ? `<p>${formattedAddress}</p>` : ""}
        ${invoice.customerEmail ? `<p>Email: ${invoice.customerEmail}</p>` : ""}
        ${invoice.gstNumber ? `<p><strong>GSTIN:</strong> ${invoice.gstNumber}</p>` : ""}
      </div>
      <div class="meta-col" style="text-align: right;">
        <h3>Invoice Details</h3>
        <p><strong>Date Issued:</strong> ${issuedDate}</p>
        <p><strong>Billing Period:</strong> ${invoice.billingPeriod || "N/A"}</p>
        ${invoice.providerReference ? `<p><strong>Transaction Ref:</strong> ${invoice.providerReference}</p>` : ""}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item & Description</th>
          <th>Period</th>
          <th class="text-right">Amount (INR)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>${invoice.planName}</strong>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">CIIS Connect Cloud Subscription</div>
          </td>
          <td>${invoice.billingPeriod || "1 Month"}</td>
          <td class="text-right">₹${Number(invoice.baseAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>₹${Number(invoice.baseAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="totals-row">
        <span>GST (18%)</span>
        <span>₹${Number(invoice.taxAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="totals-row grand-total">
        <span>Total Paid</span>
        <span>₹${Number(invoice.totalAmount).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
      </div>
    </div>

    <div class="footer">
      <p>Thank you for choosing CIIS Connect. For billing inquiries, contact billing@ciisconnect.com</p>
      <p>This is a computer-generated tax invoice. No signature is required.</p>
    </div>
  </div>
</body>
</html>`;
}
