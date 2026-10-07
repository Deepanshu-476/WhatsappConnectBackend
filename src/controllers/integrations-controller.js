import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const integrationsController = resourceController(collections.integrations, { listKey: "integrations", minWriteRole: "admin" });
