import crypto from "node:crypto";

import { collections } from "../models/collection-models.js";
import { accountScope, collection, parseId, publicDoc, timestamps } from "../utils/crud.js";

const META_API_VERSION = process.env.META_API_VERSION || "v21.0";
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

export class ApiError extends Error {
  constructor(message, status = 500, code = "error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getTextFromMessage(message = {}) {
  if (message.text?.body) return message.text.body;
  if (message.button?.text) return message.button.text;
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title;
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title;
  if (message.image?.caption) return message.image.caption;
  if (message.video?.caption) return message.video.caption;
  if (message.document?.caption) return message.document.caption;
  if (message.location) return "Location shared";
  return "";
}

export function normalizePhone(value = "") {
  return String(value).replace(/[^\d]/g, "");
}

const DEFAULT_OPT_OUT_KEYWORDS = ["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT"];

function recipientFields(to) {
  const target = String(to || "").trim();
  if (!target) throw new ApiError("Recipient phone is required", 400, "bad_request");
  return { recipient_type: "individual", to: normalizePhone(target) || target };
}

function assertMax(value, max, label) {
  if (value && String(value).length > max) {
    throw new ApiError(`${label} exceeds the ${max}-character limit`, 400, "bad_request");
  }
}

export function buildInteractivePayload(payload = {}) {
  if (!payload || typeof payload !== "object") {
    throw new ApiError("interactive_payload is required", 400, "bad_request");
  }
  const body = String(payload.body || "").trim();
  if (!body) throw new ApiError("Interactive message body text is required", 400, "bad_request");
  assertMax(body, 1024, "Interactive body");
  assertMax(payload.header, 60, "Interactive header");
  assertMax(payload.footer, 60, "Interactive footer");

  const interactive = { body: { text: body } };
  if (payload.header) interactive.header = { type: "text", text: String(payload.header) };
  if (payload.footer) interactive.footer = { text: String(payload.footer) };

  if (payload.kind === "buttons") {
    const buttons = Array.isArray(payload.buttons) ? payload.buttons : [];
    if (buttons.length < 1 || buttons.length > 3) {
      throw new ApiError("Interactive button messages require 1-3 buttons", 400, "bad_request");
    }
    const seen = new Set();
    interactive.type = "button";
    interactive.action = {
      buttons: buttons.map((button) => {
        const id = String(button?.id || "").trim();
        const title = String(button?.title || "").trim();
        if (!id || !title) throw new ApiError("Every interactive button needs an id and title", 400, "bad_request");
        if (seen.has(id)) throw new ApiError(`Duplicate interactive button id "${id}"`, 400, "bad_request");
        seen.add(id);
        assertMax(title, 20, "Interactive button title");
        return { type: "reply", reply: { id, title } };
      }),
    };
    return interactive;
  }

  if (payload.kind === "list") {
    const buttonLabel = String(payload.button_label || "").trim();
    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    if (!buttonLabel) throw new ApiError("Interactive list button label is required", 400, "bad_request");
    assertMax(buttonLabel, 20, "Interactive list button label");
    if (sections.length < 1 || sections.length > 10) {
      throw new ApiError("Interactive lists require 1-10 sections", 400, "bad_request");
    }
    const seen = new Set();
    let totalRows = 0;
    interactive.type = "list";
    interactive.action = {
      button: buttonLabel,
      sections: sections.map((section) => {
        const rows = Array.isArray(section?.rows) ? section.rows : [];
        if (!rows.length) throw new ApiError("Every interactive list section needs rows", 400, "bad_request");
        return {
          ...(section?.title ? { title: String(section.title) } : {}),
          rows: rows.map((row) => {
            totalRows += 1;
            const id = String(row?.id || "").trim();
            const title = String(row?.title || "").trim();
            if (!id || !title) throw new ApiError("Every interactive list row needs an id and title", 400, "bad_request");
            if (seen.has(id)) throw new ApiError(`Duplicate interactive list row id "${id}"`, 400, "bad_request");
            seen.add(id);
            assertMax(title, 24, "Interactive list row title");
            assertMax(row?.description, 72, "Interactive list row description");
            return { id, title, ...(row?.description ? { description: String(row.description) } : {}) };
          }),
        };
      }),
    };
    if (totalRows < 1 || totalRows > 10) {
      throw new ApiError("Interactive lists require 1-10 rows total", 400, "bad_request");
    }
    return interactive;
  }

  throw new ApiError("Interactive message must be reply buttons or a list", 400, "bad_request");
}

async function readMetaResponse(response, fallback) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.error?.error_data?.details || data?.error?.message || fallback;
    throw new ApiError(message, response.status || 502, "meta_error");
  }
  return data;
}

