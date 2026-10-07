import { collection, accountScope, parseId } from "../utils/crud.js";
import { collections } from "../models/collection-models.js";
import { sendMessageForAccount, getWhatsAppConfig } from "./whatsapp-service.js";

// Active runner state map to allow immediate interruption on pause/stop
const activeRunners = new Map();

/**
 * Check if current time falls within configured quiet hours
 */
export function isInQuietHours(quietHours) {
  if (!quietHours || !quietHours.enabled) return false;
  try {
    const tz = quietHours.timezone || "Asia/Kolkata";
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const [hStr, mStr] = formatter.format(now).split(":");
    const currentMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

    const [startH, startM] = (quietHours.start || "21:00").split(":");
    const startMinutes = parseInt(startH, 10) * 60 + parseInt(startM, 10);

    const [endH, endM] = (quietHours.end || "09:00").split(":");
    const endMinutes = parseInt(endH, 10) * 60 + parseInt(endM, 10);

    if (startMinutes > endMinutes) {
      // Overnight (e.g., 21:00 to 09:00)
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
      // Same day (e.g., 12:00 to 14:00)
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
  } catch (err) {
    console.error("[campaign-worker] quiet hours check error:", err);
    return false;
  }
}

/**
 * Calculate delay in milliseconds according to sending settings
 */
export function calculateDelayMs(sendingSettings, rateLimitSettings) {
  let delaySec = sendingSettings?.delayBetweenMessages || 3;

  if (sendingSettings?.randomizeDelay) {
    const min = sendingSettings.minDelaySeconds || 2;
    const max = sendingSettings.maxDelaySeconds || 5;
    delaySec = min + Math.random() * (max - min);
  }

  // Also enforce messages-per-minute rate limit if active
  if (rateLimitSettings?.enabled && rateLimitSettings.messagesPerMinute) {
    const minSecondsPerMsg = 60 / rateLimitSettings.messagesPerMinute;
    if (delaySec < minSecondsPerMsg) {
      delaySec = minSecondsPerMsg;
    }
  }

  return Math.round(delaySec * 1000);
}

/**
 * Validate audience before campaign execution
 */
export async function validateAudience(accountId, audienceConfig = {}) {
  const {
    type = "all",
    contactIds = [],
    filterConditions = [],
    logicOperator = "AND",
  } = audienceConfig;

  let query = accountScope(accountId);

  if (type === "selected" && Array.isArray(contactIds) && contactIds.length) {
    query._id = { $in: contactIds.map(parseId) };
  } else if (Array.isArray(filterConditions) && filterConditions.length > 0) {
    const mongoConditions = filterConditions.map((cond) => {
      const { field, operator, value } = cond;
      if (!field) return {};
      if (operator === "eq") return { [field]: value };
      if (operator === "ne") return { [field]: { $ne: value } };
      if (operator === "contains") return { [field]: { $regex: value, $options: "i" } };
      if (operator === "in" && Array.isArray(value)) return { [field]: { $in: value } };
      return { [field]: value };
    }).filter((c) => Object.keys(c).length > 0);

    if (mongoConditions.length > 0) {
      if (logicOperator === "OR") {
        query.$or = mongoConditions;
      } else {
        query.$and = mongoConditions;
      }
    }
  }

  const allContacts = await collection(collections.contacts).find(query).toArray();
  const totalCount = allContacts.length;

  // Retrieve opt-outs for account
  const optOutRows = await collection(collections.optOuts).find({
    ...accountScope(accountId),
    channel: "whatsapp",
  }).toArray();
  const optOutPhones = new Set(optOutRows.map((o) => (o.phone || "").replace(/[^0-9]/g, "")));
  const optOutIds = new Set(optOutRows.map((o) => (o.contact_id || "").toString()));

  const seenPhones = new Set();
  let optedOutCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;
  const eligibleContacts = [];

  for (const c of allContacts) {
    const rawPhone = c.phone || c.wa_id || "";
    const cleanPhone = rawPhone.replace(/[^0-9]/g, "");

    // Check validity
    if (!cleanPhone || cleanPhone.length < 8) {
      invalidCount += 1;
      continue;
    }

    // Check duplicates
    if (seenPhones.has(cleanPhone)) {
      duplicateCount += 1;
      continue;
    }
    seenPhones.add(cleanPhone);

    // Check opt-out
    if (c.opted_out || optOutPhones.has(cleanPhone) || optOutIds.has(c._id.toString())) {
      optedOutCount += 1;
      continue;
    }

    eligibleContacts.push(c);
  }

  return {
    totalCount,
    eligibleCount: eligibleContacts.length,
    optedOutCount,
    invalidCount,
    duplicateCount,
    eligibleContacts,
  };
}

/**
 * Start a campaign execution
 */
export async function startCampaign(accountId, userId, campaignId) {
  const campaign = await collection(collections.campaigns).findOne({
    _id: parseId(campaignId),
    ...accountScope(accountId),
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (["running", "completed"].includes(campaign.status)) {
    throw new Error(`Cannot start campaign in '${campaign.status}' state`);
  }

  // Load account campaign settings
  const settings = (await collection(collections.campaignSettings).findOne(accountScope(accountId))) || {};

  // Build audience if not already frozen
  let eligibleRecipients = campaign.recipients;
  if (!Array.isArray(eligibleRecipients) || eligibleRecipients.length === 0) {
    const audienceResult = await validateAudience(accountId, campaign.audience || {});
    eligibleRecipients = audienceResult.eligibleContacts.map((c) => ({
      contactId: c._id.toString(),
      name: c.name || "Customer",
      phone: c.phone || c.wa_id,
      status: "pending",
      sentAt: null,
      error: null,
      attempt: 0,
    }));
  }

  if (eligibleRecipients.length === 0) {
    throw new Error("Cannot launch campaign with 0 eligible recipients.");
  }

  const now = new Date().toISOString();
  await collection(collections.campaigns).updateOne(
    { _id: campaign._id },
    {
      $set: {
        status: "running",
        startedAt: now,
        recipients: eligibleRecipients,
        "progress.total": eligibleRecipients.length,
        "progress.sent": 0,
        "progress.delivered": 0,
        "progress.read": 0,
        "progress.failed": 0,
        "progress.currentIndex": 0,
        updatedAt: now,
      },
    },
  );

  // Dispatch runner in background
  activeRunners.set(campaignId.toString(), true);
  void executeCampaignLoop(accountId, userId, campaign._id.toString(), settings);

  return { ok: true, status: "running", totalRecipients: eligibleRecipients.length };
}

/**
 * Pause a campaign
 */
export async function pauseCampaign(accountId, maybeUserIdOrCampaignId, maybeCampaignId) {
  const campaignId = maybeCampaignId || maybeUserIdOrCampaignId;
  const idStr = campaignId.toString();
  activeRunners.delete(idStr);

  const now = new Date().toISOString();
  const res = await collection(collections.campaigns).updateOne(
    { _id: parseId(campaignId), ...accountScope(accountId) },
    { $set: { status: "paused", pausedAt: now, updatedAt: now } },
  );

  return { ok: res.modifiedCount > 0, status: "paused" };
}

/**
 * Resume a paused campaign
 */
export async function resumeCampaign(accountId, maybeUserIdOrCampaignId, maybeCampaignId) {
  const campaignId = maybeCampaignId || maybeUserIdOrCampaignId;
  const userId = maybeCampaignId ? maybeUserIdOrCampaignId : null;
  const campaign = await collection(collections.campaigns).findOne({
    _id: parseId(campaignId),
    ...accountScope(accountId),
  });

  if (!campaign) throw new Error("Campaign not found");
  if (campaign.status !== "paused") {
    throw new Error(`Campaign must be paused to resume (current: ${campaign.status})`);
  }

  const settings = (await collection(collections.campaignSettings).findOne(accountScope(accountId))) || {};
  const now = new Date().toISOString();

  await collection(collections.campaigns).updateOne(
    { _id: campaign._id },
    { $set: { status: "running", resumedAt: now, updatedAt: now } },
  );

  activeRunners.set(campaignId.toString(), true);
  void executeCampaignLoop(accountId, userId, campaign._id.toString(), settings);

  return { ok: true, status: "running", currentIndex: campaign.progress?.currentIndex || 0 };
}

/**
 * Stop/Cancel a campaign permanently
 */
export async function stopCampaign(accountId, maybeUserIdOrCampaignId, maybeCampaignId) {
  const campaignId = maybeCampaignId || maybeUserIdOrCampaignId;
  const idStr = campaignId.toString();
  activeRunners.delete(idStr);

  const now = new Date().toISOString();
  const res = await collection(collections.campaigns).updateOne(
    { _id: parseId(campaignId), ...accountScope(accountId) },
    { $set: { status: "cancelled", cancelledAt: now, updatedAt: now } },
  );

  return { ok: res.modifiedCount > 0, status: "cancelled" };
}

/**
 * Retry failed recipients
 */
export async function retryFailedCampaign(accountId, maybeUserIdOrCampaignId, maybeCampaignId) {
  const campaignId = maybeCampaignId || maybeUserIdOrCampaignId;
  const userId = maybeCampaignId ? maybeUserIdOrCampaignId : null;
  const campaign = await collection(collections.campaigns).findOne({
    _id: parseId(campaignId),
    ...accountScope(accountId),
  });

  if (!campaign) throw new Error("Campaign not found");

  const recipients = campaign.recipients || [];
  const maxRetries = campaign.retrySettings?.maxRetries || 3;
  let retryingCount = 0;

  for (const r of recipients) {
    if (r.status === "failed" && (r.attempt || 0) < maxRetries) {
      r.status = "pending";
      r.error = null;
      retryingCount += 1;
    }
  }

  if (retryingCount === 0) {
    return { ok: false, message: "No failed recipients eligible for retry under max retry limits." };
  }

  // Find index of first pending recipient to resume processing from
  const firstPendingIdx = recipients.findIndex((r) => r.status === "pending");
  const currentIndex = firstPendingIdx >= 0 ? firstPendingIdx : 0;
  const failedCount = recipients.filter((r) => r.status === "failed").length;

  const now = new Date().toISOString();
  await collection(collections.campaigns).updateOne(
    { _id: campaign._id },
    {
      $set: {
        status: "running",
        recipients,
        "progress.currentIndex": currentIndex,
        "progress.failed": failedCount,
        updatedAt: now,
      },
    },
  );

  const settings = (await collection(collections.campaignSettings).findOne(accountScope(accountId))) || {};
  activeRunners.set(campaignId.toString(), true);
  void executeCampaignLoop(accountId, userId, campaign._id.toString(), settings);

  return { ok: true, retryingCount, retryCount: retryingCount, status: "running", campaign: { id: campaign._id.toString(), status: "running" } };
}

/**
 * Main worker loop for campaign sending
 */
async function executeCampaignLoop(accountId, userId, campaignId, settings) {
  try {
    const sendingSettings = settings.sendingSettings || {};
    const rateLimitSettings = settings.rateLimitSettings || {};
    const quietHours = settings.quietHoursSettings || {};

    let index = 0;
    while (activeRunners.get(campaignId)) {
      // Re-fetch current state
      const campaign = await collection(collections.campaigns).findOne({
        _id: parseId(campaignId),
        ...accountScope(accountId),
      });

      if (!campaign || campaign.status !== "running") {
        activeRunners.delete(campaignId);
        break;
      }

      const recipients = campaign.recipients || [];
      index = campaign.progress?.currentIndex || 0;

      if (index >= recipients.length) {
        // Finished all recipients!
        const now = new Date().toISOString();
        const sentCount = recipients.filter((r) => r.status === "sent").length;
        const failedCount = recipients.filter((r) => r.status === "failed").length;

        await collection(collections.campaigns).updateOne(
          { _id: campaign._id },
          {
            $set: {
              status: failedCount > 0 && sentCount === 0 ? "failed" : "completed",
              completedAt: now,
              updatedAt: now,
            },
          },
        );
        activeRunners.delete(campaignId);
        break;
      }

      // Check quiet hours
      if (isInQuietHours(quietHours)) {
        if (quietHours.behavior === "pause") {
          await pauseCampaign(accountId, campaignId);
          break;
        }
        // If delay, wait 60s before checking again
        await new Promise((res) => setTimeout(res, 60000));
        continue;
      }

      const currentRecipient = recipients[index];
      if (!currentRecipient) {
        activeRunners.delete(campaignId);
        break;
      }

      let didSend = false;

      if (currentRecipient.status === "pending") {
        // Production Requirement 14: Real-time opt-out protection right before sending
        const cleanPhone = (currentRecipient.phone || "").replace(/[^0-9]/g, "");
        const isOptedOut = await collection(collections.optOuts).findOne({
          ...accountScope(accountId),
          $or: [
            { contact_id: currentRecipient.contactId },
            { phone: { $in: [currentRecipient.phone, cleanPhone].filter(Boolean) } },
          ],
        });

        let isBlockedOrOptedOutContact = false;
        if (currentRecipient.contactId) {
          const contactDoc = await collection(collections.contacts).findOne({
            _id: parseId(currentRecipient.contactId),
            ...accountScope(accountId),
          });
          if (contactDoc && (contactDoc.opted_out || contactDoc.status === "blocked")) {
            isBlockedOrOptedOutContact = true;
          }
        }

        if (isOptedOut || isBlockedOrOptedOutContact) {
          currentRecipient.status = "opted_out";
          currentRecipient.error = "Contact opted out or unsubscribed prior to transmission";
        } else {
          currentRecipient.attempt = (currentRecipient.attempt || 0) + 1;

          try {
            // Resolve template parameters from variable mappings
            const templateName = campaign.template?.name;
            const templateParams = [];
            if (campaign.variableMappings && typeof campaign.variableMappings === "object") {
              const keys = Object.keys(campaign.variableMappings).sort((a, b) => Number(a) - Number(b));
              for (const k of keys) {
                const mappedField = campaign.variableMappings[k];
                const val = currentRecipient[mappedField] || (settings.templateSettings?.variableFallbacks?.[mappedField]) || "";
                templateParams.push(val);
              }
            }

            // Send WhatsApp message
            await sendMessageForAccount({
              accountId,
              userId,
              contactId: currentRecipient.contactId,
              body: {
                message_type: templateName ? "template" : "text",
                template_name: templateName,
                template_params: templateParams.length ? templateParams : undefined,
                content_text: campaign.template?.body || `Hello ${currentRecipient.name || ""}`,
              },
              senderType: "agent",
            });

            currentRecipient.status = "sent";
            currentRecipient.sentAt = new Date().toISOString();
            currentRecipient.error = null;
            didSend = true;
          } catch (err) {
            console.error(`[campaign-worker] error sending to ${currentRecipient.phone}:`, err.message);
            currentRecipient.status = "failed";
            currentRecipient.error = err.message || "Sending failed";
          }
        }
      }

      // Update progress atomically
      const updatedIndex = index + 1;
      const sentCount = recipients.filter((r) => r.status === "sent").length;
      const failedCount = recipients.filter((r) => r.status === "failed").length;
      const optedOutCount = recipients.filter((r) => r.status === "opted_out").length;

      await collection(collections.campaigns).updateOne(
        { _id: campaign._id },
        {
          $set: {
            [`recipients.${index}`]: currentRecipient,
            "progress.currentIndex": updatedIndex,
            "progress.sent": sentCount,
            "progress.failed": failedCount,
            "progress.optedOut": optedOutCount,
            updatedAt: new Date().toISOString(),
          },
        },
      );

      // Only sleep delay when an actual message was dispatched (prevents unnecessary idle delay on skipped items)
      if (didSend) {
        const delayMs = calculateDelayMs(sendingSettings, rateLimitSettings);
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
  } catch (err) {
    console.error("[campaign-worker] loop execution error:", err);
    activeRunners.delete(campaignId);
  }
}
