import express from "express";

import { flowsController } from "../controllers/flows-controller.js";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";

const router = express.Router();
router.get("/templates", (_req, res) => {
  res.json({
    templates: [
      {
        id: "lead-qualification",
        name: "Lead qualification",
        description: "Ask a question, tag the contact, then hand off to an agent.",
        nodes: [],
        edges: [],
      },
      {
        id: "faq-menu",
        name: "FAQ menu",
        description: "Send a menu and route replies to answer nodes.",
        nodes: [],
        edges: [],
      },
    ],
  });
});

router.use(requireAuth);
router.use(attachAccount);

router.post("/:id/activate", requireAuth, attachAccount, requireAccountRole("agent"), async (req, res) => {
  req.body = { is_active: true };
  return flowsController.update(req, res);
});

router.get("/:id/runs", async (req, res) => {
  const { collection, accountScope } = await import("../utils/crud.js");
  const runs = await collection("flow_runs")
    .find({ flow_id: req.params.id, ...accountScope(req.accountId) })
    .sort({ created_at: -1, _id: -1 })
    .toArray();
  res.json({ runs: runs.map((run) => ({ ...run, id: run._id?.toString?.() ?? run.id })) });
});

router.get("/", flowsController.list);
router.post("/", requireAccountRole(flowsController.minWriteRole), flowsController.create);
router.get("/:id", flowsController.read);
router.patch("/:id", requireAccountRole(flowsController.minWriteRole), flowsController.update);
router.put("/:id", requireAccountRole(flowsController.minWriteRole), flowsController.update);
router.delete("/:id", requireAccountRole(flowsController.minWriteRole), flowsController.remove);

export default router;
