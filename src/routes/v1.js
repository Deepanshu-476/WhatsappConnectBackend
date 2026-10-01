import express from "express";

import { resourceController } from "../controllers/resource-controller.js";
import { collections } from "../models/collection-models.js";
import { resourceRoute } from "./resource-route.js";

const router = express.Router();

router.get("/me", (_req, res) => res.json({ ok: true }));
router.use("/contacts", resourceRoute(resourceController(collections.contacts, { listKey: "contacts", minWriteRole: "agent" })));
router.use("/conversations", resourceRoute(resourceController(collections.conversations, { listKey: "conversations", minWriteRole: "agent" })));
router.use("/webhooks", resourceRoute(resourceController(collections.webhooks, { listKey: "webhooks", minWriteRole: "admin" })));
router.use("/broadcasts", resourceRoute(resourceController(collections.broadcasts, { listKey: "broadcasts", minWriteRole: "agent" })));
router.post("/messages", (_req, res) => res.json({ ok: true }));

export default router;
