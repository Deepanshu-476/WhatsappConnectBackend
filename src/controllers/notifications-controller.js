import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const notificationsController = resourceController(collections.notifications, { listKey: "notifications", minWriteRole: "agent" });
