import express from "express";

import { flowsController } from "../controllers/flows-controller.js";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";

const router = express.Router();
router.get("/templates", (_req, res) => {
  res.json({ templates: [] });
});

router.use(requireAuth);
router.use(attachAccount);

router.post("/:id/activate", requireAuth, attachAccount, requireAccountRole("agent"), async (req, res) => {
  req.body = { is_active: true };
  return flowsController.update(req, res);
});

router.get("/:id/runs", (_req, res) => {
  res.json({ runs: [] });
});

router.get("/", flowsController.list);
router.post("/", requireAccountRole(flowsController.minWriteRole), flowsController.create);
router.get("/:id", flowsController.read);
router.patch("/:id", requireAccountRole(flowsController.minWriteRole), flowsController.update);
router.put("/:id", requireAccountRole(flowsController.minWriteRole), flowsController.update);
router.delete("/:id", requireAccountRole(flowsController.minWriteRole), flowsController.remove);

export default router;

