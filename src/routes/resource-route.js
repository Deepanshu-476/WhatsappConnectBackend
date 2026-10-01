import express from "express";

import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";

export function resourceRoute(controller) {
  const router = express.Router();

  router.use(requireAuth);
  router.use(attachAccount);

  router.get("/", controller.list);
  router.post("/", requireAccountRole(controller.minWriteRole ?? "agent"), controller.create);
  router.get("/:id", controller.read);
  router.patch("/:id", requireAccountRole(controller.minWriteRole ?? "agent"), controller.update);
  router.put("/:id", requireAccountRole(controller.minWriteRole ?? "agent"), controller.update);
  router.delete("/:id", requireAccountRole(controller.minWriteRole ?? "agent"), controller.remove);

  return router;
}