export async function metaRequest(path, { accessToken, method = "GET", body, headers = {} } = {}) {
  if (!accessToken) throw new ApiError("WhatsApp access token is missing", 400, "missing_token");
  const response = await fetch(`${META_API_BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readMetaResponse(response, `Meta API error: ${response.status}`);
}

export async function getWhatsAppConfig(accountId) {
  const config = await collection(collections.whatsappConfig).findOne(accountScope(accountId));
  if (!config?.phone_number_id || !config?.access_token) {
    throw new ApiError("WhatsApp is not configured for this account", 400, "whatsapp_not_configured");
  }
  return config;
}

export async function sendMetaMessage(config, payload) {
  const data = await metaRequest(`/${config.phone_number_id}/messages`, {
    accessToken: config.access_token,
    method: "POST",
    body: { messaging_product: "whatsapp", ...payload },
  });
  return data?.messages?.[0]?.id || null;
}

export function buildMetaPayload({ to, message_type, content_text, media_url, filename, template_name, template_language, template_params, interactive_payload }) {
  const base = recipientFields(to);
  if (message_type === "template") {
    if (!template_name) throw new ApiError("template_name is required", 400, "bad_request");
    const components = Array.isArray(template_params) && template_params.length
      ? [{ type: "body", parameters: template_params.map((value) => ({ type: "text", text: String(value) })) }]
      : undefined;
    return {
      ...base,
      type: "template",
      template: {
        name: template_name,
        language: { code: template_language || "en_US" },
        ...(components ? { components } : {}),
      },
    };
  }
  if (["image", "video", "document", "audio"].includes(message_type)) {
    if (!media_url) throw new ApiError("media_url is required", 400, "bad_request");
    const media = { link: media_url };
    if (content_text && message_type !== "audio") media.caption = content_text;
    if (filename && message_type === "document") media.filename = filename;
    return { ...base, type: message_type, [message_type]: media };
  }
  if (message_type === "interactive") {
    return { ...base, type: "interactive", interactive: buildInteractivePayload(interactive_payload) };
  }
  if (!content_text) throw new ApiError("content_text is required", 400, "bad_request");
  return { ...base, type: "text", text: { body: content_text } };
}

export async function findOrCreateContact(accountId, userId, profile = {}) {
  const phone = normalizePhone(profile.wa_id || profile.phone || "");
  const name = profile.profile?.name || profile.name || phone || "WhatsApp Contact";
  const query = phone
    ? { $and: [accountScope(accountId), { $or: [{ phone }, { wa_id: profile.wa_id }] }] }
    : { ...accountScope(accountId), wa_id: profile.wa_id };
  const existing = await collection(collections.contacts).findOne(query);
  if (existing) return existing;
  const now = timestamps(true);
  const doc = {
    accountId,
    userId,
    name,
    phone,
    wa_id: profile.wa_id || phone,
    source: "whatsapp",
    ...now,
  };
  const result = await collection(collections.contacts).insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

export async function findOrCreateConversation(accountId, userId, contactId) {
  const existing = await collection(collections.conversations).findOne({
    $and: [accountScope(accountId), { $or: [{ contact_id: contactId.toString() }, { contactId: contactId.toString() }] }],
  });

  const crmSettings = await collection("crm_settings").findOne(accountScope(accountId));
  const convSettings = crmSettings?.conversationSettings || {};
  const assignSettings = crmSettings?.assignmentSettings || {};
  const defaultStatus = convSettings.statuses?.find((s) => s.isDefault)?.id || "open";

  if (existing) {
    if (existing.status === "closed") {
      const allowReopen = convSettings.allowReopen ?? true;
      if (allowReopen && convSettings.reopenClosedConversations !== false) {
        await collection(collections.conversations).updateOne(
          { _id: existing._id },
          { $set: { status: defaultStatus, updated_at: new Date().toISOString() } },
        );
        existing.status = defaultStatus;
      }
    }
    return existing;
  }

  let assignedTo = null;
  const isAutoAssign = convSettings.autoAssignment?.enabled || assignSettings.autoAssignment;
  if (isAutoAssign) {
    const method = convSettings.autoAssignment?.method || assignSettings.mode || "round_robin";
    if (method === "round_robin" || assignSettings.roundRobin) {
      const members = await collection("account_members").find(accountScope(accountId)).toArray();
      if (members.length > 0) {
        const lastAssigned = await collection(collections.conversations)
          .findOne({ ...accountScope(accountId), assigned_to: { $exists: true, $ne: null } }, { sort: { created_at: -1 } });
        const lastIdx = lastAssigned ? members.findIndex((m) => m.userId?.toString() === lastAssigned.assigned_to) : -1;
        const nextMember = members[(lastIdx + 1) % members.length];
        assignedTo = nextMember?.userId?.toString() || null;
      }
    } else if (convSettings.autoAssignment?.defaultUserId || assignSettings.defaultUserId) {
      assignedTo = convSettings.autoAssignment?.defaultUserId || assignSettings.defaultUserId;
    }
  }

  const doc = {
    accountId,
    userId,
    contact_id: contactId.toString(),
    status: defaultStatus,
    ...(assignedTo ? { assigned_to: assignedTo, assigned_user_id: assignedTo } : {}),
    unread_count: 0,
    ...timestamps(true),
  };
  const result = await collection(collections.conversations).insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

export async function persistOutboundMessage({ accountId, userId, conversation, input, whatsappMessageId, status = "sent" }) {
  const doc = {
    accountId,
    userId,
    conversation_id: conversation._id.toString(),
    sender_type: input.sender_type || "agent",
    content_type: input.message_type || "text",
    content_text: input.content_text || null,
    media_url: input.media_url || null,
    template_name: input.template_name || null,
    interactive_payload: input.message_type === "interactive" ? input.interactive_payload : null,
    message_id: whatsappMessageId,
    status,
    ...timestamps(true),
  };
  const result = await collection(collections.messages).insertOne(doc);
  await collection(collections.conversations).updateOne(
    { _id: conversation._id },
    { $set: { last_message_text: doc.content_text || doc.template_name || doc.interactive_payload?.body || `[${doc.content_type}]`, last_message_at: doc.created_at, updated_at: doc.updated_at } },
  );
  return { _id: result.insertedId, ...doc };
}

export async function enforceInboundOptOut({ accountId, contact, text }) {
  const normalizedText = String(text || "").trim().toUpperCase();
  if (!normalizedText) return false;
  const setting = await collection(collections.settings).findOne({ ...accountScope(accountId), key: "opt_out_keywords" });
  const keywords = Array.isArray(setting?.value) && setting.value.length
    ? setting.value.map((value) => String(value).trim().toUpperCase()).filter(Boolean)
    : DEFAULT_OPT_OUT_KEYWORDS;
  if (!keywords.includes(normalizedText)) return false;
  const now = new Date().toISOString();
  await collection(collections.optOuts).updateOne(
    { ...accountScope(accountId), contact_id: contact._id.toString(), channel: "whatsapp" },
    {
      $set: {
        accountId,
        contact_id: contact._id.toString(),
        channel: "whatsapp",
        keyword: normalizedText,
        phone: contact.phone || contact.wa_id || null,
        opted_out_at: now,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
    },
    { upsert: true },
  );
  await collection(collections.contacts).updateOne(
    { _id: contact._id, ...accountScope(accountId) },
    { $set: { opted_out: true, opted_out_at: now, updated_at: now } },
  );
  return true;
}

export async function sendReactionForAccount({ accountId, userId, messageId, emoji }) {
  if (!messageId) throw new ApiError("message_id is required", 400, "bad_request");
  if (typeof emoji !== "string") throw new ApiError("emoji must be a string", 400, "bad_request");

  const target = await collection(collections.messages).findOne({
    $and: [accountScope(accountId), { $or: [{ _id: parseId(messageId) }, { message_id: messageId }] }],
  });
  if (!target) throw new ApiError("Message not found", 404, "not_found");
  if (!target.message_id) {
    throw new ApiError("Cannot react to a message that has not been sent to WhatsApp", 400, "bad_request");
  }

  const conversation = await collection(collections.conversations).findOne({
    _id: parseId(target.conversation_id || target.conversationId),
    ...accountScope(accountId),
  });
  if (!conversation) throw new ApiError("Conversation not found", 404, "not_found");
  const contact = await collection(collections.contacts).findOne({
    _id: parseId(conversation.contact_id || conversation.contactId),
    ...accountScope(accountId),
  });
  if (!contact) throw new ApiError("Contact not found", 404, "not_found");

  const config = await getWhatsAppConfig(accountId);
  const to = contact.phone || contact.wa_id;
  const reactionMessageId = await sendMetaMessage(config, {
    ...recipientFields(to),
    type: "reaction",
    reaction: { message_id: target.message_id, emoji },
  });

  const selector = {
    accountId,
    message_id: target.message_id,
    sender_type: "agent",
    userId,
  };
  if (!emoji) {
    await collection(collections.messageReactions).deleteMany({
      ...accountScope(accountId),
      message_id: target.message_id,
      sender_type: "agent",
      userId,
    });
  } else {
    await collection(collections.messageReactions).updateOne(
      selector,
      { $set: { ...selector, emoji, reaction_message_id: reactionMessageId, updated_at: new Date().toISOString() }, $setOnInsert: { created_at: new Date().toISOString() } },
      { upsert: true },
    );
  }
  return { whatsapp_message_id: reactionMessageId, removed: !emoji };
}

export async function sendMessageForAccount({ accountId, userId, conversationId, contactId, body, senderType = "agent" }) {
  const input = { ...body, sender_type: senderType };
  const config = await getWhatsAppConfig(accountId);
  let conversation;
  let contact;
  if (conversationId) {
    conversation = await collection(collections.conversations).findOne({ _id: parseId(conversationId), ...accountScope(accountId) });
    if (!conversation) throw new ApiError("Conversation not found", 404, "not_found");
    contact = await collection(collections.contacts).findOne({ _id: parseId(conversation.contact_id || conversation.contactId), ...accountScope(accountId) });
  } else if (contactId) {
    contact = await collection(collections.contacts).findOne({ _id: parseId(contactId), ...accountScope(accountId) });
    if (!contact) throw new ApiError("Contact not found", 404, "not_found");
    conversation = await findOrCreateConversation(accountId, userId, contact._id);
  } else {
    throw new ApiError("conversation_id or contact_id is required", 400, "bad_request");
  }
  if (!contact) throw new ApiError("Contact not found for conversation", 404, "not_found");
  const to = body.to || contact.phone || contact.wa_id;
  const payload = buildMetaPayload({ ...body, to });
  const whatsappMessageId = await sendMetaMessage(config, payload);
  const saved = await persistOutboundMessage({ accountId, userId, conversation, input, whatsappMessageId });
  return { message: publicDoc(saved), message_id: saved._id.toString(), whatsapp_message_id: whatsappMessageId };
}

export async function processInboundWebhook(payload) {
  const results = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = value?.metadata?.phone_number_id;
      const config = phoneNumberId
        ? await collection(collections.whatsappConfig).findOne({ phone_number_id: phoneNumberId })
        : null;
      if (!config?.accountId && !config?.account_id) continue;
      const accountId = config.accountId || config.account_id;
      const userId = config.userId || config.user_id || null;

      for (const status of value.statuses || []) {
        const update = {
          status: status.status,
          updated_at: new Date().toISOString(),
          ...(status.errors?.[0] ? {
            error_code: status.errors[0].code,
            error_title: status.errors[0].title,
            error_details: status.errors[0].error_data?.details,
          } : {}),
        };
        await collection(collections.messages).updateOne({ message_id: status.id, ...accountScope(accountId) }, { $set: update });
        results.push({ type: "status", id: status.id, status: status.status });
      }

      const contactsByWaId = new Map((value.contacts || []).map((c) => [c.wa_id, c]));
      for (const message of value.messages || []) {
        const profile = contactsByWaId.get(message.from) || { wa_id: message.from };
        const contact = await findOrCreateContact(accountId, userId, profile);
        const conversation = await findOrCreateConversation(accountId, userId, contact._id);
        const contentType = message.type || "text";
        const media = message[contentType];
        const interactiveReplyId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null;
        const doc = {
          accountId,
          userId,
          conversation_id: conversation._id.toString(),
          sender_type: "customer",
          content_type: contentType,
          content_text: getTextFromMessage(message),
          media_id: media?.id || null,
          media_type: media?.mime_type || null,
          message_id: message.id,
          status: "delivered",
          interactive_reply_id: interactiveReplyId,
          raw: message,
          ...timestamps(true),
        };
        await collection(collections.messages).updateOne(
          { message_id: message.id, ...accountScope(accountId) },
          { $setOnInsert: doc },
          { upsert: true },
        );
        await collection(collections.conversations).updateOne(
          { _id: conversation._id },
          { $set: { last_message_text: doc.content_text || `[${contentType}]`, last_message_at: doc.created_at, updated_at: doc.updated_at }, $inc: { unread_count: 1 } },
        );
        await enforceInboundOptOut({ accountId, contact, text: doc.content_text });
        results.push({ type: "message", id: message.id });
      }
    }
  }
  return results;
}

export async function syncTemplates(accountId) {
  const config = await getWhatsAppConfig(accountId);
  if (!config.waba_id) throw new ApiError("waba_id is required to sync templates", 400, "missing_waba");
  const data = await metaRequest(`/${config.waba_id}/message_templates?limit=100`, { accessToken: config.access_token });
  const templates = data.data || [];
  for (const template of templates) {
    await collection(collections.whatsappTemplates).updateOne(
      { ...accountScope(accountId), name: template.name, language: template.language },
      {
        $set: {
          accountId,
          name: template.name,
          language: template.language,
          category: template.category,
          status: template.status,
          components: template.components || [],
          meta_template_id: template.id,
          updated_at: new Date().toISOString(),
        },
        $setOnInsert: { created_at: new Date().toISOString() },
      },
      { upsert: true },
    );
  }
  return templates;
}

export async function submitTemplate(accountId, userId, body = {}) {
  const config = await getWhatsAppConfig(accountId);
  if (!config.waba_id) throw new ApiError("waba_id is required to submit templates", 400, "missing_waba");
  const payload = {
    name: body.name,
    language: body.language || "en_US",
    category: body.category || "MARKETING",
    components: body.components || [],
  };
  if (!payload.name || !payload.components.length) throw new ApiError("name and components are required", 400, "bad_request");
  const data = await metaRequest(`/${config.waba_id}/message_templates`, {
    accessToken: config.access_token,
    method: "POST",
    body: payload,
  });
  const doc = {
    accountId,
    userId,
    ...payload,
    status: data.status || "PENDING",
    meta_template_id: data.id,
    ...timestamps(true),
  };
  const result = await collection(collections.whatsappTemplates).insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

export async function proxyMedia(accountId, mediaId) {
  const config = await getWhatsAppConfig(accountId);
  const meta = await metaRequest(`/${mediaId}`, { accessToken: config.access_token });
  if (!meta.url) throw new ApiError("Media URL not found", 404, "not_found");
  const response = await fetch(meta.url, { headers: { Authorization: `Bearer ${config.access_token}` } });
  if (!response.ok) throw new ApiError(`Media download failed: ${response.status}`, response.status, "media_error");
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || meta.mime_type || "application/octet-stream",
  };
}

export async function sendBroadcast(accountId, userId, body = {}) {
  const contactIds = Array.isArray(body.contact_ids) ? body.contact_ids : [];
  const filter = contactIds.length
    ? { _id: { $in: contactIds.map(parseId) }, ...accountScope(accountId) }
    : accountScope(accountId);
  const contacts = await collection(collections.contacts).find(filter).toArray();
  const broadcast = {
    accountId,
    userId,
    name: body.name || `Broadcast ${new Date().toISOString()}`,
    status: "running",
    total_count: contacts.length,
    sent_count: 0,
    failed_count: 0,
    started_at: new Date().toISOString(),
    ...timestamps(true),
  };
  const result = await collection(collections.broadcasts).insertOne(broadcast);
  const failures = [];
  let sent = 0;
  for (const contact of contacts) {
    try {
      const activeOptOut = contact.opted_out || await collection(collections.optOuts).findOne({
        ...accountScope(accountId),
        channel: "whatsapp",
        $or: [
          { contact_id: contact._id.toString() },
          { phone: contact.phone },
          { phone: contact.wa_id },
        ],
      });
      if (activeOptOut) {
        throw new ApiError("Contact has opted out of WhatsApp campaigns", 409, "contact_opted_out");
      }
      if (contact.dnd_until && new Date(contact.dnd_until).getTime() > Date.now()) {
        throw new ApiError("Contact is currently in DND window", 409, "contact_dnd");
      }
      await sendMessageForAccount({
        accountId,
        userId,
        contactId: contact._id.toString(),
        body,
        senderType: "agent",
      });
      sent += 1;
    } catch (err) {
      failures.push({ contact_id: contact._id.toString(), error: err.message });
    }
  }
  await collection(collections.broadcasts).updateOne(
    { _id: result.insertedId },
    { $set: { status: failures.length ? "completed_with_errors" : "completed", sent_count: sent, failed_count: failures.length, failures, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
  );
  return { id: result.insertedId.toString(), total: contacts.length, sent, failed: failures.length, failures };
}

export function makeRunId() {
  return crypto.randomUUID();
}
