import { MongoClient, Db } from "mongodb";
import { createLogger } from "./logger.js";

const logger = createLogger("MongoDB");

let client: MongoClient | null = null;
let dbInstance: Db | null = null;
let isConnecting = false;

export function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI || process.env.MONGO_URI);
}

export async function getMongoDb(): Promise<Db | null> {
  const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || "").trim();
  if (!uri) return null;

  if (dbInstance) return dbInstance;
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
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
    }
    await client.connect();
    dbInstance = client.db();
    logger.success("Connected to MongoDB successfully for cloud persistence.");
    return dbInstance;
  } catch (err: any) {
    logger.warn(`MongoDB connection unavailable: ${err.message}. Falling back to filesystem storage.`);
    client = null;
    dbInstance = null;
    return null;
  } finally {
    isConnecting = false;
  }
}
