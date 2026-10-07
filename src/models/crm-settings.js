import mongoose from "mongoose";

export const DEFAULT_CRM_SETTINGS = {
  conversationSettings: {
    statuses: [
      { id: "open", name: "Open", color: "#10b981", isDefault: true, isSystem: true, order: 0 },
      { id: "pending", name: "Pending", color: "#f59e0b", isDefault: false, isSystem: true, order: 1 },
      { id: "in_progress", name: "In Progress", color: "#3b82f6", isDefault: false, isSystem: true, order: 2 },
      { id: "resolved", name: "Resolved", color: "#8b5cf6", isDefault: false, isSystem: true, order: 3 },
      { id: "closed", name: "Closed", color: "#64748b", isDefault: false, isSystem: true, order: 4 },
    ],
    labels: [
      { id: "new", name: "New", color: "#3b82f6", description: "Freshly initiated conversation", order: 0 },
      { id: "follow_up", name: "Follow Up", color: "#f59e0b", description: "Follow up required", order: 1 },
      { id: "interested", name: "Interested", color: "#10b981", description: "High prospect interest", order: 2 },
      { id: "not_interested", name: "Not Interested", color: "#ef4444", description: "Prospect declined", order: 3 },
      { id: "important", name: "Important", color: "#8b5cf6", description: "Priority attention", order: 4 },
      { id: "support_issue", name: "Support Issue", color: "#06b6d4", description: "Customer support query", order: 5 },
      { id: "hot_prospect", name: "Hot Prospect", color: "#ec4899", description: "Ready to purchase", order: 6 },
      { id: "active_customer", name: "Active Customer", color: "#14b8a6", description: "Existing paying client", order: 7 },
    ],
    autoAssignment: {
      enabled: true,
      method: "round_robin", // 'round_robin', 'team', 'user', 'manual'
      defaultUserId: null,
      defaultTeam: "Sales Team",
      roundRobin: true,
      workingHoursOnly: false,
    },
    timeout: {
      enabled: true,
      inactivityHours: 24,
      autoResolve: false,
    },
    allowReopen: true,
    reopenClosedConversations: true,
  },

  leadSettings: {
    statuses: [
      { id: "new", name: "New", color: "#3b82f6", order: 0, isDefault: true, isWon: false, isLost: false },
      { id: "contacted", name: "Contacted", color: "#06b6d4", order: 1, isDefault: false, isWon: false, isLost: false },
      { id: "qualified", name: "Qualified", color: "#8b5cf6", order: 2, isDefault: false, isWon: false, isLost: false },
      { id: "proposal", name: "Proposal", color: "#f59e0b", order: 3, isDefault: false, isWon: false, isLost: false },
      { id: "negotiation", name: "Negotiation", color: "#ec4899", order: 4, isDefault: false, isWon: false, isLost: false },
      { id: "won", name: "Won", color: "#10b981", order: 5, isDefault: false, isWon: true, isLost: false },
      { id: "lost", name: "Lost", color: "#ef4444", order: 6, isDefault: false, isWon: false, isLost: true },
    ],
    sources: [
      { id: "website", name: "Website", isDefault: true },
      { id: "whatsapp", name: "WhatsApp", isDefault: true },
      { id: "referral", name: "Referral", isDefault: true },
      { id: "social_media", name: "Social Media", isDefault: true },
      { id: "advertisement", name: "Advertisement", isDefault: true },
      { id: "cold_outreach", name: "Cold Outreach", isDefault: true },
    ],
    customFields: [
      { id: "deal_value", name: "Deal Value", key: "deal_value", type: "number", required: false, options: [] },
      { id: "company_name", name: "Company Name", key: "company_name", type: "text", required: false, options: [] },
      { id: "industry", name: "Industry", key: "industry", type: "dropdown", required: false, options: ["E-commerce", "SaaS", "Healthcare", "Real Estate", "Education", "Other"] },
    ],
  },

  contactSettings: {
    customFields: [
      { id: "designation", name: "Designation", key: "designation", type: "text", required: false, options: [] },
      { id: "secondary_phone", name: "Secondary Phone", key: "secondary_phone", type: "phone", required: false, options: [] },
      { id: "company", name: "Company", key: "company", type: "text", required: false, options: [] },
    ],
    tags: [
      { id: "vip", name: "VIP", color: "#8b5cf6" },
      { id: "customer", name: "Customer", color: "#10b981" },
      { id: "lead", name: "Lead", color: "#3b82f6" },
      { id: "partner", name: "Partner", color: "#f59e0b" },
    ],
    contactStatus: ["Lead", "Active", "Inactive", "Churned", "Blocked"],
    requiredFields: ["phone"],
    duplicateHandling: "update", // 'update', 'skip', 'allow'
    importSettings: {
      defaultSource: "import",
      autoTag: "imported",
      skipDuplicates: true,
    },
    exportSettings: {
      includeCustomFields: true,
      format: "csv",
    },
  },

  assignmentSettings: {
    mode: "round_robin", // 'manual', 'automatic', 'round_robin', 'team_based', 'user_based'
    autoAssignment: true,
    roundRobin: true,
    teamBased: false,
    userBased: false,
    defaultTeam: "Sales Team",
    defaultUserId: null,
    workingHours: {
      enabled: true,
      timezone: "Asia/Kolkata",
      start: "09:00",
      end: "18:00",
      days: [1, 2, 3, 4, 5],
    },
    reassignmentRules: {
      enabled: true,
      timeoutMinutes: 30,
      reassignToQueue: true,
      fallbackUserId: null,
      notifyTeam: true,
    },
  },

  inboxSettings: {
    defaultInbox: "all",
    defaultStatus: "open",
    autoReply: {
      enabled: false,
      message: "Hello! We have received your message and an agent will be with you shortly.",
    },
    awayMessage: {
      enabled: false,
      message: "We are currently out of office. We will reply as soon as business hours resume.",
      outsideWorkingHours: true,
    },
    conversationTimeoutHours: 24,
    readUnreadSettings: {
      markReadOnOpen: true,
      markUnreadOnReassign: true,
    },
    internalNotes: {
      enabled: true,
      notifyMentions: true,
    },
    agentAvailability: {
      enabled: true,
      autoAwayMinutes: 15,
    },
    typingIndicator: true,
    messageNotification: true,
    soundNotification: true,
  },

  whatsappSettings: {
    channels: [],
    defaultChannelId: null,
    enforceOptOut: true,
    optOutKeywords: ["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT"],
  },

  templateSettings: {
    autoSync: true,
    syncIntervalHours: 12,
    defaultLanguage: "en_US",
    categories: ["MARKETING", "UTILITY", "AUTHENTICATION"],
  },

  aiSettings: {
    enabled: false,
    provider: "openai",
    apiKey: "", // Sensitive
    hasApiKey: false,
    model: "gpt-4o-mini",
    temperature: 0.4,
    maxResponseLength: 500,
    autoReply: false,
    approvalMode: true,
    systemPrompt: "You are a professional WhatsApp CRM AI agent. Keep responses helpful, courteous, and brief.",
    knowledgeSources: [
      {
        id: "kb_standard",
        title: "Standard Business FAQ",
        content: "Frequently asked questions covering company services, support hours, and order details.",
        type: "text",
        enabled: true,
        lastIndexed: new Date().toISOString(),
      },
    ],
    automations: [
      {
        id: "auto_vip",
        name: "VIP Tag Notification & Routing",
        trigger: "New WhatsApp message",
        condition: "Customer has label 'VIP'",
        action: "Assign to Senior Sales Team",
        enabled: true,
      },
      {
        id: "auto_lead",
        name: "Auto-Qualify Inbound Leads",
        trigger: "New WhatsApp message",
        condition: "Message contains pricing or demo",
        action: "Create Lead in 'Qualified' Stage",
        enabled: true,
      },
    ],
  },

  integrationSettings: {
    integrations: [
      {
        id: "whatsapp",
        name: "WhatsApp Cloud API",
        key: "whatsapp",
        category: "Messaging",
        description: "Official Meta WhatsApp Business Cloud API integration for direct messaging and templates",
        icon: "whatsapp",
        status: "disconnected",
        enabled: false,
        webhookUrl: "",
        requiresConfiguration: true,
      },
      {
        id: "openai",
        name: "OpenAI",
        key: "openai",
        category: "AI & ML",
        description: "GPT-4o powered automated replies, message classification, and live chat assistance",
        icon: "bot",
        status: "disconnected",
        enabled: false,
      },
      {
        id: "webhooks",
        name: "Custom Webhooks",
        key: "webhooks",
        category: "Developer",
        description: "Real-time HTTP webhooks for message sent/received, lead score changes, and deal updates",
        icon: "webhook",
        status: "disconnected",
        enabled: false,
        webhookUrl: "/api/webhooks",
        requiresConfiguration: true,
      },
      {
        id: "google_sheets",
        name: "Google Sheets",
        key: "google_sheets",
        category: "Productivity",
        description: "Stream newly captured contacts and leads straight to a designated spreadsheet",
        icon: "sheet",
        status: "disconnected",
        enabled: false,
      },
      {
        id: "external_crm",
        name: "External CRM (Zoho / HubSpot)",
        key: "external_crm",
        category: "CRM",
        description: "Bi-directional synchronization of contact records, pipeline stages, and activities",
        icon: "database",
        status: "disconnected",
        enabled: false,
      },
      {
        id: "rest_api",
        name: "REST API & SDK",
        key: "rest_api",
        category: "Developer",
        description: "Public API key authentication with comprehensive v1 programmatic endpoints",
        icon: "code",
        status: "disconnected",
        enabled: false,
        requiresConfiguration: true,
      },
    ],
  },

  notificationSettings: {
    newMessage: true,
    newLead: true,
    newAssignment: true,
    mentions: true,
    emailNotifications: false,
    browserNotifications: true,
    soundNotifications: true,
  },

  permissionSettings: {
    roles: [
      {
        role: "owner",
        viewCrmSettings: true,
        editCrmSettings: true,
        manageConversations: true,
        manageLeads: true,
        manageContacts: true,
        manageWhatsapp: true,
        manageTemplates: true,
        manageAi: true,
        manageIntegrations: true,
      },
      {
        role: "admin",
        viewCrmSettings: true,
        editCrmSettings: true,
        manageConversations: true,
        manageLeads: true,
        manageContacts: true,
        manageWhatsapp: true,
        manageTemplates: true,
        manageAi: true,
        manageIntegrations: true,
      },
      {
        role: "agent",
        viewCrmSettings: true,
        editCrmSettings: false,
        manageConversations: true,
        manageLeads: true,
        manageContacts: true,
        manageWhatsapp: false,
        manageTemplates: false,
        manageAi: false,
        manageIntegrations: false,
      },
      {
        role: "viewer",
        viewCrmSettings: true,
        editCrmSettings: false,
        manageConversations: false,
        manageLeads: false,
        manageContacts: false,
        manageWhatsapp: false,
        manageTemplates: false,
        manageAi: false,
        manageIntegrations: false,
      },
    ],
  },

  generalSettings: {
    crmName: "WhatsApp CRM",
    timezone: "Asia/Kolkata",
    dateFormat: "DD/MM/YYYY",
    timeFormat: "12h",
    defaultCountry: "IN",
    currency: "INR",
    workingHours: "09:00 - 18:00",
    businessHours: {
      monday: { open: "09:00", close: "18:00", enabled: true },
      tuesday: { open: "09:00", close: "18:00", enabled: true },
      wednesday: { open: "09:00", close: "18:00", enabled: true },
      thursday: { open: "09:00", close: "18:00", enabled: true },
      friday: { open: "09:00", close: "18:00", enabled: true },
      saturday: { open: "10:00", close: "16:00", enabled: false },
      sunday: { open: "10:00", close: "14:00", enabled: false },
    },
    defaultLanguage: "en",
  },
};

const crmSettingsSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      unique: true,
      index: true,
    },
    conversationSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.conversationSettings }),
    },
    leadSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.leadSettings }),
    },
    contactSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.contactSettings }),
    },
    assignmentSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.assignmentSettings }),
    },
    inboxSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.inboxSettings }),
    },
    whatsappSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.whatsappSettings }),
    },
    templateSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.templateSettings }),
    },
    aiSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.aiSettings }),
    },
    integrationSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.integrationSettings }),
    },
    notificationSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.notificationSettings }),
    },
    permissionSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.permissionSettings }),
    },
    generalSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CRM_SETTINGS.generalSettings }),
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

export const CRMSettings = mongoose.model("CRMSettings", crmSettingsSchema);
export default CRMSettings;
