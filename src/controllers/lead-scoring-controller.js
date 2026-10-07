import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const leadScoringController = resourceController(collections.leadScores, { listKey: "scores", minWriteRole: "admin" });
