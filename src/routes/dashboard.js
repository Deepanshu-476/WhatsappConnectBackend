import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount } from "../middleware/account-context.js";
import { dashboardController } from "../controllers/dashboard-controller.js";

const router = express.Router();
router.use(requireAuth);
router.use(attachAccount);
router.get("/", dashboardController.list);
export default router;
