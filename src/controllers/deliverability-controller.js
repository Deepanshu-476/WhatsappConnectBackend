import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const deliverabilityController = resourceController(collections.deliverabilityEvents, { listKey: "events", minWriteRole: "admin" });
