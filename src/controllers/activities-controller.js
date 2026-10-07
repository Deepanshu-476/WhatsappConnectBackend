import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const activitiesController = resourceController(collections.activities, { listKey: "activities", minWriteRole: "agent" });
