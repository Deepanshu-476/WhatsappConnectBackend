import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";

import { connectDb } from "./config/db.js";
import accountRoutes from "./routes/account.js";
import activitiesRoutes from "./routes/activities.js";
import aiRoutes from "./routes/ai.js";
import analyticsRoutes from "./routes/analytics.js";
import assignmentsRoutingRoutes from "./routes/assignments-routing.js";
import automationRoutes from "./routes/automations.js";
import authRoutes from "./routes/auth.js";
import billingRoutes from "./routes/billing.js";
import campaignRoutes from "./routes/campaigns.js";
import campaignSettingsRoutes from "./routes/campaign-settings.js";
import channelsRoutes from "./routes/channels.js";
import contactRoutes from "./routes/contacts.js";
import crmSettingsRoutes from "./routes/crm-settings.js";
import dataRoutes from "./routes/data.js";
import dashboardRoutes from "./routes/dashboard.js";
import deliverabilityRoutes from "./routes/deliverability.js";
import formsRoutes from "./routes/forms.js";
import flowRoutes from "./routes/flows.js";
import integrationsRoutes from "./routes/integrations.js";
import invitationRoutes from "./routes/invitations.js";
import leadScoringRoutes from "./routes/lead-scoring.js";
import leadRoutes from "./routes/leads.js";
import notificationRoutes from "./routes/notifications.js";
import optOutRoutes from "./routes/opt-outs.js";
import quickReplyRoutes from "./routes/quick-replies.js";
import remindersRoutes from "./routes/reminders.js";
import settingsRoutes from "./routes/settings.js";
import tagRoutes from "./routes/tags.js";
import templatesRoutes from "./routes/templates.js";
import v1Routes from "./routes/v1.js";
import apiWebhookRoutes from "./routes/api-webhooks.js";
import walletRoutes from "./routes/wallet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

const app = express();
const port = process.env.PORT || 5000;
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/activities", activitiesRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/assignments", assignmentsRoutingRoutes);
app.use("/api/automations", automationRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/campaign-settings", campaignSettingsRoutes);
app.use("/api/channels", channelsRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/crm-settings", crmSettingsRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/deliverability", deliverabilityRoutes);
app.use("/api/forms", formsRoutes);
app.use("/api/flows", flowRoutes);
app.use("/api/integrations", integrationsRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/lead-scoring", leadScoringRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/opt-outs", optOutRoutes);
app.use("/api/quick-replies", quickReplyRoutes);
app.use("/api/reminders", remindersRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/tags", tagRoutes);
app.use("/api/templates", templatesRoutes);
app.use("/api/v1", v1Routes);
app.use("/api/webhooks", apiWebhookRoutes);
app.use("/api/wallet", walletRoutes);

connectDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`WACRM backend listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start backend:", error);
    process.exit(1);
  });
