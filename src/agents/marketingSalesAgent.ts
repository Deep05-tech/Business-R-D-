import { createChatModel } from "../utils/llm.js";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";
import { createLogger } from "../utils/logger.js";
import type {
  AgentResult,
  BusinessIdentity,
  OfferingsIntelligence,
  AudienceIntelligence,
  MarketingSalesIntelligence
} from "../types.js";

const logger = createLogger("MarketingSalesAgent");

export class MarketingSalesAgent {
  readonly name = "marketing-sales-agent";
  readonly version = "1.0.0";

  async run(
    identity: BusinessIdentity,
    offerings: OfferingsIntelligence,
    audience: AudienceIntelligence,
    brochureText?: string,
    customInstructions?: string
  ): Promise<AgentResult<MarketingSalesIntelligence>> {
    logger.info("Executing Marketing & Sales Strategic Intelligence...");
    const llm = createChatModel({ model: "gpt-4o", temperature: 0.7 });

    let searchContext = "";
    try {
      const searchEngine = new FreeSearchEngine({ maxResults: 5 });
      const localSearch = await searchEngine.invoke({ query: `top competitors, companies and manufacturers similar to ${identity.officialName || identity.industry} in India` });
      const globalSearch = await searchEngine.invoke({ query: `top global competitors, companies and manufacturers similar to ${identity.officialName || identity.industry} worldwide` });
      
      searchContext = `
LIVE SEARCH DATA (Use this to find real competitors):
Local India Search: ${localSearch}
Global Search: ${globalSearch}
`;
    } catch (e: any) {
      logger.warn(`FreeSearchEngine failed: ${e.message}`);
    }

    const prompt = `You are a world-class Marketing Strategy & Sales AI.
Analyze the following business data and generate a comprehensive Marketing & Sales Intelligence profile.

COMPANY IDENTITY:
Name: ${identity.officialName || "Unknown"}
Industry: ${identity.industry || "Unknown"}
Business Model: ${identity.businessModel || "Unknown"}

PRODUCTS/SERVICES:
${offerings.products?.map(p => `- ${p.name}`).join("\n") || "None"}
${offerings.services?.map(s => `- ${s.name}`).join("\n") || "None"}

TARGET AUDIENCE / BUYER PERSONAS:
${audience.buyerPersonas?.map(p => `- ${p}`).join("\n") || "None"}

${brochureText ? `BROCHURE TEXT:\n${brochureText}` : ""}

${customInstructions ? `USER INSTRUCTIONS / REVIEWS: \n${customInstructions}\n\nStrictly follow the user instructions above.` : ""}

${searchContext}

YOUR TASK:
Extract and generate the following JSON payload conforming exactly to this structure (DO NOT use markdown formatting, just pure JSON):
{
  "contentStrategy": {
    "platforms": ["LinkedIn", "Instagram", etc.],
    "themes": ["Behind the scenes manufacturing", "Product demos", etc.],
    "postTypes": ["Video", "Carousel", etc.]
  },
  "creativeConcepts": [
    {
      "type": "Video",
      "concept": "A 30s fast-paced reel showing the CNC machine cutting steel.",
      "description": "Highlighting precision and speed.",
      "targetAudience": "Procurement Managers"
    }
  ],
  "competitors": [
    {
      "name": "Competitor Name",
      "region": "India / Global",
      "threatLevel": "High",
      "differentiator": "They focus on cheap prices, we focus on quality."
    }
  ],
  "linkedinOutreach": [
    {
      "persona": "CEO",
      "messages": ["Message 1", "Message 2"]
    }
  ]
}

CRITICAL RULES:
1. Provide 8-12 high-impact, persuasive LinkedIn messages in total (spread across the personas). 
   - Structure: EVERY message MUST follow a strict [Problem] -> [Solution] framework. 
   - Example: "I noticed [Problem]. We solved this by [Solution]."
   - Ensure they are highly attractive, professional, and thought-provoking. Avoid generic one-liners.
2. Competitors: Provide 6 real competitors in total (3 top competitors in India, and 3 global competitors).
   - Use the LIVE SEARCH DATA provided above to find real, active, working websites.
3. Output MUST be pure JSON with no markdown wrapping.
`;

    try {
      const result = await llm.invoke(prompt);
      const content = typeof result.content === "string" ? result.content : "";
      let cleanJson = content.replace(/^```json/i, "").replace(/```$/i, "").trim();
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
      }
      cleanJson = cleanJson.replace(/,\s*([}\]])/g, "$1");
      const parsed: MarketingSalesIntelligence = JSON.parse(cleanJson);

      return {
        agent: this.name,
        version: this.version,
        confidence: "high",
        data: parsed,
        sources: [{
          url: "AI Generation",
          field: "marketingSales",
          evidence: "LLM Strategic Synthesis",
          confidence: "high",
          inferred: true
        }],
        warnings: []
      };
    } catch (e: any) {
      logger.error(`Marketing Sales Agent failed: ${e.message}`);
      return {
        agent: this.name,
        version: this.version,
        confidence: "low",
        data: {
          contentStrategy: { platforms: ["LinkedIn", "Instagram"], themes: ["Growth", "Case Studies", "Industry Insights"], postTypes: ["Image", "Carousel", "Video"] },
          creativeConcepts: [],
          competitors: [],
          linkedinOutreach: []
        },
        sources: [],
        warnings: [`Failed to parse strategy JSON: ${e.message}`]
      };
    }
  }
}
