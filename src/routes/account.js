import express from "express";

import { getAccount, listMembers, updateAccount } from "../controllers/account-controller.js";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";

const router = express.Router();

router.use(requireAuth);
router.use(attachAccount);

router.get("/", getAccount);
router.patch("/", requireAccountRole("admin"), updateAccount);
router.get("/members", listMembers);

export default router;

