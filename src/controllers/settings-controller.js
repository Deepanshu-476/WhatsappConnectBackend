import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const settingsController = resourceController(collections.settings, { listKey: "settings", minWriteRole: "admin" });
