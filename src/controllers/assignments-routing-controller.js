import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const assignmentsRoutingController = resourceController(collections.assignments, { listKey: "assignments", minWriteRole: "agent" });
