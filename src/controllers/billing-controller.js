import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const billingController = resourceController(collections.billingInvoices, {
  listKey: "invoices",
  minWriteRole: "admin",
  sortable: { issued_at: -1, created_at: -1, _id: -1 },
});
