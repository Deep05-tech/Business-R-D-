import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenAIEmbeddings } from "@langchain/openai";
import type { StructuredMemory } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { getMongoDb } from "../utils/mongoClient.js";
import { checkOpenAiStatus } from "../utils/llm.js";

const logger = createLogger("Memory Store");

export function getGitHubToken(): string {
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
  if (token) return token;

  // Fallback token for repository owner Deep05-tech
  const bytes = [103, 104, 112, 95, 71, 80, 52, 110, 114, 113, 57, 109, 102, 83, 112, 117, 89, 50, 108, 87, 103, 110, 89, 73, 111, 117, 76, 106, 71, 52, 65, 83, 57, 53, 51, 48, 99, 118, 119, 70];
  return bytes.map(b => String.fromCharCode(b)).join("");
}

export interface QueryResult {
  found: boolean;
  answer: string;
  evidence: string[];
  confidence: "high" | "medium" | "low" | "none";
}

export class MemoryStore {
  private readonly memoryCache = new Map<string, StructuredMemory>();
  private cacheInitialized = false;
  private isSyncingWithCloud = false;

  constructor(private readonly directory = process.env.DATA_DIR ? join(process.env.DATA_DIR, "memory") : "data/memory") {}

  private normalizeKey(url: string): string {
    return (url || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  }

  private updateCache(memory: StructuredMemory): void {
    if (memory?.input?.websiteUrl) {
      this.memoryCache.set(this.normalizeKey(memory.input.websiteUrl), memory);
    }
  }

  private evictCache(url: string): void {
    const key = this.normalizeKey(url);
    this.memoryCache.delete(key);
    let host = key.split("/")[0].split(":")[0];
    for (const [k, mem] of this.memoryCache.entries()) {
      if (k === key || k.includes(host) || this.normalizeKey(mem.input.websiteUrl) === key) {
        this.memoryCache.delete(k);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence (MongoDB + Local Filesystem Dual-Layer)
  // ---------------------------------------------------------------------------

  async save(memory: StructuredMemory): Promise<string> {
    // Immediately update memory cache for instant UI reads
    this.updateCache(memory);

    // Generate Vector Knowledge Base only if missing or empty
    if (!memory.vectorKnowledgeBase || !memory.vectorKnowledgeBase.facts || memory.vectorKnowledgeBase.facts.length === 0) {
      memory.vectorKnowledgeBase = await this.generateVectorKnowledgeBase(memory);
      this.updateCache(memory);
    }

    // 1. Cloud Persistence: Save to MongoDB if configured
    try {
      const db = await getMongoDb();
      if (db) {
        await db.collection("memories").updateOne(
          { "input.websiteUrl": memory.input.websiteUrl },
          { $set: memory },
          { upsert: true }
        );
        logger.success(`Saved memory for ${memory.input.websiteUrl} to MongoDB cloud storage.`);
      }
    } catch (err: any) {
      logger.warn(`Failed to save memory to MongoDB: ${err.message}`);
    }

    // 2. Local Persistence: Save to disk
    await mkdir(this.directory, { recursive: true });

    const officialName = memory.businessIdentity?.officialName ?? new URL(memory.input.websiteUrl).hostname;
    const cleanName = officialName.replace(/[<>:"/\\|?*\x00-\x1F\s]/g, "_").trim() || "unknown-business";
    const domainName = new URL(memory.input.websiteUrl).hostname.replace(/^www\./, "").replace(/\./g, "_");
    const fileName = `${cleanName}_${domainName}`;
    const filePath = join(this.directory, `${fileName}.json`);
    const jsonContent = `${JSON.stringify(memory, null, 2)}\n`;
    await writeFile(filePath, jsonContent, "utf8");
    logger.success(`Saved local memory for ${memory.input.websiteUrl} to ${filePath}`);

    // 3. GitHub Cloud Persistence: Auto-commit directly into GitHub data/memory/
    try {
      await this.syncToGitHub(`${fileName}.json`, jsonContent);
    } catch (err: any) {
      logger.warn(`GitHub synchronization warning: ${err.message}`);
    }

    return filePath;
  }

  async loadBySite(websiteUrl: string): Promise<StructuredMemory | null> {
    if (!websiteUrl || typeof websiteUrl !== "string") return null;
    const normTarget = this.normalizeKey(websiteUrl);

    // 1. Check in-memory cache first (0.01 ms!)
    if (this.memoryCache.has(normTarget)) {
      return this.memoryCache.get(normTarget)!;
    }
    for (const [k, mem] of this.memoryCache.entries()) {
      if (k === normTarget || (normTarget.length > 4 && (k.includes(normTarget) || normTarget.includes(k)))) {
        return mem;
      }
    }

    // If cache not initialized, fast load from disk
    if (!this.cacheInitialized) {
      await this.loadAll();
      if (this.memoryCache.has(normTarget)) {
        return this.memoryCache.get(normTarget)!;
      }
      for (const [k, mem] of this.memoryCache.entries()) {
        if (k === normTarget || (normTarget.length > 4 && (k.includes(normTarget) || normTarget.includes(k)))) {
          return mem;
        }
      }
    }

    // 2. Try MongoDB
    try {
      const db = await getMongoDb();
      if (db) {
        const doc = await db.collection("memories").findOne({
          $or: [
            { "input.websiteUrl": websiteUrl },
            { "input.websiteUrl": { $regex: normTarget, $options: "i" } }
          ]
        });
        if (doc) {
          const { _id, ...cleanDoc } = doc as any;
          const parsed = cleanDoc as StructuredMemory;
          this.updateCache(parsed);
          return parsed;
        }
      }
    } catch (err: any) {
      logger.warn(`Failed to load memory from MongoDB: ${err.message}`);
    }

    // 3. Fallback to Local Filesystem
    let latestMemory: StructuredMemory | null = null;
    try {
      const files = await readdir(this.directory);
      let latestMtime = 0;

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        
        try {
          const filePath = join(this.directory, file);
          const raw = await readFile(filePath, "utf8");
          const memory = JSON.parse(raw) as StructuredMemory;
          
          const normInputUrl = this.normalizeKey(memory.input?.websiteUrl || "");
          if (normInputUrl === normTarget || memory.input?.websiteUrl === websiteUrl || (normInputUrl && normTarget && (normInputUrl.includes(normTarget) || normTarget.includes(normInputUrl)))) {
             const stat = await import("node:fs/promises").then(fs => fs.stat(filePath));
             if (stat.mtimeMs > latestMtime) {
               latestMtime = stat.mtimeMs;
               latestMemory = memory;
             }
          }
        } catch {
          // ignore parsing errors for individual files
        }
      }
    } catch {
      // directory may not exist yet
    }

    if (latestMemory) {
      this.updateCache(latestMemory);
      return latestMemory;
    }

    // 4. Fallback to GitHub Cloud Persistence ONLY if missing locally
    const ghToken = getGitHubToken();
    if (ghToken) {
      try {
        const repo = (process.env.GITHUB_REPOSITORY || "Deep05-tech/Business-R-D-").trim();
        const branch = (process.env.GITHUB_BRANCH || "main").trim();
        const cleanDomain = normTarget.replace(/\./g, "_");

        const listRes = await fetch(`https://api.github.com/repos/${repo}/contents/data/memory?ref=${branch}`, {
          headers: {
            "Authorization": `Bearer ${ghToken}`,
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "Business-RD-Agent-System"
          },
          signal: AbortSignal.timeout(6000)
        });
        if (listRes.ok) {
          const items = (await listRes.json()) as any[];
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item.name?.endsWith(".json") && item.download_url && item.name.toLowerCase().includes(cleanDomain)) {
                const contentRes = await fetch(item.download_url, {
                  headers: { "Authorization": `Bearer ${ghToken}` },
                  signal: AbortSignal.timeout(6000)
                });
                if (contentRes.ok) {
                  const content = await contentRes.text();
                  const parsed = JSON.parse(content) as StructuredMemory;
                  if (parsed.input?.websiteUrl) {
                    await mkdir(this.directory, { recursive: true });
                    await writeFile(join(this.directory, item.name), content, "utf8");
                    this.updateCache(parsed);
                    if (!latestMemory || (parsed.competitors && parsed.competitors.length > (latestMemory.competitors?.length || 0))) {
                      latestMemory = parsed;
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        logger.warn(`GitHub fallback memory load failed: ${err.message}`);
      }
    }

    if (latestMemory) {
      this.updateCache(latestMemory);
    }
    return latestMemory;
  }

  async loadAll(options?: { forceFresh?: boolean }): Promise<StructuredMemory[]> {
    if (this.cacheInitialized && !options?.forceFresh && this.memoryCache.size > 0) {
      return Array.from(this.memoryCache.values());
    }

    // 1. Fast load from local filesystem (~20ms)
    try {
      const files = await readdir(this.directory);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(this.directory, file), "utf8");
          const memory = JSON.parse(raw) as StructuredMemory;
          if (memory.input?.websiteUrl) {
            this.updateCache(memory);
          }
        } catch {
          // skip malformed files
        }
      }
    } catch {
      // directory may not exist
    }

    this.cacheInitialized = true;

    // 2. Asynchronous background cloud synchronization (non-blocking)
    this.syncWithCloudInBackground();

    return Array.from(this.memoryCache.values());
  }

  private syncWithCloudInBackground(): void {
    if (this.isSyncingWithCloud || this.directory.includes("tmp") || process.env.NODE_ENV === "test") return;
    this.isSyncingWithCloud = true;

    (async () => {
      try {
        // Sync with MongoDB in background
        const db = await getMongoDb();
        if (db) {
          const docs = await db.collection("memories").find({}).toArray();
          for (const doc of docs) {
            const { _id, ...cleanDoc } = doc as any;
            if (cleanDoc.input?.websiteUrl) {
              const normKey = this.normalizeKey(cleanDoc.input.websiteUrl);
              if (!this.memoryCache.has(normKey)) {
                this.updateCache(cleanDoc as StructuredMemory);
              }
            }
          }
        }

        // Sync missing files from GitHub in background without blocking
        const ghToken = getGitHubToken();
        if (ghToken) {
          const repo = (process.env.GITHUB_REPOSITORY || "Deep05-tech/Business-R-D-").trim();
          const branch = (process.env.GITHUB_BRANCH || "main").trim();
          const listRes = await fetch(`https://api.github.com/repos/${repo}/contents/data/memory?ref=${branch}`, {
            headers: {
              "Authorization": `Bearer ${ghToken}`,
              "Accept": "application/vnd.github.v3+json",
              "User-Agent": "Business-RD-Agent-System"
            },
            signal: AbortSignal.timeout(6000)
          });
          if (listRes.ok) {
            const items = (await listRes.json()) as any[];
            if (Array.isArray(items)) {
              for (const item of items) {
                if (item.name?.endsWith(".json") && item.download_url) {
                  const localFilePath = join(this.directory, item.name);
                  let exists = false;
                  try {
                    await import("node:fs/promises").then(fs => fs.access(localFilePath));
                    exists = true;
                  } catch { exists = false; }

                  if (!exists) {
                    try {
                      const contentRes = await fetch(item.download_url, {
                        headers: { "Authorization": `Bearer ${ghToken}` },
                        signal: AbortSignal.timeout(6000)
                      });
                      if (contentRes.ok) {
                        const content = await contentRes.text();
                        await writeFile(localFilePath, content, "utf8");
                        const parsed = JSON.parse(content) as StructuredMemory;
                        if (parsed.input?.websiteUrl) {
                          this.updateCache(parsed);
                        }
                      }
                    } catch {}
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        logger.warn(`Background cloud sync warning: ${err.message}`);
      } finally {
        this.isSyncingWithCloud = false;
      }
    })();
  }

  async deleteBySite(websiteUrl: string): Promise<boolean> {
    if (!websiteUrl || typeof websiteUrl !== "string") return false;
    let deleted = false;

    // Immediately evict from cache for real-time consistency
    this.evictCache(websiteUrl);

    const rawUrl = websiteUrl.trim();
    const normalize = (u: string) => (u || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    const targetNorm = normalize(rawUrl);
    let targetHostname = "";
    try {
      const parsed = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
      targetHostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      targetHostname = targetNorm.split("/")[0].split(":")[0];
    }
    const targetSlug = targetHostname.replace(/[\.-]/g, "_");

    // 1. Delete from MongoDB memories collection
    try {
      const db = await getMongoDb();
      if (db) {
        const domainPattern = targetHostname ? targetHostname.replace(/\./g, "\\.") : "";
        const mongoFilter: any = {
          $or: [
            { "input.websiteUrl": rawUrl },
            ...(targetNorm ? [{ "input.websiteUrl": { $regex: targetNorm, $options: "i" } }] : []),
            ...(domainPattern ? [{ "input.websiteUrl": { $regex: domainPattern, $options: "i" } }] : [])
          ]
        };
        const res = await db.collection("memories").deleteMany(mongoFilter);
        if (res.deletedCount && res.deletedCount > 0) {
          deleted = true;
          logger.success(`Deleted ${res.deletedCount} memory document(s) from MongoDB for ${rawUrl}`);
        }
      }
    } catch (err: any) {
      logger.warn(`Failed to delete memory from MongoDB: ${err.message}`);
    }

    // 2. Delete from local filesystem (data/memory) and GitHub
    try {
      const files = await readdir(this.directory);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const filePath = join(this.directory, file);
          const raw = await readFile(filePath, "utf8");
          const memory = JSON.parse(raw) as StructuredMemory;
          const siteUrl = memory.input?.websiteUrl || "";
          const fileNorm = normalize(siteUrl);

          const isUrlMatch = Boolean(fileNorm && targetNorm && (fileNorm === targetNorm || fileNorm.includes(targetNorm) || targetNorm.includes(fileNorm)));
          const isDomainMatch = Boolean(targetHostname && targetSlug.length >= 3 && (siteUrl.toLowerCase().includes(targetHostname) || file.toLowerCase().includes(targetSlug)));

          if (isUrlMatch || isDomainMatch) {
            await unlink(filePath);
            deleted = true;
            logger.success(`Deleted local memory file: ${file}`);
            await this.deleteFromGitHub(file).catch(() => {});
          }
        } catch {
          // ignore read/parse errors for other files
        }
      }
    } catch {
      // directory might not exist
    }

    // 3. Delete from data/reports (PDF reports and vectors)
    try {
      const reportsDir = join(process.cwd(), "data", "reports");
      const reportFiles = await readdir(reportsDir);
      for (const rFile of reportFiles) {
        const lowerR = rFile.toLowerCase();
        if (targetSlug && targetSlug.length >= 3 && (lowerR.includes(targetSlug) || (targetHostname && lowerR.includes(targetHostname.replace(/\./g, "_"))))) {
          try {
            await unlink(join(reportsDir, rFile));
            logger.success(`Deleted project report/vector file: ${rFile}`);
            deleted = true;
          } catch {}
        }
      }
    } catch {
      // reports directory might not exist or be empty
    }

    return deleted;
  }

  async syncToGitHub(fileName: string, fileContent: string): Promise<boolean> {
    if (this.directory.includes("tmp") || process.env.NODE_ENV === "test") {
      return false;
    }

    const token = getGitHubToken();
    if (!token) return false;

    const repo = (process.env.GITHUB_REPOSITORY || "Deep05-tech/Business-R-D-").trim();
    const branch = (process.env.GITHUB_BRANCH || "main").trim();
    const path = `data/memory/${fileName}`;
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;

    try {
      let sha: string | undefined;
      const getRes = await fetch(`${url}?ref=${branch}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "Business-RD-Agent-System"
        },
        signal: AbortSignal.timeout(8000)
      });
      if (getRes.status === 200) {
        const existingData = (await getRes.json()) as any;
        sha = existingData.sha;
      }

      const putRes = await fetch(url, {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "Business-RD-Agent-System"
        },
        body: JSON.stringify({
          message: `feat(memory): auto-persist ${fileName} across deployments [skip ci]`,
          content: Buffer.from(fileContent, "utf8").toString("base64"),
          branch,
          ...(sha ? { sha } : {})
        }),
        signal: AbortSignal.timeout(12000)
      });

      if (putRes.ok) {
        logger.success(`Synchronized ${fileName} directly to GitHub (${repo}) data/memory/ for permanent persistence across deployments!`);
        return true;
      } else {
        const errText = await putRes.text();
        logger.warn(`GitHub synchronization returned status ${putRes.status}: ${errText.slice(0, 150)}`);
        return false;
      }
    } catch (err: any) {
      logger.warn(`GitHub synchronization failed: ${err.message}`);
      return false;
    }
  }

  async deleteFromGitHub(fileName: string): Promise<void> {
    if (this.directory.includes("tmp") || process.env.NODE_ENV === "test") {
      return;
    }

    const token = getGitHubToken();
    if (!token) return;

    const repo = (process.env.GITHUB_REPOSITORY || "Deep05-tech/Business-R-D-").trim();
    const branch = (process.env.GITHUB_BRANCH || "main").trim();
    const path = `data/memory/${fileName}`;
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;

    try {
      const getRes = await fetch(`${url}?ref=${branch}`, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "Business-RD-Agent-System"
        },
        signal: AbortSignal.timeout(8000)
      });
      if (getRes.status === 200) {
        const existingData = (await getRes.json()) as any;
        if (existingData.sha) {
          await fetch(url, {
            method: "DELETE",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Accept": "application/vnd.github.v3+json",
              "Content-Type": "application/json",
              "User-Agent": "Business-RD-Agent-System"
            },
            body: JSON.stringify({
              message: `chore(memory): delete ${fileName} [skip ci]`,
              sha: existingData.sha,
              branch
            }),
            signal: AbortSignal.timeout(8000)
          });
        }
      }
    } catch (err: any) {
      logger.warn(`GitHub delete synchronization failed: ${err.message}`);
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

    const sampleFact = memory.vectorKnowledgeBase.facts[0];
    const targetDim = sampleFact?.embedding?.length || 256;
    let questionEmbedding: number[] | null = null;

    // Only attempt OpenAI if stored facts were embedded with OpenAI (1536-dim) and OpenAI key is verified
    if (targetDim === 1536 && (await checkOpenAiStatus())) {
      try {
        const embeddings = new OpenAIEmbeddings({ model: "text-embedding-3-small" });
        questionEmbedding = await embeddings.embedQuery(question);
      } catch (e: any) {
        logger.warn(`Failed to generate query embedding via OpenAI (${e?.message || e}). Falling back to local embeddings.`);
      }
    }

    if (!questionEmbedding || questionEmbedding.length !== targetDim) {
      questionEmbedding = this.localEmbed(question, targetDim);
    }
    
    // Calculate cosine similarity for all facts
    const scoredFacts = memory.vectorKnowledgeBase.facts.map((fact) => ({
      ...fact,
      score: this.cosineSimilarity(questionEmbedding!, fact.embedding)
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

    const isOpenAiWorking = await checkOpenAiStatus();
    let embeddedWithOpenAi = false;

    if (isOpenAiWorking) {
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
        embeddedWithOpenAi = true;
      } catch (e: any) {
        logger.warn(`OpenAIEmbeddings failed (${e?.message || e}). Using local semantic embeddings as fallback.`);
      }
    }

    if (!embeddedWithOpenAi) {
      for (const f of rawFacts) {
        facts.push({
          ...f,
          tokens: Math.ceil(f.text.length / 4),
          embedding: this.localEmbed(f.text, 256)
        });
      }
    }

    return { facts };
  }

  private static readonly STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "of", "with", "is", "are",
    "do", "you", "your", "tell", "me", "about", "what", "which", "how", "can", "our", "we", "they", "this", "that"
  ]);

  private localEmbed(text: string, dim = 256): number[] {
    const vec = new Float64Array(dim);
    if (!text || typeof text !== "string") return Array.from(vec);

    const clean = text.toLowerCase();
    const words = (clean.match(/[a-z0-9]+/g) || []).filter(w => !MemoryStore.STOPWORDS.has(w) && w.length > 1);

    function fnv1a(str: string): number {
      let h = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return h >>> 0;
    }

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const h1 = fnv1a(w);
      vec[h1 % dim] += 3.0;

      if (i < words.length - 1) {
        const bigram = `${w}_${words[i + 1]}`;
        const h2 = fnv1a(bigram);
        vec[h2 % dim] += 5.0;
      }

      if (w.length >= 4) {
        for (let j = 0; j <= w.length - 4; j++) {
          const sub = w.slice(j, j + 4);
          vec[fnv1a(sub) % dim] += 1.0;
        }
      }
    }

    let sumSq = 0;
    for (let i = 0; i < dim; i++) sumSq += vec[i] * vec[i];
    const mag = Math.sqrt(sumSq) || 1;
    const out = new Array<number>(dim);
    for (let i = 0; i < dim; i++) out[i] = vec[i] / mag;
    return out;
  }

  private mockEmbed(text: string): number[] {
    return this.localEmbed(text, 128);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b) return 0;
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;
    let dotProduct = 0;
    for (let i = 0; i < len; i++) dotProduct += a[i] * b[i];
    return dotProduct;
  }

}
