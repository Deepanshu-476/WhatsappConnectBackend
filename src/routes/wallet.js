import express from "express";
import { walletController } from "../controllers/wallet-controller.js";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount } from "../middleware/account-context.js";
import { resourceRoute } from "./resource-route.js";

const router = express.Router();
router.get("/balance", requireAuth, attachAccount, walletController.balance);
router.use("/", resourceRoute(walletController));
export default router;
