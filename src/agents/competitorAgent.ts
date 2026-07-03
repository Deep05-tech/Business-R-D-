import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { createLogger } from "../utils/logger.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import type { StructuredMemory, CompetitorProfile } from "../types.js";

const logger = createLogger("CompetitorAgent");

export class CompetitorAgent {
  readonly name = "competitor-agent";
  readonly version = "3.0.0";

  async run(memory: StructuredMemory): Promise<CompetitorProfile[]> {
    logger.info(`Running true competitor research for ${memory.input.websiteUrl}...`);

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
    const queryGenerationPrompt = `You are an elite B2B Market Research Analyst. Your task is to generate 6 highly relevant search queries to find the truest competitors for the following business.
The first 3 queries MUST focus on LOCAL competitors in the exact country/region of the business.
The next 3 queries MUST focus on GLOBAL competitors worldwide.
Output ONLY the 6 queries, separated by a newline. Do not use quotes or numbering.

BUSINESS EXACT CORE PRODUCTS & CAPACITIES:
${coreProductsDetailed}

BUSINESS IDENTITY:
${JSON.stringify(memory.businessIdentity)}`;

    let generatedQueries: string[] = [];
    try {
      const queryResponse = await llm.invoke(queryGenerationPrompt);
      const queryText = typeof queryResponse.content === "string" ? queryResponse.content : "";
      generatedQueries = queryText.split("\n").map(q => q.trim().replace(/^\d+\.\s*/, "")).filter(q => q.length > 5).slice(0, 6);
    } catch (e: any) {
      generatedQueries = [`Top manufacturers like ${businessName}`, `${businessName} competitors global`, `${businessName} competitors local`];
    }

    // --- PHASE 2: Tavily Search ---
    let tavilyContext = "";
    const searchTool = new TavilySearch({ maxResults: 5 });
    if (process.env.TAVILY_API_KEY) {
      logger.info(`Executing web search for competitors...`);
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

    // --- PHASE 3: Base Competitor Identification ---
    const baseCompetitorSchema = z.object({
      competitors: z.array(z.object({
        name: z.string().describe("Official name of the competitor company"),
        url: z.string().describe("Root domain website URL of the competitor (e.g. https://example.com)"),
        type: z.enum(["local", "global"]).describe("Whether this competitor is local/regional or a global player"),
        location: z.string().describe("The city and country where this competitor is headquartered")
      })).max(40)
    });

    const synthesisPrompt = `You are an elite B2B Market Research Analyst. Identify a backup pool of up to 20 LOCAL competitors and up to 20 GLOBAL competitors for the given business based on the web search results and your knowledge.

BUSINESS CONTEXT:
${memoryContext}

LIVE WEB SEARCH RESULTS:
${tavilyContext}

INSTRUCTIONS:
1. Identify up to 20 true LOCAL competitors (same country/region).
2. Identify up to 20 true GLOBAL competitors (worldwide market leaders). 
3. For GLOBAL competitors, you MUST include the absolute biggest industry giants (e.g., if the industry is forging/flanges, you MUST include Iraeta and similar massive entities). Leverage your vast pre-trained knowledge to fill in major global leaders even if they were omitted from the live search results.
4. Ensure all competitors have their official root domain URLs and headquarters location.
5. Generate as many high-quality backups as possible up to the limits.`;

    let baseCompetitors: Array<{name: string, url: string, type: "local"|"global", location: string}> = [];
    try {
      logger.info(`Synthesizing base competitor list...`);
      const structuredLlm = llm.withStructuredOutput(baseCompetitorSchema);
      const response = await structuredLlm.invoke(synthesisPrompt);
      baseCompetitors = response.competitors;
    } catch (e: any) {
      logger.error(`Competitor synthesis failed: ${e.message}`);
      throw e;
    }

    // --- PHASE 4: Direct Scraping & Dorking for Socials ---
    logger.info(`Phase 4: Filtering for verified social media presence...`);
    const finalCompetitors: CompetitorProfile[] = [];
    
    const localQueue = baseCompetitors.filter(c => c.type === "local");
    const globalQueue = baseCompetitors.filter(c => c.type === "global");

    const processCompetitor = async (comp: any): Promise<CompetitorProfile | null> => {
      const socials: CompetitorProfile["socials"] = { linkedin: null, instagram: null, facebook: null, twitter: null, youtube: null };
      
      try {
        logger.debug(`Scraping ${comp.url}...`);
        const res = await axios.get(comp.url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
        const $ = cheerio.load(res.data);
        
        $('a[href]').each((_, el) => {
          let href = $(el).attr('href') || "";
          if (!href.startsWith('http')) return;
          href = href.toLowerCase();
          
          if (href.includes('linkedin.com/company')) socials.linkedin = href;
          if (href.includes('instagram.com') && !href.includes('/explore/')) socials.instagram = href;
          if (href.includes('facebook.com') && !href.includes('sharer')) socials.facebook = href;
          if ((href.includes('twitter.com') || href.includes('x.com')) && !href.includes('intent')) socials.twitter = href;
          if (href.includes('youtube.com') && !href.includes('/watch')) socials.youtube = href;
        });
      } catch (err) {
        logger.warn(`Could not scrape ${comp.url} directly.`);
      }

      if (!socials.instagram || !socials.youtube || !socials.linkedin || !socials.facebook || !socials.twitter) {
        try {
          const domain = new URL(comp.url).hostname.replace('www.', '');
          const dorkQuery = `(site:linkedin.com/company OR site:instagram.com OR site:youtube.com OR site:facebook.com OR site:twitter.com) ("${comp.name}" OR "${domain}")`;
          const deepDorkTool = new TavilySearch({ maxResults: 20 });
          const dorkResultRaw = await deepDorkTool.invoke({ query: dorkQuery });
          const dorkParsed = typeof dorkResultRaw === "string" ? JSON.parse(dorkResultRaw) : dorkResultRaw;
          
          for (const item of dorkParsed) {
            const u = item.url.toLowerCase();
            if (u.includes('linkedin.com/company') && !socials.linkedin) socials.linkedin = item.url;
            if (u.includes('instagram.com') && !socials.instagram) socials.instagram = item.url;
            if (u.includes('facebook.com') && !socials.facebook) socials.facebook = item.url;
            if (u.includes('youtube.com') && !socials.youtube) socials.youtube = item.url;
            if ((u.includes('twitter.com') || u.includes('x.com')) && !socials.twitter) socials.twitter = item.url;
          }
        } catch (e) {}
      }

      // STRICT FILTERING: Must have at least 1 social media link
      if (socials.linkedin || socials.instagram || socials.facebook || socials.twitter || socials.youtube) {
        return {
          name: comp.name,
          url: comp.url,
          type: comp.type,
          location: comp.location,
          socials
        };
      }
      return null;
    };

    let localCount = 0;
    while(localQueue.length > 0 && localCount < 10) {
      const comp = localQueue.shift();
      if (!comp) continue;
      const validated = await processCompetitor(comp);
      if (validated) {
        finalCompetitors.push(validated);
        localCount++;
      } else {
        logger.info(`Discarding LOCAL ${comp.name} (no social media found)`);
      }
    }

    let globalCount = 0;
    while(globalQueue.length > 0 && globalCount < 10) {
      const comp = globalQueue.shift();
      if (!comp) continue;
      const validated = await processCompetitor(comp);
      if (validated) {
        finalCompetitors.push(validated);
        globalCount++;
      } else {
        logger.info(`Discarding GLOBAL ${comp.name} (no social media found)`);
      }
    }

    return finalCompetitors;
  }
}
