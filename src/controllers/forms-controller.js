import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const formsController = resourceController(collections.forms, { listKey: "forms", minWriteRole: "admin" });
export const formSubmissionsController = resourceController(collections.formSubmissions, { listKey: "submissions", minWriteRole: "agent" });
