import { ChatOpenAI } from "@langchain/openai";
import { WebTool } from "../tools/webTool.js";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory } from "../types.js";

const logger = createLogger("CompetitiveAnalysisAgent");

export class CompetitiveAnalysisAgent {
  private readonly webTool = new WebTool({ maxPages: 4, maxBytes: 1_000_000 });

  async run(businessMemory: StructuredMemory, competitorUrls: string[]): Promise<string> {
    logger.info(`Starting competitive analysis for ${competitorUrls.length} competitors...`);
    
    // We use gpt-4o-mini for heavy map-reduce to avoid hitting the 30k TPM limit of gpt-4o
    const mapLlm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.1 });
    const reduceLlm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.3 });

    const businessCoreProducts = businessMemory.offerings?.products?.join(", ") || "Unknown Products";
    const businessContext = `BUSINESS NAME: ${businessMemory.businessIdentity?.officialName || "Unknown"}\nCORE PRODUCTS: ${businessCoreProducts}`;

    const competitorSummaries: string[] = [];

    // Map Phase: Scrape and Summarize each competitor sequentially to avoid TPM spikes
    for (let i = 0; i < competitorUrls.length; i++) {
      const url = competitorUrls[i];
      logger.info(`[${i + 1}/${competitorUrls.length}] Scraping and Analyzing: ${url}`);
      try {
        const pages = await this.webTool.crawlWebsite(url, 4); // Homepage + 3 other pages
        const fullText = pages.map(p => `Page Title: ${p.title}\nContent:\n${p.contentText}`).join("\n\n");
        const truncatedText = fullText;

        const mapPrompt = `You are a Competitive Intelligence Analyst. Analyze the following competitor's website content.

CURRENT BUSINESS CONTEXT (What we make):
${businessContext}

COMPETITOR WEBSITE DATA (${url}):
${truncatedText}

INSTRUCTIONS:
1. Identify how this competitor manufactures, markets, and sells the EXACT SAME core products as our business.
2. What makes them a "giant"? (e.g., massive facility size, high tonnage capacity, advanced CNC machinery, specific certifications like ISO/API, global export reach).
3. **STRICT SCOPE RULE:** DO NOT mention or analyze any products they make that we do not make. If they make Titanium products and we only make Steel, ignore the Titanium. Only focus on the overlap.
4. Output a concise 3-4 bullet point summary of their specific strengths and capabilities in our shared product categories.`;

        const response = await mapLlm.invoke(mapPrompt);
        competitorSummaries.push(`--- COMPETITOR: ${url} ---\n${response.content}`);
      } catch (err: any) {
        logger.warn(`Failed to analyze ${url}: ${err.message}`);
      }
    }

    // Reduce Phase: Synthesize the gap analysis
    logger.info("Phase 3: Synthesizing Final Gap Analysis & Strategic Recommendations...");
    
    const reducePrompt = `You are a Chief Strategy Officer for a manufacturing company. 

CURRENT BUSINESS CONTEXT (What we make):
${businessContext}
BUSINESS CAPABILITIES: ${businessMemory.processes?.processes?.map(p => p.name).join(", ") || "Unknown"}

COMPETITOR CAPABILITY SUMMARIES (The Giants):
${competitorSummaries.join("\n\n")}

INSTRUCTIONS:
1. Conduct a deep Competitive Gap Analysis between our current business and these industry giants.
2. Identify exactly what the giants are doing better (e.g., quality certifications, massive scale equipment, digital presentation, international export strategies).
3. **STRICT PRODUCT SCOPE RULE:** You MUST ONLY suggest changes, upgrades, or strategies regarding the products we ALREADY make. DO NOT suggest branching out into new product lines. (e.g., if competitors make titanium rings and we make steel rings, do not suggest making titanium rings; instead, suggest how to make our steel rings better/larger).
4. Provide highly actionable, technical, and strategic recommendations for our business to close the gap and compete at their level.

Format your response as a professional Markdown report with the following sections:
- **Executive Summary**
- **The Competitive Gap** (What they have that we lack in our shared product lines)
- **Strategic Recommendations** (Actionable steps to upgrade our current operations)
- **Digital & Marketing Upgrades** (How to present ourselves like a giant)`;

    const finalResponse = await reduceLlm.invoke(reducePrompt);
    return typeof finalResponse.content === "string" ? finalResponse.content : String(finalResponse.content);
  }
}
