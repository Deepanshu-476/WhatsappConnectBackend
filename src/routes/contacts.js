import express from "express";

import { contactsController } from "../controllers/contacts-controller.js";
import { requireAuth } from "../middleware/auth.js";
import { attachAccount, requireAccountRole } from "../middleware/account-context.js";
import { accountScope, collection, parseId } from "../utils/crud.js";
const router = express.Router();

router.use(requireAuth);
router.use(attachAccount);

router.get("/:id/tags", async (req, res) => {
  const contact = await collection("contacts").findOne({ _id: parseId(req.params.id), ...accountScope(req.accountId) });
  if (!contact) return res.status(404).json({ error: "Contact not found" });
  const rows = await collection("contact_tags").find({ contact_id: req.params.id }).toArray();
  return res.json({ tags: rows });
});

router.post("/:id/tags", requireAccountRole("agent"), async (req, res) => {
  const tagIds = Array.isArray(req.body?.tag_ids) ? req.body.tag_ids : [];
  await collection("contact_tags").deleteMany({ contact_id: req.params.id });
  if (tagIds.length > 0) {
    await collection("contact_tags").insertMany(tagIds.map((tag_id) => ({ contact_id: req.params.id, tag_id, accountId: req.accountId })));
  }
  return res.json({ ok: true });
});

router.get("/", contactsController.list);
router.post("/", requireAccountRole(contactsController.minWriteRole), contactsController.create);
router.get("/:id", contactsController.read);
router.patch("/:id", requireAccountRole(contactsController.minWriteRole), contactsController.update);
router.put("/:id", requireAccountRole(contactsController.minWriteRole), contactsController.update);
router.delete("/:id", requireAccountRole(contactsController.minWriteRole), contactsController.remove);

export default router;

