import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { StructuredMemory } from "../types.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("Memory Store");

export interface QueryResult {
  found: boolean;
  answer: string;
  evidence: string[];
  confidence: "high" | "medium" | "low" | "none";
}

export class MemoryStore {
  constructor(private readonly directory = "data/memory") {}

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async save(memory: StructuredMemory): Promise<string> {
    await mkdir(this.directory, { recursive: true });
    
    // Generate Vector Knowledge Base
    memory.vectorKnowledgeBase = await this.generateVectorKnowledgeBase(memory);

    const officialName = memory.businessIdentity.officialName ?? new URL(memory.input.websiteUrl).hostname;
    const cleanName = officialName.replace(/[<>:"/\\|?*\x00-\x1F\s]/g, "_").trim() || "unknown-business";
    const domainName = new URL(memory.input.websiteUrl).hostname.replace(/^www\./, "").replace(/\./g, "_");
    const fileName = `${cleanName}_${domainName}`;
    const filePath = join(this.directory, `${fileName}.json`);
    
    await writeFile(filePath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
    return filePath;
  }

  // ---------------------------------------------------------------------------
  // Lookup by site URL
  // ---------------------------------------------------------------------------

  async loadBySite(websiteUrl: string): Promise<StructuredMemory | null> {
    try {
      const files = await readdir(this.directory);
      
      let latestMemory: StructuredMemory | null = null;
      let latestMtime = 0;

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        
        try {
          const filePath = join(this.directory, file);
          const raw = await readFile(filePath, "utf8");
          const memory = JSON.parse(raw) as StructuredMemory;
          
          if (memory.input?.websiteUrl === websiteUrl) {
             const stat = await import("node:fs/promises").then(fs => fs.stat(filePath));
             if (stat.mtimeMs > latestMtime) {
               latestMtime = stat.mtimeMs;
               latestMemory = memory;
             }
          }
        } catch (e) {
          // ignore parsing errors for individual files
        }
      }
      return latestMemory;
    } catch {
      // directory may not exist yet
    }
    return null;
  }

  async loadAll(): Promise<StructuredMemory[]> {
    try {
      const files = await readdir(this.directory);
      const results: StructuredMemory[] = [];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(this.directory, file), "utf8");
          results.push(JSON.parse(raw) as StructuredMemory);
        } catch {
          // skip malformed files
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Vector Query engine (Top-K Semantic Search — max 4000 tokens)
  // ---------------------------------------------------------------------------

  async query(memory: StructuredMemory, question: string): Promise<QueryResult> {
    if (!memory.vectorKnowledgeBase?.facts || memory.vectorKnowledgeBase.facts.length === 0) {
      return { found: false, answer: "No vector knowledge base available.", evidence: [], confidence: "none" };
    }

    let questionEmbedding: number[];
    try {
      const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
      questionEmbedding = await embeddings.embedQuery(question);
    } catch (e) {
      logger.warn("Failed to generate query embedding via OpenAI. Falling back to mock.");
      questionEmbedding = this.mockEmbed(question);
    }
    
    // Calculate cosine similarity for all facts
    const scoredFacts = memory.vectorKnowledgeBase.facts.map((fact) => ({
      ...fact,
      score: this.cosineSimilarity(questionEmbedding, fact.embedding)
    }));

    // Sort by most relevant
    scoredFacts.sort((a, b) => b.score - a.score);

    // Enforce 4000 token limit
    const MAX_TOKENS = 4000;
    let currentTokens = 0;
    const topKFacts: string[] = [];

    for (let i = 0; i < scoredFacts.length; i++) {
      const fact = scoredFacts[i];
      if (currentTokens + fact.tokens > MAX_TOKENS) break;
      
      // Always include top 5 facts regardless of score (for generic questions),
      // then include any remaining facts that beat the relevance threshold.
      if (i < 5 || fact.score > 0.25) { 
        topKFacts.push(fact.text);
        currentTokens += fact.tokens;
      }
    }

    if (topKFacts.length > 0) {
      return {
        found: true,
        answer: "Raw facts retrieved.",
        evidence: topKFacts,
        confidence: "high"
      };
    }

    return { found: false, answer: "No semantically relevant facts found.", evidence: [], confidence: "low" };
  }

  // ---------------------------------------------------------------------------
  // Vector Math & Embedding Generation
  // ---------------------------------------------------------------------------

  private async generateVectorKnowledgeBase(memory: StructuredMemory) {
    const facts: Array<{ text: string; source: string; tokens: number; embedding: number[] }> = [];

    const rawFacts: Array<{text: string, source: string}> = [];

    const addFact = (text: string, source: string) => {
      if (text) rawFacts.push({ text, source });
    };

    if (memory.businessIdentity?.officialName) addFact(`Official Name: ${memory.businessIdentity.officialName}`, "Identity");
    if (memory.industryClassification?.industry) addFact(`Industry: ${memory.industryClassification.industry}`, "Identity");
    if (memory.businessIdentity?.businessModel) addFact(`Business Model: ${memory.businessIdentity.businessModel}`, "Identity");
    
    (memory.offerings?.products || []).forEach(p => {
      const features = Array.isArray(p.keyFeatures) ? p.keyFeatures.join(", ") : (p.keyFeatures || "N/A");
      addFact(`Product Name: ${p.name}\nCategory: ${p.category || "General"}\nDescription: ${p.description || "N/A"}\nFeatures: ${features}`, "Products");
    });
    
    (memory.offerings?.services || []).forEach(s => {
      const apps = Array.isArray(s.applications) ? s.applications.join(", ") : (s.applications || "N/A");
      addFact(`Service Name: ${s.name}\nDescription: ${s.description || "N/A"}\nApplications: ${apps}`, "Services");
    });
    
    (memory.processes?.processes || []).forEach(p => {
      addFact(`Process: ${p.name}\nDescription: ${p.description || "N/A"}`, "Processes");
    });

    (memory.audience?.buyerPersonas || []).forEach(b => addFact(`Target Persona: ${b}`, "Audience"));
    (memory.audience?.targetIndustries || []).forEach(i => addFact(`Target Industry: ${i}`, "Audience"));
    (memory.offerings?.valuePropositions || []).forEach(v => addFact(`Value Proposition / USP: ${v}`, "Value Prop"));

    (memory.rdInsights?.opportunities || []).forEach(o => addFact(`R&D Opportunity: ${o}`, "R&D"));

    if (rawFacts.length === 0) return { facts };

    try {
      const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
      const texts = rawFacts.map(f => f.text);
      const vectors = await embeddings.embedDocuments(texts);
      
      for (let i = 0; i < rawFacts.length; i++) {
        facts.push({
          text: rawFacts[i].text,
          source: rawFacts[i].source,
          tokens: Math.ceil(rawFacts[i].text.length / 4), // simple rough estimate
          embedding: vectors[i]
        });
      }
    } catch (e) {
      logger.warn("OpenAIEmbeddings failed. Using mock embeddings as fallback.", e);
      for (const f of rawFacts) {
        facts.push({
          ...f,
          tokens: Math.ceil(f.text.length / 4),
          embedding: this.mockEmbed(f.text)
        });
      }
    }


    return { facts };
  }

  private mockEmbed(text: string): number[] {
    const vec = new Array(128).fill(0); // Using 128-dim for mock speed
    for(let i=0; i<text.length; i++) {
        vec[i % 128] += text.charCodeAt(i) / 255.0;
    }
    const mag = Math.sqrt(vec.reduce((sum, val) => sum + val*val, 0));
    return vec.map(v => v / (mag || 1));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
     let dotProduct = 0;
     for (let i = 0; i < a.length; i++) dotProduct += a[i] * b[i];
     return dotProduct;
  }

}
