import { resourceController } from "./resource-controller.js";
import { collections } from "../models/collection-models.js";

export const channelsController = resourceController(collections.channelConfigs, { listKey: "channels", minWriteRole: "admin" });
