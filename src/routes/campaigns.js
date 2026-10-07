import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { requireFeature } from "../middleware/subscription-guard.js";
import { campaignsController } from "../controllers/campaigns-controller.js";

const router = express.Router();

router.use(requireAuth);
router.use(attachAccount);

// Collection operations
router.get("/", requireAccountRole("viewer"), campaignsController.listCampaigns);
router.post("/", requireAccountRole("agent"), requireFeature("campaigns"), campaignsController.createCampaign);
router.post("/validate-audience", requireAccountRole("agent"), campaignsController.validateAudienceEndpoint);

// Single campaign operations
router.get("/:id", requireAccountRole("viewer"), campaignsController.getCampaign);
router.put("/:id", requireAccountRole("agent"), campaignsController.updateCampaign);
router.delete("/:id", requireAccountRole("agent"), campaignsController.deleteCampaign);
router.post("/:id/duplicate", requireAccountRole("agent"), campaignsController.duplicateCampaign);

// Lifecycle actions
router.post("/:id/start", requireAccountRole("agent"), campaignsController.startCampaign);
router.post("/:id/pause", requireAccountRole("agent"), campaignsController.pauseCampaign);
router.post("/:id/resume", requireAccountRole("agent"), campaignsController.resumeCampaign);
router.post("/:id/stop", requireAccountRole("agent"), campaignsController.stopCampaign);
router.post("/:id/retry", requireAccountRole("agent"), campaignsController.retryFailed);

// Analytics
router.get("/:id/analytics", requireAccountRole("viewer"), campaignsController.getAnalytics);

export default router;
