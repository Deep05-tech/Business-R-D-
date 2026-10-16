import { MongoClient, Db } from "mongodb";
import { createLogger } from "./logger.js";

const logger = createLogger("MongoDB");

let client: MongoClient | null = null;
let dbInstance: Db | null = null;
let isConnecting = false;
let lastFailureTime = 0;
const FAILURE_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown before attempting reconnection

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI || process.env.MONGO_URI);
}

export async function getMongoDb(): Promise<Db | null> {
  const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || "").trim();
  if (!uri) return null;

  if (dbInstance) return dbInstance;

  // Circuit breaker: If a previous connection attempt failed, do not block on DNS timeouts or spam logs
  const now = Date.now();
  if (now - lastFailureTime < FAILURE_COOLDOWN_MS) {
    return null;
  }

  if (isConnecting) {
    let waited = 0;
    while (isConnecting && waited < 3000) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
      if (dbInstance) return dbInstance;
    }
  }

  isConnecting = true;
  try {
    if (!client) {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
      });
    }
    await client.connect();
    dbInstance = client.db();
    lastFailureTime = 0;
    logger.success("Connected to MongoDB successfully for cloud persistence.");
    return dbInstance;
  } catch (err: any) {
    lastFailureTime = Date.now();
    logger.warn(`MongoDB connection unavailable: ${err.message}. Falling back to filesystem storage (retrying in 60s).`);
    if (client) {
      try { await client.close(); } catch {}
    }
    client = null;
    dbInstance = null;
    return null;
  } finally {
    isConnecting = false;
  }
}
