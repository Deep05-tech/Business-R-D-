import { MongoClient, Db } from "mongodb";
import { createLogger } from "./logger.js";

const logger = createLogger("MongoDB");

let client: MongoClient | null = null;
let dbInstance: Db | null = null;
let connectPromise: Promise<Db | null> | null = null;
let isPermanentlyDisabled = false;
let lastFailureTime = 0;
const FAILURE_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown before attempting reconnection

export function isMongoConfigured(): boolean {
  if (isPermanentlyDisabled) return false;
  return Boolean(process.env.MONGODB_URI || process.env.MONGO_URI);
}

export function resetMongoStateForTesting(): void {
  client = null;
  dbInstance = null;
  connectPromise = null;
  isPermanentlyDisabled = false;
  lastFailureTime = 0;
}

export async function getMongoDb(): Promise<Db | null> {
  if (isPermanentlyDisabled) return null;

  const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || "").trim();
  if (!uri) return null;

  if (dbInstance) return dbInstance;

  // Immediate fail-fast for known decommissioned/dead clusters to eliminate DNS lag entirely
  if (uri.includes("pp2.zm1i9q2.mongodb.net")) {
    isPermanentlyDisabled = true;
    logger.info("Known decommissioned MongoDB cluster host detected. Operating in standalone local filesystem mode.");
    return null;
  }

  // Circuit breaker: If a previous connection attempt failed, do not block on DNS timeouts or spam logs
  const now = Date.now();
  if (now - lastFailureTime < FAILURE_COOLDOWN_MS) {
    return null;
  }

  // Reuse single flight connection promise across all concurrent callers
  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = (async () => {
    try {
      if (!client) {
        client = new MongoClient(uri, {
          serverSelectionTimeoutMS: 2500,
          connectTimeoutMS: 2500,
        });
      }
      await client.connect();
      dbInstance = client.db();
      lastFailureTime = 0;
      logger.success("Connected to MongoDB successfully for cloud persistence.");
      return dbInstance;
    } catch (err: any) {
      lastFailureTime = Date.now();
      const isDnsFailure =
        err.code === "ENOTFOUND" ||
        err.message?.includes("ENOTFOUND") ||
        err.message?.includes("querySrv ENOTFOUND");

      if (isDnsFailure) {
        isPermanentlyDisabled = true;
        logger.info("MongoDB cluster host not found on DNS (ENOTFOUND). Operating cleanly in standalone local filesystem mode.");
      } else {
        logger.warn(`MongoDB connection unavailable: ${err.message}. Falling back to filesystem storage (retrying in 60s).`);
      }

      if (client) {
        try { await client.close(); } catch {}
      }
      client = null;
      dbInstance = null;
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}
