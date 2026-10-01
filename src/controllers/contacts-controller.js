import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const contactsController = resourceController(collections.contacts, {
  listKey: "contacts",
  minWriteRole: "agent",
});

