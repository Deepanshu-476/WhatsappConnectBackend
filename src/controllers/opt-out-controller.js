import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const optOutController = resourceController(collections.optOuts, { listKey: "opt_outs", minWriteRole: "admin" });
