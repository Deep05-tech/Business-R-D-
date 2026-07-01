import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";
import type { BusinessIntelligenceProfile } from "../types.js";

const logger = createLogger("VectorStore");

export class VectorStore {
  private readonly ai: GoogleGenerativeAI;
  private readonly modelName = "text-embedding-004";

  constructor() {
    this.ai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);
  }

  async generateAndSave(profile: Omit<BusinessIntelligenceProfile, "qc">, outputPath: string): Promise<void> {
    logger.info("Generating semantic embeddings for the knowledge base...");

    const model = this.ai.getGenerativeModel({ model: this.modelName });
    const facts: Array<{ text: string; source: string; embedding: number[] }> = [];

    try {
      await model.embedContent("health check");
    } catch (err) {
      logger.warn(`Vector API unavailable. Skipping embeddings gracefully. (${err})`);
      return;
    }

    const generate = async (text: string, source: string) => {
      try {
        if (!text || text.trim().length === 0) return;
        const result = await model.embedContent(text);
        facts.push({
          text,
          source,
          embedding: result.embedding.values,
        });
      } catch (err) {
        logger.error(`Failed to embed text for ${source}: ${err}`);
      }
    };

    // Embed Products
    if (profile.offeringsBreakdown.products) {
      for (const p of profile.offeringsBreakdown.products) {
        const text = `PRODUCT: ${p.name}\nDESC: ${p.description}\nFEATURES: ${p.keyFeatures?.join(", ")}\nSPECS: ${JSON.stringify(p.technicalSpecs)}\nUSE CASES: ${p.useCases?.join(", ")}`;
        await generate(text, `Product: ${p.name}`);
      }
    }

    // Embed Services
    if (profile.offeringsBreakdown.services) {
      for (const s of profile.offeringsBreakdown.services) {
        const text = `SERVICE: ${s.name}\nDESC: ${s.description}\nAPPLICATIONS: ${s.applications?.join(", ")}`;
        await generate(text, `Service: ${s.name}`);
      }
    }

    // Embed Processes
    if (profile.processesBreakdown?.processes) {
      for (const p of profile.processesBreakdown.processes) {
        const text = `PROCESS: ${p.name}\nDESC: ${p.description}\nCAPACITY: ${p.capacity}\nMACHINERY: ${p.machineryUsed?.join(", ")}`;
        await generate(text, `Process: ${p.name}`);
      }
    }

    // Save to disk
    try {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(outputPath, JSON.stringify(facts, null, 2));
      logger.info(`Vector knowledge base saved to ${outputPath}`);
    } catch (err) {
      logger.error(`Failed to write vector store to disk: ${err}`);
    }
  }
}
