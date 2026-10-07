import mongoose from "mongoose";

export const DEFAULT_CAMPAIGN_SETTINGS = {
  generalSettings: {
    campaignNameFormat: "{{name}} - {{date}}",
    defaultStatus: "draft",
    defaultChannelId: "default",
    defaultTemplate: "",
    defaultTimezone: "Asia/Kolkata",
    defaultCountry: "IN",
    defaultLanguage: "en_US",
    campaignExpirationDays: 30,
    allowCampaignDuplication: true,
    allowEditAfterSchedule: true,
    allowCancellation: true,
  },

  sendingSettings: {
    mode: "immediately", // 'immediately', 'scheduled', 'batch', 'drip'
    sendOneByOne: true,
    batchSending: false,
    batchSize: 50,
    delayBetweenMessages: 3,
    minDelaySeconds: 2,
    maxDelaySeconds: 5,
    randomizeDelay: true,
    humanLikeDelay: true,
    dripIntervalMinutes: 60,
  },

  rateLimitSettings: {
    enabled: true,
    messagesPerMinute: 30,
    messagesPerHour: 500,
    messagesPerDay: 5000,
    maxConcurrentSends: 3,
    perChannelLimit: 2500,
    perUserLimit: 1000,
  },

  audienceSettings: {
    defaultSelection: "all", // 'all', 'selected', 'list', 'segment', 'tags', 'lead_status', 'custom_field'
    preValidationEnabled: true,
    excludeOptedOut: true,
    excludeDuplicates: true,
    excludeInvalidPhones: true,
    defaultFilters: [],
    logicOperator: "AND", // 'AND' | 'OR'
  },

  templateSettings: {
    requireApprovedOnly: true,
    defaultLanguage: "en_US",
    autoMapVariables: true,
    blockOnMissingVariables: true,
    variableFallbacks: {
      first_name: "Customer",
      company: "our valued partner",
    },
  },

  assignmentSettings: {
    mode: "round_robin", // 'manual', 'team', 'round_robin', 'channel'
    defaultTeam: "Sales Team",
    defaultUserId: null,
    roundRobin: true,
    assignRepliesToCampaignOwner: true,
  },

  schedulingSettings: {
    defaultScheduleType: "now", // 'now', 'scheduled', 'recurring'
    defaultTimezone: "Asia/Kolkata",
    recurringAllowed: true,
    defaultSendTime: "10:00",
    recurringOptions: {
      frequency: "weekly",
      daysOfWeek: [1, 2, 3, 4, 5],
    },
  },

  quietHoursSettings: {
    enabled: true,
    start: "21:00",
    end: "09:00",
    timezone: "Asia/Kolkata",
    behavior: "pause", // 'pause' | 'delay'
  },

  retrySettings: {
    enabled: true,
    maxRetries: 3,
    retryDelayMinutes: 5,
    retryableFailures: [
      "temporary",
      "rate_limited",
      "network_error",
      "whatsapp_error",
    ],
  },

  optOutSettings: {
    enabled: true,
    keywords: ["STOP", "UNSUBSCRIBE", "CANCEL", "REMOVE", "END"],
    customKeywords: ["OPTOUT", "QUIT"],
    autoExcludeOptedOut: true,
    requireConfirmationToRemove: true,
    confirmationMessage: "You have been successfully unsubscribed from marketing messages.",
  },

  trackingSettings: {
    trackSent: true,
    trackDelivered: true,
    trackRead: true,
    trackReplied: true,
    trackOptOut: true,
    linkTracking: false,
  },

  notificationSettings: {
    onCampaignStarted: true,
    onCampaignCompleted: true,
    onCampaignFailed: true,
    onCampaignPaused: true,
    onCampaignStopped: true,
    highFailureRateAlert: true,
    highFailureRateThresholdPercent: 15,
    highOptOutRateAlert: true,
    highOptOutRateThresholdPercent: 5,
    channels: {
      inApp: true,
      browser: true,
      email: false,
    },
  },

  automationSettings: {
    automations: [
      {
        id: "auto_1",
        name: "Tag Successful Campaign Delivery",
        trigger: "campaign_completed",
        condition: { metric: "delivery_rate", operator: "gt", value: 80 },
        action: { type: "add_tag", target: "Campaign-Success" },
        enabled: true,
      },
      {
        id: "auto_2",
        name: "Route Campaign Inquiries to Sales",
        trigger: "campaign_reply_received",
        condition: { metric: "is_first_reply", operator: "eq", value: true },
        action: { type: "assign_team", target: "Sales Team" },
        enabled: true,
      },
      {
        id: "auto_3",
        name: "Notify Admins on Critical Failure",
        trigger: "campaign_failed",
        condition: { metric: "failure_rate", operator: "gt", value: 20 },
        action: { type: "notify_admin", target: "email_and_app" },
        enabled: true,
      },
    ],
  },

  channelSettings: {
    defaultChannelId: "primary",
    channels: [
      {
        id: "primary",
        name: "Primary WhatsApp Business",
        phoneNumber: "+91 92059 62984",
        status: "connected",
        qualityRating: "GREEN",
        messagingLimit: "TIER_100K",
        dailyLimit: 100000,
        currentUsage: 1420,
        enabled: true,
      },
      {
        id: "secondary",
        name: "Promotional Channel",
        phoneNumber: "+91 98765 43210",
        status: "connected",
        qualityRating: "GREEN",
        messagingLimit: "TIER_10K",
        dailyLimit: 10000,
        currentUsage: 450,
        enabled: true,
      },
    ],
  },

  integrationSettings: {
    integrations: [
      {
        id: "whatsapp",
        name: "WhatsApp Cloud API",
        description: "Official Meta Graph API messaging engine",
        connected: true,
        enabled: true,
        category: "messaging",
        status: "active",
      },
      {
        id: "google_sheets",
        name: "Google Sheets",
        description: "Sync campaign audience lists and responses",
        connected: true,
        enabled: true,
        category: "productivity",
        status: "active",
      },
      {
        id: "webhooks",
        name: "Outgoing Webhooks",
        description: "Real-time HTTP delivery and read receipts",
        connected: true,
        enabled: true,
        category: "developer",
        status: "active",
      },
      {
        id: "external_crm",
        name: "External CRM Sync",
        description: "Bi-directional lead and campaign sync",
        connected: false,
        enabled: false,
        category: "crm",
        status: "inactive",
      },
      {
        id: "rest_api",
        name: "REST API Access",
        description: "Programmatic campaign trigger endpoints",
        connected: true,
        enabled: true,
        category: "developer",
        status: "active",
      },
      {
        id: "shopify",
        name: "Shopify Store",
        description: "Abandoned cart & order promotional campaigns",
        connected: false,
        enabled: false,
        category: "ecommerce",
        status: "inactive",
      },
    ],
  },

  apiWebhookSettings: {
    webhooks: [
      {
        id: "wh_1",
        name: "Production Webhook",
        url: "https://api.yourdomain.com/webhooks/campaigns",
        events: [
          "campaign.created",
          "campaign.started",
          "campaign.completed",
          "campaign.paused",
          "campaign.stopped",
          "campaign.message.sent",
          "campaign.message.delivered",
          "campaign.message.read",
          "campaign.message.failed",
          "campaign.contact.replied",
          "campaign.contact.opted_out",
        ],
        secret: "whsec_••••••••••••••••••••••••",
        active: true,
      },
    ],
  },

  permissionSettings: {
    roles: [
      {
        role: "owner",
        label: "Account Owner",
        permissions: {
          viewCampaigns: true,
          createCampaign: true,
          editCampaign: true,
          deleteCampaign: true,
          startCampaign: true,
          pauseCampaign: true,
          stopCampaign: true,
          exportCampaign: true,
          viewAnalytics: true,
          manageCampaignSettings: true,
          manageOptOut: true,
          manageChannels: true,
          manageIntegrations: true,
        },
      },
      {
        role: "admin",
        label: "Administrator",
        permissions: {
          viewCampaigns: true,
          createCampaign: true,
          editCampaign: true,
          deleteCampaign: true,
          startCampaign: true,
          pauseCampaign: true,
          stopCampaign: true,
          exportCampaign: true,
          viewAnalytics: true,
          manageCampaignSettings: true,
          manageOptOut: true,
          manageChannels: true,
          manageIntegrations: true,
        },
      },
      {
        role: "agent",
        label: "Agent / Specialist",
        permissions: {
          viewCampaigns: true,
          createCampaign: true,
          editCampaign: true,
          deleteCampaign: false,
          startCampaign: true,
          pauseCampaign: true,
          stopCampaign: true,
          exportCampaign: true,
          viewAnalytics: true,
          manageCampaignSettings: false,
          manageOptOut: false,
          manageChannels: false,
          manageIntegrations: false,
        },
      },
      {
        role: "viewer",
        label: "Read-only Viewer",
        permissions: {
          viewCampaigns: true,
          createCampaign: false,
          editCampaign: false,
          deleteCampaign: false,
          startCampaign: false,
          pauseCampaign: false,
          stopCampaign: false,
          exportCampaign: false,
          viewAnalytics: true,
          manageCampaignSettings: false,
          manageOptOut: false,
          manageChannels: false,
          manageIntegrations: false,
        },
      },
    ],
  },
};

const campaignSettingsSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      unique: true,
      index: true,
    },
    generalSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.generalSettings }),
    },
    sendingSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.sendingSettings }),
    },
    rateLimitSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.rateLimitSettings }),
    },
    audienceSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.audienceSettings }),
    },
    templateSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.templateSettings }),
    },
    assignmentSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.assignmentSettings }),
    },
    schedulingSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.schedulingSettings }),
    },
    quietHoursSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.quietHoursSettings }),
    },
    retrySettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.retrySettings }),
    },
    optOutSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.optOutSettings }),
    },
    trackingSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.trackingSettings }),
    },
    notificationSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.notificationSettings }),
    },
    automationSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.automationSettings }),
    },
    channelSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.channelSettings }),
    },
    integrationSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.integrationSettings }),
    },
    apiWebhookSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.apiWebhookSettings }),
    },
    permissionSettings: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_CAMPAIGN_SETTINGS.permissionSettings }),
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

export const CampaignSettings = mongoose.model("CampaignSettings", campaignSettingsSchema);
export default CampaignSettings;
