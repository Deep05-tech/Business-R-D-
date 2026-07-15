import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory } from "../types.js";

const logger = createLogger("CompetitorQueryAgent");

export class CompetitorQueryAgent {
  async generateQueries(memory: StructuredMemory, scope: string, coreProductsDetailed: string): Promise<string[]> {
    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.1,
      maxTokens: 8000,
    });

    const businessName = memory.businessIdentity?.officialName || memory.input.websiteUrl;
    let scopeInstruction = "";
    
    if (scope === "local") {
      const loc = memory.businessIdentity?.location || "the business's local area";
      const parts = loc.split(",").map(p => p.trim());
      const city = parts[0] || loc;
      const state = parts.length > 1 ? parts[1] : loc;
      scopeInstruction = `Generate exactly 10 queries. 7 queries MUST focus strictly on highly LOCAL competitors located in ${city}. 3 queries MUST focus on competitors located in the state of ${state}. DO NOT search for competitors outside of ${state}.
CRITICAL: You should include terms like "manufacturers of [exact product] in ${city}" or "suppliers of [exact product] in ${city}" to pull local directory listings (e.g. IndiaMart, JustDial) because independent websites are rare for local businesses. Also include highly specific Google Dork queries like: site:indiamart.com "${city}" "[exact product]"`;
    } else if (scope === "regional") {
      const loc = memory.businessIdentity?.location || "the business's country";
      const country = loc.split(",").pop()?.trim() || loc;
      scopeInstruction = `ALL 10 queries MUST focus strictly on NATIONAL competitors operating anywhere within ${country}.`;
    } else if (scope === "all") {
      scopeInstruction = "ALL 10 queries MUST actively search for the strongest competitors from ALL OVER THE WORLD (North America, Europe, Asia, etc.), ensuring a truly global and geographically diverse mix of competitors.";
    } else {
      scopeInstruction = "ALL 10 queries MUST focus strictly on massive GLOBAL competitors worldwide.";
    }

    const queryGenerationPrompt = `You are an elite B2B Market Research Analyst. Your task is to generate 10 highly specific search queries to find TRUE DIRECT COMPETITORS for the following business.
${scopeInstruction}

CRITICAL RULE: DO NOT search for generic industry names (e.g., do not just search for "forging companies" or "heavy engineering"). You MUST construct your queries around the EXACT SPECIFIC PRODUCTS the business manufactures (e.g., "seamless rolled rings manufacturer", "open die forging of heavy shafts"). If you search for generic industries, you will fail.
CRITICAL RULE 2: To avoid pulling informational blogs or news sites, you MUST include transactional or commercial keywords in your queries, such as "manufacturer", "supplier", "custom", or "fabricator".
Output ONLY the 10 queries, separated by a newline. Do not use quotes or numbering.

BUSINESS EXACT CORE PRODUCTS & CAPACITIES:
${coreProductsDetailed}

BUSINESS IDENTITY:
${JSON.stringify(memory.businessIdentity)}
${memory.businessIdentity?.vision ? `\nCORE VISION/MISSION:\n${memory.businessIdentity.vision}\n(Ensure queries target companies with a similar level of ambition or philosophical scale.)` : ""}`;

    try {
      logger.info(`Generating specific product-based search queries for scope: ${scope}...`);
      const queryResponse = await llm.invoke(queryGenerationPrompt);
      const queryText = typeof queryResponse.content === "string" ? queryResponse.content : "";
      return queryText.split("\n").map(q => q.trim().replace(/^\d+\.\s*/, "")).filter(q => q.length > 5).slice(0, 10);
    } catch (e: any) {
      logger.error(`Query generation failed: ${e.message}`);
      return [`Top manufacturers like ${businessName}`, `${businessName} competitors global`, `${businessName} competitors local`];
    }
  }
}
