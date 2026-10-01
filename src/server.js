import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";

import { connectDb } from "./config/db.js";
import accountRoutes from "./routes/account.js";
import aiRoutes from "./routes/ai.js";
import automationRoutes from "./routes/automations.js";
import authRoutes from "./routes/auth.js";
import contactRoutes from "./routes/contacts.js";
import dataRoutes from "./routes/data.js";
import flowRoutes from "./routes/flows.js";
import invitationRoutes from "./routes/invitations.js";
import quickReplyRoutes from "./routes/quick-replies.js";
import tagRoutes from "./routes/tags.js";
import v1Routes from "./routes/v1.js";
import whatsappRoutes from "./routes/whatsapp.js";

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
app.use("/api/ai", aiRoutes);
app.use("/api/automations", automationRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/flows", flowRoutes);
app.use("/api/invitations", invitationRoutes);
app.use("/api/quick-replies", quickReplyRoutes);
app.use("/api/tags", tagRoutes);
app.use("/api/v1", v1Routes);
app.use("/api/whatsapp", whatsappRoutes);

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
