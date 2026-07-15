import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import { z } from "zod";
import type { StructuredMemory, CompetitorProfile } from "../types.js";

const logger = createLogger("CompetitorSynthesisAgent");

export class CompetitorSynthesisAgent {
  async synthesizeCompetitors(memory: StructuredMemory, tavilyContext: string, scope: string): Promise<CompetitorProfile[]> {
    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.1,
      maxTokens: 8000,
    });

    const businessName = memory.businessIdentity?.officialName || memory.input.websiteUrl;
    
    let memoryContext = JSON.stringify({
      businessIdentity: memory.businessIdentity,
      offerings: memory.offerings,
      industryClassification: memory.industryClassification,
    }, null, 2);
    if (memoryContext.length > 10000) {
        memoryContext = memoryContext.substring(0, 10000) + "\n...[TRUNCATED TO PREVENT RATE LIMITS]";
    }

    const loc = memory.businessIdentity?.location || "";
    const parts = loc.split(",").map(p => p.trim());
    const city = parts[0] || loc;
    const state = parts.length > 1 ? parts[1] : loc;
    const country = parts.length > 2 ? parts[parts.length - 1] : loc;

    let synthesisScope = "";
    if (scope === "local") synthesisScope = `AT LEAST 15 (and UP TO 25) competitors physically located EXCLUSIVELY in ${city} or the state of ${state}`;
    else if (scope === "regional") synthesisScope = `AT LEAST 15 (and UP TO 25) NATIONAL competitors operating anywhere within ${country}`;
    else if (scope === "all") synthesisScope = "AT LEAST 15 (and UP TO 25) competitors from ALL OVER THE WORLD (ensuring a diverse geographic mix from North America, Europe, Asia, etc.)";
    else synthesisScope = "AT LEAST 15 (and UP TO 25) GLOBAL competitors";

    const baseCompetitorSchema = z.object({
      competitors: z.array(z.object({
        name: z.string().describe("The clean, official company name"),
        url: z.string().describe("Their independent root domain website URL"),
        type: z.enum(["local", "global"]).describe("Classification based on scale/reach"),
        actual_headquarters: z.string().describe("The specific City and Country of their headquarters extracted from the snippets"),
        is_strictly_in_target_region: z.boolean().describe("True if their actual headquarters is inside the demanded target region boundaries"),
        manufactures_exact_same_products: z.boolean().describe("True only if the snippet proves they manufacture an exact specific product matching the target business."),
        evidence_product_pages: z.array(z.object({
          title: z.string(),
          url: z.string()
        })).describe("Up to 5 explicit product URLs extracted directly from the search snippets.")
      }))
    });

    const synthesisPrompt = `You are an elite B2B Market Research Analyst. Identify a backup pool of ${synthesisScope} for the given business based on the web search results and your knowledge.

BUSINESS: ${businessName}
${memory.businessIdentity?.vision ? `BUSINESS VISION/MISSION: ${memory.businessIdentity.vision}\n(Prioritize competitors who share a similar operational philosophy, scale, or mission.)\n` : ""}
BUSINESS CONTEXT:
${memoryContext}

LIVE WEB SEARCH RESULTS:
${tavilyContext}

INSTRUCTIONS:
1. Identify ${synthesisScope} based on the search context.
2. If searching for GLOBAL competitors, leverage your vast pre-trained knowledge to fill in major global leaders.
3. EXTRACT TRUE LOCATIONS: For every competitor, output their REAL 'actual_headquarters' based STRICTLY on the snippets. If the snippet says they are in ${city}, write ${city}. If they are in another local town (like Mehsana), write that exact town. DO NOT hallucinate or default to major cities like 'Ahmedabad' just because you are uncertain. If the exact city is completely unknown, just write the State.
4. TARGET REGION FLAG: If searching for 'local', the target region is EXCLUSIVELY ${city} or ${state}. If searching for 'regional', the target region is the ENTIRE country of ${country} (ANY city/state inside ${country} is valid). Set 'is_strictly_in_target_region' to true if their true headquarters falls inside this boundary.
5. STRICTLY INDEPENDENT WEBSITES ONLY: The 'url' MUST be the competitor's actual, independent root domain website (e.g. https://www.companyname.com). You are STRICTLY FORBIDDEN from outputting directory links, marketplace links, or external aggregator websites (DO NOT use IndiaMart, JustDial, TradeIndia, Facebook, or LinkedIn links as the URL). If a company does not have an independent website in the search results, you MUST discard them and not include them in the final JSON.
6. STRICT EXACT PRODUCT MATCH: The user requested competitors based on exact products. You MUST set 'manufactures_exact_same_products' to false UNLESS you have proof they manufacture AT LEAST ONE EXACT SPECIFIC PRODUCT from the target business's catalog (e.g. 'Torque Rod Arms', 'Steering Knuckle'). Generic terms like 'automotive forgings' or 'machined components' are NOT acceptable and must be marked false.
7. EVIDENCE URL EXTRACT: You MUST extract up to 5 specific URLs from the search results that point directly to their product or service pages into 'evidence_product_pages'. CRITICAL: YOU ARE FORBIDDEN FROM GUESSING URLs. You cannot just take the root domain and add '/products' to it. You must copy the EXACT URL string as it appears in the search snippet. If the search results do not explicitly show a link to a specific product page, you must ONLY use their homepage. If a snippet URL is a blog post, DO NOT include it. If the product title in the snippet is in a foreign language, YOU MUST TRANSLATE THE TITLE TO ENGLISH.
8. OUTPUT UNIQUE COMPETITORS ONLY: Do not output the same company more than once. If they appear multiple times in the search results, only include them once in your JSON.
9. Output EXACTLY valid JSON matching the provided schema.`;

    let baseCompetitors: CompetitorProfile[] = [];
    try {
      logger.info(`Synthesizing base competitor list...`);
      const structuredLlm = llm.withStructuredOutput(baseCompetitorSchema);
      const parsed = await structuredLlm.invoke(synthesisPrompt);
      
      const seenDomains = new Set<string>();
      let addedCount = 0;

      for (const comp of parsed.competitors) {
        if (!comp.url || !comp.url.startsWith("http")) continue;
        
        let rootDomain = "";
        try { rootDomain = new URL(comp.url).hostname.replace(/^www\./, ''); } catch { continue; }
        if (seenDomains.has(rootDomain)) continue;
        seenDomains.add(rootDomain);

        if (scope === "local" || scope === "regional") {
          if (!comp.is_strictly_in_target_region) {
            logger.debug(`Filtered out ${comp.name} because it is not physically located in the requested region.`);
            continue;
          }
        }
        
        if (!comp.manufactures_exact_same_products) {
          logger.debug(`Filtered out ${comp.name} because it does not explicitly manufacture an exact matching product.`);
          continue;
        }

        const compRootNameLower = comp.name.toLowerCase().replace(/[^a-z0-z]/g, '');
        const targetRootNameLower = businessName.toLowerCase().replace(/[^a-z0-z]/g, '');
        if (compRootNameLower === targetRootNameLower || rootDomain === new URL(memory.input.websiteUrl).hostname.replace(/^www\./, '')) {
           continue; 
        }

        baseCompetitors.push({
          name: comp.name,
          url: comp.url,
          type: comp.type,
          location: comp.actual_headquarters,
          socials: { linkedin: null, instagram: null, facebook: null, youtube: null },
          evidenceUrls: comp.evidence_product_pages
        });
        addedCount++;
        if (addedCount >= 10) break;
      }
      
      logger.info(`Synthesis complete. Selected ${baseCompetitors.length} high-quality candidates.`);
    } catch (e: any) {
      logger.error(`Failed to synthesize base competitors: ${e.message}`);
    }
    return baseCompetitors;
  }
}
