import mongoose from "mongoose";
import { collection, accountScope, parseId, timestamps } from "../utils/crud.js";
import { collections } from "../models/collection-models.js";
import * as campaignWorker from "../services/campaign-worker.js";

export const campaignsController = {
  async listCampaigns(req, res) {
    try {
      const { search = "", status = "all", limit = 50, page = 1 } = req.query;
      const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

      const query = { ...accountScope(req.accountId) };

      if (status && status !== "all") {
        query.status = status;
      }

      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { description: { $regex: search, $options: "i" } },
          { "template.name": { $regex: search, $options: "i" } },
        ];
      }

      const total = await collection(collections.campaigns).countDocuments(query);
      const items = await collection(collections.campaigns)
        .find(query)
        .sort({ createdAt: -1, created_at: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .toArray();

      return res.json({
        campaigns: items.map((c) => ({
          id: c._id.toString(),
          name: c.name,
          description: c.description || "",
          type: c.type || "single",
          status: c.status || "draft",
          template: c.template || { name: "N/A" },
          channel: c.channel || { name: "Primary WhatsApp" },
          audience: {
            total: c.progress?.total || c.audience?.totalCount || (c.recipients?.length) || 0,
            type: c.audience?.type || "all",
          },
          stats: {
            sent: c.progress?.sent || (c.recipients?.filter((r) => r.status === "sent").length) || 0,
            delivered: c.progress?.delivered || (c.recipients?.filter((r) => r.status === "delivered").length) || 0,
            read: c.progress?.read || (c.recipients?.filter((r) => r.status === "read").length) || 0,
            failed: c.progress?.failed || (c.recipients?.filter((r) => r.status === "failed").length) || 0,
            replied: c.progress?.replied || (c.recipients?.filter((r) => r.status === "replied").length) || 0,
            optedOut: c.progress?.optedOut || (c.recipients?.filter((r) => r.status === "opted_out").length) || 0,
          },
          schedule: c.schedule || null,
          scheduledAt: c.scheduledAt || c.schedule?.scheduledAt || null,
          createdBy: c.createdByName || "Admin",
          createdAt: c.createdAt || c.created_at || new Date().toISOString(),
          updatedAt: c.updatedAt || c.updated_at || new Date().toISOString(),
        })),
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
      });
    } catch (err) {
      console.error("[campaignsController.listCampaigns] error:", err);
      return res.status(500).json({ error: err.message || "Failed to list campaigns" });
    }
  },

  async getCampaign(req, res) {
    try {
      const { id } = req.params;
      const campaign = await collection(collections.campaigns).findOne({
        _id: parseId(id),
        ...accountScope(req.accountId),
      });

      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      return res.json({
        campaign: {
          ...campaign,
          id: campaign._id.toString(),
        },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to fetch campaign" });
    }
  },

  async createCampaign(req, res) {
    try {
      const body = req.body || {};
      if (!body.name || !body.name.trim()) {
        return res.status(400).json({ error: "Campaign name is required" });
      }

      if (body.schedule?.type === "schedule" && body.schedule?.scheduledAt) {
        const scheduledTime = new Date(body.schedule.scheduledAt).getTime();
        if (isNaN(scheduledTime) || scheduledTime <= Date.now()) {
          return res.status(400).json({ error: "Scheduled time must be in the future." });
        }
      }

      // Pre-validate audience
      const audienceResult = await campaignWorker.validateAudience(req.accountId, body.audience || {});

      if ((body.launchImmediately || body.status === "running") && audienceResult.eligibleCount === 0) {
        return res.status(400).json({ error: "Cannot launch campaign with 0 eligible contacts." });
      }

      if ((body.launchImmediately || body.status === "running") && (!body.template || !body.template.name)) {
        return res.status(400).json({ error: "Approved WhatsApp template is required to launch campaign." });
      }

      const recipients = audienceResult.eligibleContacts.map((c) => ({
        contactId: c._id.toString(),
        name: c.name || "Customer",
        phone: c.phone || c.wa_id,
        status: "pending",
        sentAt: null,
        error: null,
        attempt: 0,
      }));

      const now = new Date().toISOString();
      const doc = {
        accountId: req.accountId,
        createdBy: req.userId ? new mongoose.Types.ObjectId(req.userId) : null,
        createdByName: req.userName || "Operator",
        name: body.name,
        description: body.description || "",
        type: body.type || "single",
        status: body.status || "draft",
        audience: {
          ...(body.audience || {}),
          totalCount: audienceResult.totalCount,
          eligibleCount: audienceResult.eligibleCount,
          optedOutCount: audienceResult.optedOutCount,
          invalidCount: audienceResult.invalidCount,
          duplicateCount: audienceResult.duplicateCount,
        },
        template: body.template || { name: "" },
        variableMappings: body.variableMappings || {},
        channel: body.channel || { id: "primary", name: "Primary WhatsApp" },
        schedule: body.schedule || { type: "now" },
        sendingSettings: body.sendingSettings || {},
        rateLimit: body.rateLimit || {},
        quietHours: body.quietHours || {},
        retrySettings: body.retrySettings || {},
        recipients,
        progress: {
          total: recipients.length,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          replied: 0,
          optedOut: 0,
          currentIndex: 0,
        },
        createdAt: now,
        updatedAt: now,
      };

      const result = await collection(collections.campaigns).insertOne(doc);

      // Auto-start if scheduled for immediate send
      if (body.launchImmediately || body.status === "running") {
        void campaignWorker.startCampaign(req.accountId, req.userId, result.insertedId.toString());
      }

      return res.status(201).json({
        ok: true,
        campaign: { id: result.insertedId.toString(), ...doc },
        message: "Campaign created successfully.",
      });
    } catch (err) {
      console.error("[campaignsController.createCampaign] error:", err);
      return res.status(500).json({ error: err.message || "Failed to create campaign" });
    }
  },

  async updateCampaign(req, res) {
    try {
      const { id } = req.params;
      const updates = { ...(req.body || {}) };
      delete updates._id;
      delete updates.id;
      delete updates.accountId;

      updates.updatedAt = new Date().toISOString();

      const resUpdate = await collection(collections.campaigns).updateOne(
        { _id: parseId(id), ...accountScope(req.accountId) },
        { $set: updates },
      );

      if (resUpdate.matchedCount === 0) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      return res.json({ ok: true, message: "Campaign updated successfully." });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to update campaign" });
    }
  },

  async deleteCampaign(req, res) {
    try {
      const { id } = req.params;
      const result = await collection(collections.campaigns).deleteOne({
        _id: parseId(id),
        ...accountScope(req.accountId),
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      return res.json({ ok: true, message: "Campaign deleted successfully." });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to delete campaign" });
    }
  },

  async duplicateCampaign(req, res) {
    try {
      const { id } = req.params;
      const original = await collection(collections.campaigns).findOne({
        _id: parseId(id),
        ...accountScope(req.accountId),
      });

      if (!original) {
        return res.status(404).json({ error: "Original campaign not found" });
      }

      const copyDoc = {
        ...original,
        _id: new mongoose.Types.ObjectId(),
        name: `${original.name} (Copy)`,
        status: "draft",
        progress: {
          total: (original.recipients || []).length,
          sent: 0,
          delivered: 0,
          read: 0,
          failed: 0,
          replied: 0,
          optedOut: 0,
          currentIndex: 0,
        },
        recipients: (original.recipients || []).map((r) => ({
          ...r,
          status: "pending",
          sentAt: null,
          error: null,
          attempt: 0,
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await collection(collections.campaigns).insertOne(copyDoc);

      return res.status(201).json({
        ok: true,
        campaign: { id: result.insertedId.toString(), ...copyDoc },
        message: "Campaign duplicated successfully.",
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to duplicate campaign" });
    }
  },

  async startCampaign(req, res) {
    try {
      const { id } = req.params;
      const result = await campaignWorker.startCampaign(req.accountId, req.userId, id);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || "Failed to start campaign" });
    }
  },

  async pauseCampaign(req, res) {
    try {
      const { id } = req.params;
      const result = await campaignWorker.pauseCampaign(req.accountId, id);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || "Failed to pause campaign" });
    }
  },

  async resumeCampaign(req, res) {
    try {
      const { id } = req.params;
      const result = await campaignWorker.resumeCampaign(req.accountId, req.userId, id);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || "Failed to resume campaign" });
    }
  },

  async stopCampaign(req, res) {
    try {
      const { id } = req.params;
      const result = await campaignWorker.stopCampaign(req.accountId, id);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || "Failed to stop campaign" });
    }
  },

  async retryFailed(req, res) {
    try {
      const { id } = req.params;
      const result = await campaignWorker.retryFailedCampaign(req.accountId, req.userId, id);
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message || "Failed to retry campaign" });
    }
  },

  async validateAudienceEndpoint(req, res) {
    try {
      const result = await campaignWorker.validateAudience(req.accountId, req.body || {});
      return res.json({
        ok: true,
        totalContacts: result.totalCount,
        eligible: result.eligibleCount,
        optedOut: result.optedOutCount,
        invalid: result.invalidCount,
        duplicates: result.duplicateCount,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Audience validation failed" });
    }
  },

  async getAnalytics(req, res) {
    try {
      const { id } = req.params;
      const campaign = await collection(collections.campaigns).findOne({
        _id: parseId(id),
        ...accountScope(req.accountId),
      });

      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }

      const rawRecipients = campaign.recipients || [];
      const total = campaign.progress?.total || rawRecipients.length || 0;
      const sent = campaign.progress?.sent || rawRecipients.filter((r) => r.status === "sent").length || 0;
      const delivered = campaign.progress?.delivered || rawRecipients.filter((r) => r.status === "delivered").length || 0;
      const read = campaign.progress?.read || rawRecipients.filter((r) => r.status === "read").length || 0;
      const failed = campaign.progress?.failed || rawRecipients.filter((r) => r.status === "failed").length || 0;
      const replied = campaign.progress?.replied || rawRecipients.filter((r) => r.status === "replied").length || 0;
      const optedOut = campaign.progress?.optedOut || rawRecipients.filter((r) => r.status === "opted_out").length || 0;

      const deliveryRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
      const readRate = delivered > 0 ? Math.round((read / delivered) * 100) : 0;
      const replyRate = read > 0 ? Math.round((replied / read) * 100) : 0;
      const failureRate = total > 0 ? Math.round((failed / total) * 100) : 0;
      const optOutRate = total > 0 ? Math.round((optedOut / total) * 100) : 0;

      // Real contact-level list
      const recipients = rawRecipients.map((r) => ({
        contactId: r.contactId,
        name: r.name,
        phone: r.phone,
        status: r.status,
        sentAt: r.sentAt || null,
        deliveredAt: r.deliveredAt || (r.status === "delivered" ? r.sentAt : null),
        readAt: r.readAt || null,
        repliedAt: r.repliedAt || null,
        error: r.error || null,
        lastEvent: r.status === "sent" ? "Message sent" : r.status === "delivered" ? "Message delivered" : r.status === "read" ? "Read by recipient" : (r.error || "Pending delivery"),
      }));

      // Calculate real hourly timeline trends from sent timestamps
      const hourCounts = new Map();
      for (const r of rawRecipients) {
        if (r.sentAt) {
          try {
            const hour = new Date(r.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
            const cur = hourCounts.get(hour) || { sent: 0, delivered: 0, read: 0 };
            cur.sent += 1;
            if (r.status === "delivered" || r.deliveredAt) cur.delivered += 1;
            if (r.status === "read" || r.readAt) cur.read += 1;
            hourCounts.set(hour, cur);
          } catch {
            // Ignore date parsing failure
          }
        }
      }

      const trends = Array.from(hourCounts.entries()).map(([time, counts]) => ({
        time,
        sent: counts.sent,
        delivered: counts.delivered,
        read: counts.read,
      }));

      return res.json({
        overview: {
          totalRecipients: total,
          sent,
          delivered,
          read,
          replied,
          failed,
          optedOut,
          deliveryRate,
          readRate,
          replyRate,
          failureRate,
          optOutRate,
        },
        trends,
        recipients,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to fetch analytics" });
    }
  },
};
