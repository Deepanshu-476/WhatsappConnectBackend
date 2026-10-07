import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const templatesController = resourceController(collections.whatsappTemplates, { listKey: "templates", minWriteRole: "admin" });
