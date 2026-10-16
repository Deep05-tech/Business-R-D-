import { agentRules } from "../config/agentRules.js";
import type { AgentResult, AudienceIntelligence, BusinessIdentity, SemanticWebData, WebIntelligence } from "../types.js";
import { unique } from "../utils/text.js";
import { ChatOpenAI } from "@langchain/openai";
import { createChatModel } from "../utils/llm.js";
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
    const text = [
      web?.seo?.metaDescription,
      web?.homepage?.businessSummary,
      semantic?.combinedText,
      ...(web?.homepage?.headlineMessaging || [])
    ].filter(Boolean).join(" ");
    
    const llm = createChatModel({ model: "gpt-4o", temperature: 0.0 }).withStructuredOutput(AudienceSchema);
    const prompt = `Analyze the following website text and determine the exact target audience for this business.
    
    Business Name: ${identity.officialName || "Unknown"}
    Industry: ${identity.industry || "Unknown"}
    
    Extract the specific buyer personas, target industries, and any specific geographies mentioned.
    If none are explicitly mentioned, use your best logical deduction based on the business offerings and context.
    Keep the persona labels concise (1-3 words).

    ${customInstructions ? `USER INSTRUCTIONS / REVIEWS: \n${customInstructions}\n\nStrictly follow the user instructions above.` : ""}
    
    Text context:
    ${text.slice(0, 15000)}
    `;

    try {
      const result = await llm.invoke(prompt);
      let buyerPersonas = unique((result.buyerPersonas || []).map((s) => s.trim()).filter((s) => s.length > 1));
      let targetIndustries = unique([...(result.targetIndustries || []).map((s) => s.trim()), identity.industry || ""]).filter((s) => s && s.length > 1);
      let geographies = unique([...(result.geographies || []).map((s) => s.trim()), ...(web?.contact?.locations || [])]).filter((s) => s && s.length > 1);

      if (buyerPersonas.length === 0) {
        if (/marketing|seo|advertising|digital/i.test(identity.industry || "")) {
          buyerPersonas = ["Small Business Owners", "Marketing Managers", "Entrepreneurs", "Brand Managers"];
        } else if (/software|technology|it/i.test(identity.industry || "")) {
          buyerPersonas = ["CTOs", "IT Directors", "Product Managers", "Enterprise Leaders"];
        } else if (/manufacturing|industrial/i.test(identity.industry || "")) {
          buyerPersonas = ["Procurement Managers", "Plant Engineers", "Operations Directors", "Supply Chain Leads"];
        } else {
          buyerPersonas = ["Business Owners", "Decision Makers", "Purchasing Managers"];
        }
      }

      if (geographies.length === 0) {
        if (identity.location) {
          const parts = identity.location.split(",").map((p) => p.trim());
          const country = parts[parts.length - 1];
          if (country) geographies.push(country);
        } else {
          geographies.push("Global");
        }
      }

      return {
        agent: this.name,
        version: this.version,
        confidence: buyerPersonas.length > 0 ? "high" : "medium",
        data: { buyerPersonas, geographies, targetIndustries },
        sources: buyerPersonas.slice(0, 3).map((evidence) => ({
          url: web?.crawledUrls?.[0] ?? "",
          field: "audience.buyerPersonas",
          evidence: `LLM Deduction: ${evidence}`,
          confidence: "high",
          inferred: true,
        })),
        warnings: buyerPersonas.length === 0 ? ["Audience could not be confidently determined even via LLM."] : [],
      };
    } catch (e: any) {
      let buyerPersonas: string[] = [];
      if (/marketing|seo|advertising|digital/i.test(identity.industry || "")) {
        buyerPersonas = ["Small Business Owners", "Marketing Managers", "Entrepreneurs", "Brand Managers"];
      } else if (/software|technology|it/i.test(identity.industry || "")) {
        buyerPersonas = ["CTOs", "IT Directors", "Product Managers", "Enterprise Leaders"];
      } else if (/manufacturing|industrial/i.test(identity.industry || "")) {
        buyerPersonas = ["Procurement Managers", "Plant Engineers", "Operations Directors", "Supply Chain Leads"];
      } else {
        buyerPersonas = ["Business Owners", "Decision Makers", "Purchasing Managers"];
      }

      let geographies = unique(web?.contact?.locations || []);
      if (geographies.length === 0 && identity.location) {
        const parts = identity.location.split(",").map((p) => p.trim());
        const country = parts[parts.length - 1];
        if (country) geographies.push(country);
      }
      if (geographies.length === 0) geographies.push("Global");

      return {
        agent: this.name,
        version: this.version,
        confidence: "medium",
        data: { buyerPersonas, geographies, targetIndustries: [identity.industry || ""].filter(Boolean) },
        sources: [],
        warnings: [`LLM extraction fell back to heuristics: ${e.message}`],
      };
    }
  }
}
