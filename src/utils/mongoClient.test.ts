import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getMongoDb, isMongoConfigured, resetMongoStateForTesting } from "./mongoClient.js";

describe("mongoClient", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetMongoStateForTesting();
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;
  });

  afterEach(() => {
    resetMongoStateForTesting();
    process.env = { ...originalEnv };
  });

  it("returns null and reports unconfigured when no URI is set", async () => {
    expect(isMongoConfigured()).toBe(false);
    const db = await getMongoDb();
    expect(db).toBeNull();
  });

  it("instantly fails fast and latches disabled for known decommissioned clusters", async () => {
    process.env.MONGODB_URI = "mongodb+srv://admin:pass@pp2.zm1i9q2.mongodb.net/test?retryWrites=true&w=majority";
    expect(isMongoConfigured()).toBe(true);

    const start = Date.now();
    const db = await getMongoDb();
    const duration = Date.now() - start;

    expect(db).toBeNull();
    // Must be instantaneous (< 50ms), no DNS timeouts
    expect(duration).toBeLessThan(50);
    // After latching, isMongoConfigured should report false to skip cloud operations
    expect(isMongoConfigured()).toBe(false);

    // Subsequent calls must also be instantaneous
    const db2 = await getMongoDb();
    expect(db2).toBeNull();
  });

  it("shares single flight connection promise across concurrent callers", async () => {
    process.env.MONGODB_URI = "mongodb+srv://admin:pass@pp2.zm1i9q2.mongodb.net/test?retryWrites=true&w=majority";

    const [res1, res2, res3] = await Promise.all([
      getMongoDb(),
      getMongoDb(),
      getMongoDb()
    ]);

    expect(res1).toBeNull();
    expect(res2).toBeNull();
    expect(res3).toBeNull();
    expect(isMongoConfigured()).toBe(false);
  });
});
