import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { agentRules } from "../config/agentRules.js";
import { createLogger } from "../utils/logger.js";
import type { AgentResult, BrandIntelligence, DigitalMaturity, OfferingsIntelligence, RdInsights, WebIntelligence } from "../types.js";

const logger = createLogger("RdInsightAgent");

export class RdInsightAgent {
  readonly name = "rd-insight-agent";
  readonly version = agentRules.version;

  async run(
    web: WebIntelligence,
    offerings: OfferingsIntelligence,
    brand: BrandIntelligence,
    maturity: DigitalMaturity,
  ): Promise<AgentResult<RdInsights>> {
    logger.info("Executing Live R&D Intelligence Search...");
    const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.5 });
    
    let searchContext = "";
    try {
      const tavily = new TavilySearch({ maxResults: 4 });
      const trendSearch = await tavily.invoke({ query: `latest technological trends and innovations in the industry of ${offerings.products.map(p => p.name).join(", ")} 2026` });
      const regSearch = await tavily.invoke({ query: `latest market gaps, opportunities and regulations for ${offerings.services.map(s => s.name).join(", ")} industry` });
      
      searchContext = `
LIVE MARKET RESEARCH DATA:
Trends & Innovations: ${trendSearch}
Gaps & Regulations: ${regSearch}
`;
    } catch (e: any) {
      logger.warn(`Tavily R&D search failed: ${e.message}`);
    }

    const prompt = `You are a world-class Business R&D Analyst.
Based on the live market research data and the company's offerings, generate deep R&D insights.

COMPANY CONTEXT:
Products: ${offerings.products.map(p => p.name).join(", ")}
Services: ${offerings.services.map(s => s.name).join(", ")}
Brand Positioning: ${brand.positioning || "Unknown"}
Digital Score: ${maturity.score}/100

${searchContext}

YOUR TASK:
Output exactly the following JSON structure (NO markdown wrappers):
{
  "opportunities": [
    "Opportunity 1 based on live market trends",
    "Opportunity 2..."
  ],
  "gaps": [
    "Market gap or operational gap 1",
    "Gap 2..."
  ],
  "improvements": [
    "Improvement recommendation 1",
    "Recommendation 2..."
  ]
}

Ensure you provide at least 4 deep, highly researched insights for each category, specifically drawing from the LIVE MARKET RESEARCH DATA provided above.`;

    try {
      const result = await llm.invoke(prompt);
      const content = typeof result.content === "string" ? result.content : "";
      const cleanJson = content.replace(/^```json/i, "").replace(/```$/i, "").trim();
      const parsed: RdInsights = JSON.parse(cleanJson);

      return {
        agent: this.name,
        version: this.version,
        confidence: "high",
        data: parsed,
        sources: [{
          url: "Tavily Search API",
          field: "rdInsights",
          evidence: "Live Web Search Synthesis",
          confidence: "high",
          inferred: true
        }],
        warnings: [],
      };
    } catch (e: any) {
      logger.error(`R&D Insight Agent failed: ${e.message}`);
      return {
        agent: this.name,
        version: this.version,
        confidence: "low",
        data: { opportunities: [], gaps: [], improvements: [] },
        sources: [],
        warnings: [`Failed to parse R&D JSON: ${e.message}`]
      };
    }
  }
}
