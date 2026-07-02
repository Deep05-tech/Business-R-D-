import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory } from "../types.js";

const logger = createLogger("CompetitorAgent");

export class CompetitorAgent {
  readonly name = "competitor-agent";
  readonly version = "1.0.0";

  async run(memory: StructuredMemory): Promise<string> {
    logger.info(`Running competitor research for ${memory.input.websiteUrl}...`);

    const llm = new ChatOpenAI({
      model: "gpt-4.1",
      temperature: 0.2,
      maxTokens: 8000,
    });

    const businessName = memory.businessIdentity?.officialName || memory.input.websiteUrl;
    
    // Extract exact technical capacities for strict LLM filtering
    const coreProductsDetailed = memory.offerings?.products.slice(0, 3).map(p => {
      const specs = Object.entries(p.technicalSpecs || {}).map(([k, v]) => `${k}: ${v}`).join("; ");
      return `- **${p.name}**: ${p.description}\\n  *Specs/Capacity:* ${specs || "Not explicitly specified"}`;
    }).join("\\n") || "Industrial products";

    const memoryContext = JSON.stringify({
      businessIdentity: memory.businessIdentity,
      offerings: memory.offerings,
      industryClassification: memory.industryClassification,
      brandPositioning: memory.brandPositioning,
    }, null, 2);

    // --- PHASE 1: Query Generation ---
    logger.info(`Phase 1: Generating custom search queries for ${businessName}...`);
    const queryGenerationPrompt = `You are an elite B2B Market Research Analyst. Your task is to generate exactly 3 highly technical search queries to find the truest competitors for the following business.
    
BUSINESS EXACT CORE PRODUCTS & CAPACITIES:
${coreProductsDetailed}

INSTRUCTIONS:
1. Analyze the technical specifications, products, and manufacturing industry listed above.
2. Formulate 3 search queries that an industry expert would use to find the absolute GIANTS of this industry. 
3. **THE GIANT HUNTER STRATEGY:** Do NOT include specific, narrow weight limits (like "up to 3 tons") in the search query. Massive global leaders (e.g. Iraeta) produce 170-Ton products, and if you search for "3 tons" you will never find them. Instead, you MUST search for the extremes of the industry (e.g., "giant forged ring manufacturers", "largest seamless rolled ring manufacturers globally", "heavy forging companies wind power nuclear").
4. **MATERIAL ENFORCEMENT:** You MUST include the exact base material (e.g., "forged steel", "metal") to prevent finding rubber/plastic manufacturers.
5. Query 1 should focus on finding local manufacturers in the business's region (if known, otherwise general region like India).
6. Query 2 should focus exclusively on the highest-value core product and its specific technical capacity.
7. Query 3 should focus on finding global leaders producing these exact components.
8. Output ONLY the 3 queries, separated by a newline. Do not use quotes or numbering.

Begin generating queries:`;

    let generatedQueries: string[] = [];
    try {
      const queryResponse = await llm.invoke(queryGenerationPrompt);
      const queryText = typeof queryResponse.content === "string" ? queryResponse.content : "";
      generatedQueries = queryText.split("\\n").map(q => q.trim().replace(/^\\d+\\.\\s*/, "")).filter(q => q.length > 5).slice(0, 3);
    } catch (e: any) {
      logger.warn(`Failed to generate custom queries, falling back to defaults: ${e.message}`);
      generatedQueries = [
        `Top manufacturers of ${memory.offerings?.products[0]?.name || "industrial products"}`,
        `Largest companies in the ${memory.industryClassification?.subIndustry || "manufacturing"} sector`
      ];
    }

    // --- PHASE 2: Execution & Synthesis ---
    let tavilyContext = "";
    try {
      const tavily = new TavilySearch({ maxResults: 20, searchDepth: "advanced" });
      logger.info(`Phase 2: Executing advanced live web searches...`);
      
      for (const query of generatedQueries) {
        logger.info(`Running search: "${query}"`);
        const resultString = await tavily.invoke({ query });
        try {
          const results = JSON.parse(resultString);
          const aliveResults = [];
          
          for (const item of results) {
            if (!item.url) continue;
            
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s timeout
              
              const res = await fetch(item.url, {
                method: "GET",
                signal: controller.signal,
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
              });
              clearTimeout(timeoutId);
              
              if (res.ok && res.status < 400) {
                // Read a small chunk of text to check for parked domains
                const text = await res.text();
                const lowerText = text.toLowerCase();
                const isParked = lowerText.includes("domain for sale") || 
                                 lowerText.includes("buy this domain") || 
                                 lowerText.includes("this domain is parked") || 
                                 (lowerText.includes("godaddy") && lowerText.includes("parked"));
                
                if (!isParked) {
                  aliveResults.push(item);
                } else {
                  logger.debug(`Discarding parked domain: ${item.url}`);
                }
              } else {
                logger.debug(`Discarding dead URL: ${item.url} (Status: ${res.status})`);
              }
            } catch (err) {
              logger.debug(`Discarding unreachable URL: ${item.url}`);
            }
          }
          tavilyContext += `\\nSearch Query: ${query}\\nVerified Alive Results: ${JSON.stringify(aliveResults)}\n`;
        } catch (parseErr) {
          // Fallback if resultString isn't standard JSON array
          tavilyContext += `\\nSearch Query: ${query}\\nResults: ${resultString}\\n`;
        }
      }
    } catch (e: any) {
      logger.warn(`Failed to fetch live competitor context from Tavily: ${e.message}`);
      tavilyContext = "Live search failed. Relying on baseline knowledge.";
    }

