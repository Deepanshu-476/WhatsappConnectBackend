import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const tagsController = resourceController(collections.tags, {
  listKey: "tags",
  minWriteRole: "admin",
});

