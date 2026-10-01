import dns from "node:dns";
import mongoose from "mongoose";

export async function connectDb() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }

  // If using MongoDB Atlas SRV URI, ensure standard public DNS is available
  // to avoid Windows ECONNREFUSED on querySrv
  if (uri.startsWith("mongodb+srv://")) {
    try {
      dns.setServers(["8.8.8.8", "1.1.1.1"]);
    } catch {
      // Ignore if setServers is not supported in this environment
    }
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 10000,
  });
  console.log("Connected to MongoDB successfully");
}
