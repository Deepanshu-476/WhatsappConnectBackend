import express from "express";
import { apiWebhookController, webhookDeliveryController } from "../controllers/api-webhook-controller.js";
import { resourceRoute } from "./resource-route.js";

const router = express.Router();
router.use("/deliveries", resourceRoute(webhookDeliveryController));
router.use("/", resourceRoute(apiWebhookController));
export default router;
