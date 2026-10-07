import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const leadsController = resourceController(collections.leads, { listKey: "leads", minWriteRole: "agent" });
