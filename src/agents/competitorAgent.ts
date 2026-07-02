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
    const queryGenerationPrompt = `You are an elite B2B Market Research Analyst. Your task is to generate exactly 6 highly technical search queries to find the truest competitors for the following business.
    
BUSINESS EXACT CORE PRODUCTS & CAPACITIES:
${coreProductsDetailed}

INSTRUCTIONS:
1. Analyze the technical specifications, products, and manufacturing industry listed above.
2. Formulate 6 search queries that an industry expert would use to find the absolute GIANTS of this industry. 
3. **THE GIANT HUNTER STRATEGY (FOR EVERY PRODUCT):** Do NOT use overly narrow, long-tail keywords (like "largest forged steel seamless rolled ring manufacturers India") because you will miss the true multi-billion-dollar corporate giants (like Bharat Forge, Rolex Rings, Iraeta) whose SEO isn't optimized for that exact sentence. Instead, you MUST use broader, elite queries (e.g., "Top heavy forging companies in India", "Largest global industrial forging manufacturers") to ensure you capture true giants. Apply this broad logic to EVERY core product listed.
4. **MATERIAL ENFORCEMENT:** You MUST include the exact base material (e.g., "forged steel", "metal") to prevent finding rubber/plastic manufacturers.
5. Queries 1, 2, and 3 should focus on finding LOCAL manufacturers in the business's region (if known, otherwise general region like India). Ensure variety in the core products searched.
6. Queries 4, 5, and 6 should focus on finding GLOBAL leaders and massive international corporations producing these exact components.
7. Output ONLY the 6 queries, separated by a newline. Do not use quotes or numbering.

Begin generating queries:`;

    let generatedQueries: string[] = [];
    try {
      const queryResponse = await llm.invoke(queryGenerationPrompt);
      const queryText = typeof queryResponse.content === "string" ? queryResponse.content : "";
      generatedQueries = queryText.split("\n").map(q => q.trim().replace(/^\d+\.\s*/, "")).filter(q => q.length > 5).slice(0, 6);
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
      const tavily = new TavilySearch({ maxResults: 30, searchDepth: "advanced" });
      logger.info(`Phase 2: Executing advanced live web searches...`);
      const processedDomains = new Set<string>();
      
      for (const query of generatedQueries) {
        logger.info(`Running search: "${query}"`);
        const resultRaw = await tavily.invoke({ query });
        try {
          const results = typeof resultRaw === "string" ? JSON.parse(resultRaw) : (resultRaw.results || resultRaw);
          const aliveResults = [];
          
          for (const item of results) {
            if (!item.url) continue;

            const urlLower = item.url.toLowerCase();
            
            // Deduplicate by base domain
            try {
              const baseDomain = new URL(urlLower).origin;
              if (processedDomains.has(baseDomain)) {
                 continue;
              }
              processedDomains.add(baseDomain);
            } catch (e) {
              continue; // Invalid URL
            }

            if (urlLower.includes("exportersindia") || 
                urlLower.includes("indiamart") || 
                urlLower.includes("tradeindia") || 
                urlLower.includes("thomasnet") || 
                urlLower.includes("kompass") || 
                urlLower.includes("alibaba") || 
                urlLower.includes("made-in-china") ||
                urlLower.includes("globalsources")) {
              logger.debug(`Hard-blocking directory URL: ${item.url}`);
              continue;
            }
            
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
                  // Minify payload to save tokens
                  aliveResults.push({
                    url: item.url,
                    title: item.title,
                    content: item.content ? item.content.substring(0, 1000) : ""
                  });
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
          tavilyContext += `\nSearch Query: ${query}\nVerified Alive Results: ${JSON.stringify(aliveResults)}\n`;
        } catch (parseErr) {
          // Fallback if resultRaw isn't standard JSON array
          tavilyContext += `\nSearch Query: ${query}\nResults: "Parse error or invalid format."\n`;
        }
      }
    } catch (e: any) {
      logger.warn(`Failed to fetch live competitor context from Tavily: ${e.message}`);
      tavilyContext = "Live search failed. Relying on baseline knowledge.";
    }

    const synthesisPrompt = `You are an elite B2B Market Research Analyst. Your task is to identify up to 20 highly relevant competitors for the given business based on their explicit memory footprint and live web search results.

BUSINESS CONTEXT:
${memoryContext}

LIVE WEB SEARCH RESULTS:
${tavilyContext}

INSTRUCTIONS:
1. Identify UP TO 20 highly relevant competitors (UP TO 10 Local companies and UP TO 10 Global companies). 
2. **STRICT PRODUCT MATCH:** ONLY select companies that explicitly manufacture similar core products. If a company only makes generic "steel pipes" or "automotive forgings" and not the specific heavy products (e.g. seamless rolled rings, heavy flanges), you MUST reject them. (Note: For universally recognized giants like Iraeta or Bharat Forge, you may rely on your pre-trained memory to verify their products if their website is missing from the search context).
3. **ZERO HALLUCINATION SCALING (EQUAL OR GREATER):** EVERY single competitor must be a true, heavy-industrial manufacturer with equal or greater capacity. If you can only find 4 local companies that perfectly match the criteria, ONLY output 4. DO NOT invent products or hallucinate capabilities for a company just to fill a quota. DO NOT hallucinate fake companies.
4. **MATERIAL & PROCESS RULE:** You MUST instantly reject any company that manufactures using the wrong base material (e.g., if the business makes forged steel rings, reject anyone making rubber, plastic, or ceramic rings).
5. **BUSINESS MODEL RULE (PURE MANUFACTURERS ONLY):** You MUST aggressively reject any company that identifies as a stockist, supplier, trader, distributor, or exporter. Only select pure, heavy-industrial manufacturers with their own massive forging facilities. Additionally, reject any website that is a blog, news article, B2B directory, or informational wiki.
6. **URL FALLBACK & MEMORY RULE:** You MUST NOT output \`N/A\` for a website. If a company is a universally recognized heavy-manufacturing giant (like Iraeta, Thyssenkrupp, Bharat Forge) and perfectly meets all criteria based on your pre-trained memory, you MUST include them even if they are completely missing from the search results. Pull their official root domain (e.g., https://en.iraeta.com) and product verification directly from your own memory. Only output companies with valid, live website URLs.
7. Provide a structured markdown response.

Format your response EXACTLY like this:
## Top Competitors for ${businessName}

### Local Competitors (Up to 10)

**1. [Competitor Name]** (Local)
- **Website:** [ROOT DOMAIN ONLY (e.g. https://ferralloy.com). NO N/A ALLOWED]
- **Why they compete:** [1-2 sentences detailing how their specific capacities and products overlap with the business]

(Repeat for all valid local competitors found)

### Global Competitors (Up to 10)

**[N]. [Competitor Name]** (Global)
- **Website:** [ROOT DOMAIN ONLY (e.g. https://ferralloy.com). NO N/A ALLOWED]
- **Why they compete:** [1-2 sentences detailing how their specific capacities and products overlap with the business]

(Repeat for all valid global competitors found)

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
