import { agentRules } from "../config/agentRules.js";
import type { AgentResult, AudienceIntelligence, BusinessIdentity, SemanticWebData, WebIntelligence } from "../types.js";
import { unique } from "../utils/text.js";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const AudienceSchema = z.object({
  buyerPersonas: z.array(z.string()).describe("Specific types of buyers or professionals targeted by the business, e.g. 'Farmers', 'IT Managers', 'Small Business Owners'"),
  targetIndustries: z.array(z.string()).describe("Specific industries targeted by this business, e.g. 'Agriculture', 'Finance', 'Healthcare'"),
  geographies: z.array(z.string()).describe("Specific locations or regions targeted"),
});

export class AudienceIntelligenceAgent {
  readonly name = "audience-intelligence-agent";
  readonly version = "smart-llm-v1";

  async run(web: WebIntelligence, semantic: SemanticWebData, identity: BusinessIdentity, customInstructions?: string): Promise<AgentResult<AudienceIntelligence>> {
    const text = [web.seo.metaDescription, web.homepage.businessSummary, semantic.combinedText, ...web.homepage.headlineMessaging].filter(Boolean).join(" ");
    
    const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.0 }).withStructuredOutput(AudienceSchema);
    const prompt = `Analyze the following website text and determine the exact target audience for this business.
    
    Business Name: ${identity.officialName || "Unknown"}
    Industry: ${identity.industry || "Unknown"}
    
    Extract the specific buyer personas, target industries, and any specific geographies mentioned.
    If none are explicitly mentioned, use your best logical deduction based on the business offerings and context.
    Keep the persona labels concise (1-3 words).

    ${customInstructions ? `USER INSTRUCTIONS / REVIEWS: \n${customInstructions}\n\nStrictly follow the user instructions above.` : ""}
    
    Text context:
    ${text}
    `;

    try {
      const result = await llm.invoke(prompt);
      const buyerPersonas = unique(result.buyerPersonas || []);
      const targetIndustries = unique([...(result.targetIndustries || []), identity.industry || ""]).filter(Boolean);
      const geographies = unique([...(result.geographies || []), ...web.contact.locations]).filter(Boolean);

      return {
        agent: this.name,
        version: this.version,
        confidence: buyerPersonas.length > 0 ? "high" : "medium",
        data: { buyerPersonas, geographies, targetIndustries },
        sources: buyerPersonas.slice(0, 3).map((evidence) => ({
          url: web.crawledUrls[0] ?? "",
          field: "audience.buyerPersonas",
          evidence: `LLM Deduction: ${evidence}`,
          confidence: "high",
          inferred: true,
        })),
        warnings: buyerPersonas.length === 0 ? ["Audience could not be confidently determined even via LLM."] : [],
      };
    } catch (e: any) {
      return {
        agent: this.name,
        version: this.version,
        confidence: "low",
        data: { buyerPersonas: [], geographies: unique(web.contact.locations), targetIndustries: [identity.industry || ""].filter(Boolean) },
        sources: [],
        warnings: [`LLM extraction failed: ${e.message}`],
      };
    }
  }
}
