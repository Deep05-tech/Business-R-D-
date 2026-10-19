import { describe, it, expect, afterEach } from "vitest";
import { MemoryStore } from "./memoryStore.js";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { StructuredMemory } from "../types.js";

describe("MemoryStore Vector Embeddings and Querying", () => {
  const testDir = join(tmpdir(), `test-mem-${Date.now()}`);

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch (_) {}
  });

  const mockMemory: StructuredMemory = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    input: {
      websiteUrl: "https://example-precision-cnc.com",
    },
    businessIdentity: {
      officialName: "Precision CNC Engineering",
      businessModel: "B2B Manufacturing",
    },
    industryClassification: {
      industry: "Industrial Machinery & Components",
    },
    offerings: {
      products: [
        {
          name: "5-Axis CNC Milling Center",
          category: "Machinery",
          description: "High tolerance aerospace grade CNC milling machines",
          keyFeatures: ["5-axis simultaneous", "0.001mm tolerance", "High speed spindle"],
        },
        {
          name: "Precision Lathe Tooling",
          category: "Tooling",
          description: "Carbide tipped insert tools for CNC turning centers",
          keyFeatures: ["Carbide coated", "Vibration dampening"],
        },
      ],
      services: [
        {
          name: "Cloud Fleet Telemetry",
          description: "IoT cloud monitoring for connected factory machines",
          applications: ["Predictive maintenance", "Real-time vibration tracking"],
        },
      ],
    },
    processes: {
      processes: [
        {
          name: "Precision Closed-Die Forging",
          description: "High temperature metal forging process for automotive gears",
        },
      ],
    },
  };

  it("generates vector knowledge base and saves memory without error even when OpenAI is offline", async () => {
    const store = new MemoryStore(testDir);
    const filePath = await store.save(mockMemory);

    expect(filePath).toContain(".json");
    expect(mockMemory.vectorKnowledgeBase).toBeDefined();
    expect(mockMemory.vectorKnowledgeBase?.facts.length).toBeGreaterThan(0);

    const fact = mockMemory.vectorKnowledgeBase!.facts[0];
    expect(fact.embedding).toBeDefined();
    expect(fact.embedding.length).toBe(256);
  });

  it("semantically ranks relevant facts higher than irrelevant facts on query", async () => {
    const store = new MemoryStore(testDir);
    await store.save(mockMemory);

    const queryResult = await store.query(mockMemory, "Do you manufacture 5-axis CNC milling machines?");
    expect(queryResult.found).toBe(true);
    expect(queryResult.evidence.length).toBeGreaterThan(0);
    // Top matching fact should be the 5-Axis CNC Milling Center
    expect(queryResult.evidence[0]).toContain("5-Axis CNC Milling Center");

    const cloudQueryResult = await store.query(mockMemory, "Tell me about cloud IoT monitoring and telemetry");
    expect(cloudQueryResult.found).toBe(true);
    expect(cloudQueryResult.evidence[0]).toContain("Cloud Fleet Telemetry");
  });
});
