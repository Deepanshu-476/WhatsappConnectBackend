import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const flowsController = resourceController(collections.flows, {
  listKey: "flows",
  minWriteRole: "agent",
  defaults: { is_active: false },
});

