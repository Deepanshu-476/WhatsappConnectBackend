import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const apiWebhookController = resourceController(collections.webhooks, { listKey: "webhooks", minWriteRole: "admin" });
export const webhookDeliveryController = resourceController(collections.webhookDeliveries, { listKey: "deliveries", minWriteRole: "admin" });
