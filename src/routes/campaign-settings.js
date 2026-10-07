import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { campaignSettingsController } from "../controllers/campaign-settings-controller.js";

const router = express.Router();

router.use(requireAuth);
router.use(attachAccount);

// Settings read & update
router.get("/", requireAccountRole("viewer"), campaignSettingsController.getSettings);
router.put("/", requireAccountRole("admin"), campaignSettingsController.updateSettings);
router.post("/reset", requireAccountRole("admin"), campaignSettingsController.resetSettings);

// Opt-out management
router.get("/opt-outs", requireAccountRole("viewer"), campaignSettingsController.getOptOutList);
router.delete("/opt-outs/:id", requireAccountRole("admin"), campaignSettingsController.removeOptOut);

// Channel & Integration testing
router.post("/test-channel", requireAccountRole("admin"), campaignSettingsController.testChannel);
router.post("/test-integration", requireAccountRole("admin"), campaignSettingsController.testIntegration);

export default router;
