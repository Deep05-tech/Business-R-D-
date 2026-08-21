import { ChatOpenAI } from "@langchain/openai";
import axios from "axios";
import { z } from "zod";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";
import { NewsSearchEngine } from "../utils/newsSearchEngine.js";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory, TrendingTopic, TrendingTopicsResult } from "../types.js";

const logger = createLogger("TrendingTopicsAgent");

interface RawSearchHit {
  title: string;
  url: string;
  content: string;
  published_date?: string | null;
}

export class TrendingTopicsAgent {
  readonly name = "trending-topics-agent";
  readonly version = "1.0.0";

  private static cache = new Map<string, { at: number; result: TrendingTopicsResult }>();
  private static readonly CACHE_TTL_MS = 15 * 60 * 1000;
  private static tavilyAvailable = true;

  async run(memory: StructuredMemory): Promise<TrendingTopicsResult> {
    const siteKey = memory.input.websiteUrl;

    const cached = TrendingTopicsAgent.cache.get(siteKey);
    if (cached && Date.now() - cached.at < TrendingTopicsAgent.CACHE_TTL_MS) {
      logger.info(`Serving cached trending topics for ${siteKey} (${cached.result.topics.length} topics).`);
      return cached.result;
    }

    const generatedAt = new Date().toISOString();
    const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.4 });

    const industry = memory.industryClassification?.industry || memory.businessIdentity?.industry || "business";
    const products = (memory.offerings?.products || []).map(p => p.name).filter(Boolean);
    const topProducts = products.slice(0, 5);
    const services = (memory.offerings?.services || []).map(s => s.name).filter(Boolean);
    const topServices = services.slice(0, 3);
    const location = memory.businessIdentity?.location || "";

    // Query per actual product/service so the news feed is about what THIS business makes.
    const queries: string[] = [];
    queries.push(`latest ${industry} industry trends news`);
    for (const product of topProducts.slice(0, 3)) {
      queries.push(`"${product}" ${industry} trends market news`);
    }
    if (topServices.length > 0) {
      queries.push(`"${topServices[0]}" industry trends news`);
    }
    if (location) queries.push(`trending topics ${industry} ${location}`);

    const hits: RawSearchHit[] = [];
    for (const query of queries.slice(0, 5)) {
      const results = await this.search(query);
      hits.push(...results);
    }

    const deduped = this.dedupe(hits).slice(0, 30);
    logger.info(`Trending search returned ${deduped.length} deduplicated results across ${queries.slice(0, 5).length} queries.`);

    if (deduped.length === 0) {
      logger.warn("No search hits found. Returning empty topics (not cached).");
      return { generatedAt, queryContext: queries.join(" | "), topics: [] };
    }

    const searchContext = JSON.stringify(deduped, null, 2).slice(0, 30000);

    const topicsSchema = z.object({
      topics: z.array(z.object({
        title: z.string().describe("A short, punchy name for the trending topic"),
        description: z.string().describe("2-3 sentence explanation of what the trend is about right now"),
        relevance: z.string().describe("Why this trend matters for this specific business and its buyers"),
        angle: z.string().describe("A concrete content angle tying this trend to the business's products/services"),
        relatedProduct: z.string().describe("The EXACT name of the product or service from the business's own offerings list that this topic connects to. Use the exact product/service name as listed. If the trend cannot be tied to any offering the business actually makes, leave this empty"),
        sources: z.array(z.string()).describe("Source URLs supporting this trend (use only real URLs from the search results)")
      }))
    });

    const prompt = `You are a social media trend analyst for a B2B company.
Identify the MOST RELEVANT topics that are trending RIGHT NOW and that relate to the SPECIFIC products/services THIS company makes, based on the live news search results below.

COMPANY CONTEXT:
- Name: ${memory.businessIdentity?.officialName || "Unknown"}
- Industry: ${industry}
- Location: ${location || "Unknown"}
- Products the company makes: ${topProducts.join(" | ") || "None"}
- Services the company offers: ${topServices.join(" | ") || "None"}
- Value Propositions: ${(memory.offerings?.valuePropositions || []).join(", ") || "None"}

LIVE NEWS SEARCH RESULTS:
${searchContext}

YOUR TASK:
Distill the raw news results into up to 8 distinct trending topics that THIS company could ride for social media content.
RULES:
1. ONLY include topics backed by the provided search results — do NOT hallucinate.
2. CRITICAL: EVERY topic MUST be directly connected to at least one product or service from the company's "Products the company makes" / "Services the company offers" lists. Fill "relatedProduct" with that EXACT product/service name. If you cannot connect a trend to something the company actually makes, EXCLUDE that topic — do not include generic industry news that has no link to the company's offerings.
3. Favor topics with recent/dated news (published dates within the last week when available).
4. Rank by relevance to the business first, then by buzz.
5. For each topic give a concrete content angle that references the specific product/service from "relatedProduct".
6. CRITICAL: EVERY topic MUST include at least one real source URL in its "sources" array, copied EXACTLY from the "url" field of the search results. Never invent source URLs and never leave sources empty.`;

    try {
      const structuredLlm = llm.withStructuredOutput(topicsSchema);
      const response = await structuredLlm.invoke(prompt);

      const validProducts = new Set([...topProducts, ...topServices].map(p => p.trim().toLowerCase()));
      const topics: TrendingTopic[] = (response.topics || [])
        .slice(0, 8)
        .filter(t => {
          const linked = (t.relatedProduct || "").trim();
          if (!linked || /none|n\/a|unknown|generic/i.test(linked)) return false;
          const normalized = linked.toLowerCase();
          // Accept only topics that point at a product/service the business actually offers
          // (either an exact listed name, or a substring match against one).
          return [...validProducts].some(p => normalized.includes(p) || p.includes(normalized));
        });

      const result: TrendingTopicsResult = { generatedAt, queryContext: queries.join(" | "), topics };
      if (topics.length > 0) {
        TrendingTopicsAgent.cache.set(siteKey, { at: Date.now(), result });
      }
      logger.info(`Distilled ${topics.length}/${(response.topics || []).length} trending topics tied to this business's offerings for ${siteKey}`);
      return result;
    } catch (e: any) {
      logger.error(`Trending topics distillation failed: ${e.message}`);
      return { generatedAt, queryContext: queries.join(" | "), topics: [] };
    }
  }

  private async search(query: string): Promise<RawSearchHit[]> {
    // 1. Tavily news search (best signal, requires quota)
    if (TrendingTopicsAgent.tavilyAvailable && process.env.TAVILY_API_KEY) {
      try {
        const hits = await this.tavilySearch(query);
        if (hits.length > 0) return hits;

        // Tavily did not throw but returned no usable results (e.g. quota/usage-limit error).
        logger.warn(`Tavily returned no usable results for "${query}". Falling back to news RSS.`);
        TrendingTopicsAgent.tavilyAvailable = false;
      } catch (e: any) {
        const detail = e?.response?.data?.detail?.error || e.message || String(e);
        logger.warn(`Tavily news search failed for "${query}" (${detail}). Falling back to news RSS.`);
        TrendingTopicsAgent.tavilyAvailable = false;
      }
    }

    // 2. Keyless Google/Bing News RSS feeds (no API key required)
    try {
      const news = await new NewsSearchEngine({ maxResults: 8 }).search(query);
      if (news.length > 0) return news;
      logger.warn(`News RSS returned no results for "${query}". Falling back to FreeSearchEngine.`);
    } catch (e: any) {
      logger.warn(`News RSS search failed for "${query}": ${e.message}. Falling back to FreeSearchEngine.`);
    }

    // 3. DDG HTML scraping (last resort)
    return this.fallbackSearch(query);
  }

  private async tavilySearch(query: string): Promise<RawSearchHit[]> {
    const { data } = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: process.env.TAVILY_API_KEY,
        query,
        topic: "news",
        timeRange: "week",
        search_depth: "advanced",
        max_results: 8,
      },
      { timeout: 20000 }
    );

    if (!Array.isArray(data?.results)) return [];
    return data.results.map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      content: r.content || "",
      published_date: r.published_date || r.publish_date || null,
    }));
  }

  private async fallbackSearch(query: string): Promise<RawSearchHit[]> {
    try {
      const engine = new FreeSearchEngine({ maxResults: 6 });
      const raw = await engine.invoke({ query });
      const data = JSON.parse(raw);
      return data.map((r: any) => ({ title: r.title || "", url: r.url || "", content: r.content || "" }));
    } catch (e: any) {
      logger.warn(`FreeSearchEngine trending fallback failed: ${e.message}`);
      return [];
    }
  }

  private dedupe(hits: RawSearchHit[]): RawSearchHit[] {
    const seen = new Set<string>();
    const out: RawSearchHit[] = [];
    for (const hit of hits) {
      const key = (hit.title || hit.url).trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
    }
    return out;
  }
}
