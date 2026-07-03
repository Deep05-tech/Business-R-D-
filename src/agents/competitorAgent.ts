import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { createLogger } from "../utils/logger.js";
import { z } from "zod";
import type { StructuredMemory, CompetitorProfile } from "../types.js";

const logger = createLogger("CompetitorAgent");

export class CompetitorAgent {
  readonly name = "competitor-agent";
  readonly version = "2.0.0";

  async run(memory: StructuredMemory): Promise<CompetitorProfile[]> {
    logger.info(`Running competitor research for ${memory.input.websiteUrl}...`);

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.1,
      maxTokens: 8000,
    });

    const businessName = memory.businessIdentity?.officialName || memory.input.websiteUrl;
    
    const coreProductsDetailed = memory.offerings?.products.slice(0, 3).map(p => {
      const specs = Object.entries(p.technicalSpecs || {}).map(([k, v]) => `${k}: ${v}`).join("; ");
      return `- **${p.name}**: ${p.description}\\n  *Specs/Capacity:* ${specs || "Not explicitly specified"}`;
    }).join("\\n") || "Industrial products";

    const memoryContext = JSON.stringify({
      businessIdentity: memory.businessIdentity,
      offerings: memory.offerings,
      industryClassification: memory.industryClassification,
    }, null, 2);

    // --- PHASE 1: Query Generation ---
    logger.info(`Phase 1: Generating custom search queries for ${businessName}...`);
    const queryGenerationPrompt = `You are an elite B2B Market Research Analyst. Your task is to generate 4 broad, highly relevant search queries to find the truest competitors for the following business. Do NOT use overly narrow long-tail keywords. Output ONLY the 4 queries, separated by a newline. Do not use quotes or numbering.
    
BUSINESS EXACT CORE PRODUCTS & CAPACITIES:
${coreProductsDetailed}`;

    let generatedQueries: string[] = [];
    try {
      const queryResponse = await llm.invoke(queryGenerationPrompt);
      const queryText = typeof queryResponse.content === "string" ? queryResponse.content : "";
      generatedQueries = queryText.split("\n").map(q => q.trim().replace(/^\d+\.\s*/, "")).filter(q => q.length > 5).slice(0, 4);
    } catch (e: any) {
      logger.warn(`Failed to generate custom queries: ${e.message}`);
      generatedQueries = [`Top manufacturers like ${businessName}`, `${businessName} competitors`];
    }

    // --- PHASE 2: Tavily Search ---
    let tavilyContext = "";
    try {
      if (process.env.TAVILY_API_KEY) {
        logger.info(`Phase 2: Executing deep web search for competitors...`);
        const searchTool = new TavilySearch({ maxResults: 5 });
        
        for (const query of generatedQueries) {
          try {
            const resultRaw = await searchTool.invoke({ query });
            const parsed = typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw;
            
            const aliveResults = [];
            for (const item of parsed) {
              if (item.url && !item.url.includes("linkedin.com/in/") && !item.url.includes("facebook.com")) {
                aliveResults.push({ url: item.url, title: item.title, content: item.content });
              }
            }
            tavilyContext += `\nSearch Query: ${query}\nResults: ${JSON.stringify(aliveResults)}\n`;
          } catch (parseErr) {
            tavilyContext += `\nSearch Query: ${query}\nResults: Parse error\n`;
          }
        }
      }
    } catch (e: any) {
      logger.warn(`Tavily search failed: ${e.message}`);
    }

    // --- PHASE 3: Synthesis & Social URL Extraction ---
    const competitorSchema = z.object({
      competitors: z.array(z.object({
        name: z.string().describe("Official name of the competitor company"),
        url: z.string().describe("Root domain website URL of the competitor"),
        socials: z.object({
          instagram: z.string().nullable().describe("Instagram URL if known or highly probable based on dorking format (https://instagram.com/[username]). Null if inapplicable."),
          facebook: z.string().nullable().describe("Facebook URL. Null if inapplicable."),
          twitter: z.string().nullable().describe("X/Twitter URL. Null if inapplicable."),
          youtube: z.string().nullable().describe("YouTube Channel URL. Null if inapplicable.")
        })
      })).max(10)
    });

    const synthesisPrompt = `You are an elite B2B Market Research Analyst. Your task is to identify up to 10 highly relevant competitors for the given business and their probable social media handles based on your knowledge and the web search results.

BUSINESS CONTEXT:
${memoryContext}

LIVE WEB SEARCH RESULTS:
${tavilyContext}

INSTRUCTIONS:
1. Identify UP TO 10 true competitors.
2. For each competitor, infer or extract their most likely social media URLs (Instagram, Facebook, X, YouTube). Usually this is https://instagram.com/[companyname], etc. If you are very unsure, output null.
3. Return the data as a JSON array matching the required schema.`;

    try {
      logger.info(`Synthesizing structured competitor report...`);
      const structuredLlm = llm.withStructuredOutput(competitorSchema);
      const response = await structuredLlm.invoke(synthesisPrompt);
      return response.competitors as CompetitorProfile[];
    } catch (e: any) {
      logger.error(`Competitor synthesis failed: ${e.message}`);
      throw e;
    }
  }
}