    const synthesisPrompt = `You are an elite B2B Market Research Analyst. Your task is to identify the top 10 most relevant competitors for the given business based on their explicit memory footprint and live web search results.

BUSINESS CONTEXT:
${memoryContext}

LIVE WEB SEARCH RESULTS:
${tavilyContext}

INSTRUCTIONS:
1. Identify EXACTLY 10 highly relevant competitors (a mix of local and global companies).
2. ONLY select companies that actually manufacture similar core products. 
3. **ASPIRATIONAL SCALING MATCH (EQUAL OR GREATER):** Pay extremely close attention to the specific technical specifications and maximum capacities of the business. A true competitor is someone who manufactures at an EQUAL or GREATER scale. If this business manufactures heavy parts up to 3 Metric Tons, you MUST instantly reject any company whose maximum capacity is explicitly proven to be smaller (e.g. only 100kg).
   - **THE GIANT RULE:** If the company is clearly a massive industrial manufacturer, heavy engineering firm, or global leader, you must ASSUME they meet the heavy capacity requirements even if the exact tonnage isn't listed in the snippet. Give industry giants the benefit of the doubt.
4. **MATERIAL & PROCESS RULE:** You MUST instantly reject any company that manufactures using the wrong base material (e.g., if the business makes forged steel rings, reject anyone making rubber, plastic, or ceramic rings).
5. **BUSINESS MODEL RULE:** You MUST instantly reject any website that is a blog, news article, B2B directory (like IndiaMart, TradeIndia, ThomasNet), or informational wiki. Only include actual corporate websites of competing manufacturing companies.
6. **URL VERIFICATION:** The results provided in the context have already been mathematically verified to be ALIVE and FUNCTIONAL right now. Rely heavily on these verified results. Filter out any results that do not match the specific sub-industry and scale.
7. Provide a structured markdown response.

Format your response EXACTLY like this:
## Top 10 Competitors for ${businessName}

**1. [Competitor Name]** ([Local or Global])
- **Website:** [If found, otherwise N/A]
- **Why they compete:** [1-2 sentences detailing how their specific capacities and products overlap with the business]

(Repeat for all 10)

Begin your analysis:`;

    try {
      logger.info(`Synthesizing final competitor report...`);
      const response = await llm.invoke(synthesisPrompt);
      return typeof response.content === "string" ? response.content : "Error generating competitor list.";
    } catch (e: any) {
      logger.error(`Competitor synthesis failed: ${e.message}`);
      throw e;
    }
  }
}
