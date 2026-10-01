import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const quickRepliesController = resourceController(collections.quickReplies, {
  listKey: "quick_replies",
  minWriteRole: "agent",
  defaults: { is_active: true },
});

