import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { crmSettingsController } from "../controllers/crm-settings-controller.js";

const router = express.Router();

router.use(requireAuth);
router.use(attachAccount);

// Read settings - all account members can view settings according to their role
router.get("/", crmSettingsController.getSettings);

// Update settings - requires admin or owner role
router.put("/", requireAccountRole("admin"), crmSettingsController.updateSettings);

// Reset settings to default - requires admin or owner role
router.post("/reset", requireAccountRole("admin"), crmSettingsController.resetSettings);

// Testing utility actions
router.post("/test-integration", requireAccountRole("admin"), crmSettingsController.testIntegration);
router.post("/test-channel", requireAccountRole("admin"), crmSettingsController.testChannel);

export default router;
