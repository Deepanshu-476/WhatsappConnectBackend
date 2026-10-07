import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { analyticsController } from "../controllers/analytics-controller.js";

const router = express.Router();
router.use(requireAuth);
router.use(attachAccount);
router.get("/", requireAccountRole("admin"), analyticsController.list);
router.get("/message-statuses", requireAccountRole("admin"), analyticsController.messageStatuses);
export default router;
