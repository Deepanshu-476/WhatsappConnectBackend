import { collections } from "../models/collection-models.js";
import { accountScope, collection, parseId, publicDoc, timestamps } from "../utils/crud.js";
import { resourceController } from "./resource-controller.js";
import { verifyWhatsAppChannel } from "../services/whatsapp-service.js";

const baseController = resourceController(collections.channelConfigs, {
  listKey: "channels",
  minWriteRole: "admin",
});

function normalizeChannelPayload(body = {}, isNew = false) {
  const payload = { ...body };
  delete payload.connected;
  delete payload.connectionStatus;
  delete payload.health;
  delete payload.qualityRating;
  delete payload.messagingLimit;
  delete payload.lastSynchronization;
  delete payload.last_sync;

  if (isNew) {
    payload.status = "configuration_required";
    payload.connectionState = "configuration_required";
    payload.webhookStatus = "unknown";
    payload.isDefault = Boolean(payload.isDefault);
  } else {
    delete payload.status;
    delete payload.connectionState;
  }

  return payload;
}

export const channelsController = {
  ...baseController,

  async create(req, res) {
    req.body = normalizeChannelPayload(req.body, true);
    return baseController.create(req, res);
  },

  async update(req, res) {
    req.body = normalizeChannelPayload(req.body, false);
    return baseController.update(req, res);
  },

  async verify(req, res) {
    try {
      const channel = await collection(collections.channelConfigs).findOne({
        _id: parseId(req.params.id),
        ...accountScope(req.accountId),
      });
      if (!channel) return res.status(404).json({ error: "Channel not found" });

      const verification = await verifyWhatsAppChannel(channel);
      const now = new Date().toISOString();
      const update = {
        status: verification.status,
        connectionState: verification.connectionState,
        webhookStatus: verification.webhookStatus,
        healthMessage: verification.message,
        lastSynchronization: now,
        updated_at: now,
        ...(verification.ok ? {
          phoneNumber: verification.phoneNumber || channel.phoneNumber,
          phoneNumberId: verification.phoneNumberId || channel.phoneNumberId,
          wabaId: verification.wabaId || channel.wabaId,
          displayName: verification.displayName || channel.displayName,
          businessName: verification.businessName || channel.businessName,
          qualityRating: verification.qualityRating,
          messagingLimit: verification.messagingLimit,
          nameStatus: verification.nameStatus,
          connectedAt: channel.connectedAt || now,
        } : {}),
      };

      const result = await collection(collections.channelConfigs).findOneAndUpdate(
        { _id: channel._id, ...accountScope(req.accountId) },
        { $set: update },
        { returnDocument: "after" },
      );

      return res.status(verification.ok ? 200 : 424).json({
        ok: verification.ok,
        verification,
        channel: publicDoc(result),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Channel verification failed" });
    }
  },

  async disconnect(req, res) {
    try {
      const result = await collection(collections.channelConfigs).findOneAndUpdate(
        { _id: parseId(req.params.id), ...accountScope(req.accountId) },
        {
          $set: {
            status: "disconnected",
            connectionState: "disconnected",
            isDefault: false,
            disconnectedAt: new Date().toISOString(),
            ...timestamps(false),
          },
        },
        { returnDocument: "after" },
      );
      if (!result) return res.status(404).json({ error: "Channel not found" });
      return res.json({ ok: true, channel: publicDoc(result) });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to disconnect channel" });
    }
  },

  async setDefault(req, res) {
    try {
      const channel = await collection(collections.channelConfigs).findOne({
        _id: parseId(req.params.id),
        ...accountScope(req.accountId),
      });
      if (!channel) return res.status(404).json({ error: "Channel not found" });
      if (channel.status !== "connected") {
        return res.status(409).json({ error: "Only a verified connected channel can be set as default" });
      }

      await collection(collections.channelConfigs).updateMany(accountScope(req.accountId), {
        $set: { isDefault: false, ...timestamps(false) },
      });
      const result = await collection(collections.channelConfigs).findOneAndUpdate(
        { _id: channel._id, ...accountScope(req.accountId) },
        { $set: { isDefault: true, ...timestamps(false) } },
        { returnDocument: "after" },
      );
      return res.json({ ok: true, channel: publicDoc(result) });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to set default channel" });
    }
  },

  async onboardingConfig(_req, res) {
    const required = ["META_APP_ID", "META_CONFIG_ID", "META_REDIRECT_URI"];
    const missing = required.filter((key) => !process.env[key]);
    return res.status(missing.length ? 424 : 200).json({
      ok: missing.length === 0,
      status: missing.length ? "configuration_required" : "ready",
      embeddedSignup: {
        appId: process.env.META_APP_ID || "",
        configId: process.env.META_CONFIG_ID || "",
        redirectUri: process.env.META_REDIRECT_URI || "",
      },
      missing,
    });
  },
};
