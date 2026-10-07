import express from "express";

import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { requireLimit } from "../middleware/subscription-guard.js";
import { channelsController } from "../controllers/channels-controller.js";

const router = express.Router();

router.use(requireAuth);
router.use(attachAccount);

router.get("/onboarding-config", requireAccountRole("admin"), channelsController.onboardingConfig);
router.get("/", requireAccountRole("viewer"), channelsController.list);
router.post("/", requireAccountRole("admin"), requireLimit("maxChannels"), channelsController.create);
router.get("/:id", requireAccountRole("viewer"), channelsController.read);
router.patch("/:id", requireAccountRole("admin"), channelsController.update);
router.put("/:id", requireAccountRole("admin"), channelsController.update);
router.delete("/:id", requireAccountRole("admin"), channelsController.remove);
router.post("/:id/verify", requireAccountRole("admin"), channelsController.verify);
router.post("/:id/disconnect", requireAccountRole("admin"), channelsController.disconnect);
router.post("/:id/default", requireAccountRole("admin"), channelsController.setDefault);

export default router;
