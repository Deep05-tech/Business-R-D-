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

      const getFallbackPersonas = (ind: string = "") => {
        const lower = ind.toLowerCase();
        if (/manufactur|forg|machin|casting|steel|metal|industrial|engineering|auto/i.test(lower)) {
          return ["Procurement Managers", "VP of Supply Chain", "Plant Operations Directors", "Chief Mechanical Engineers", "Tier-1 OEM Sourcing Leads"];
        } else if (/software|technology|it|saas|cloud/i.test(lower)) {
          return ["Chief Technology Officers (CTOs)", "VP of Engineering", "IT Directors", "Enterprise Architects", "Product Managers"];
        } else if (/marketing|seo|advertising|digital|media|branding/i.test(lower)) {
          return ["Chief Marketing Officers (CMOs)", "Brand Directors", "Marketing Operations Leads", "E-Commerce Growth Managers"];
        } else if (/seed|agri|crop|farming/i.test(lower)) {
          return ["Commercial Farm Owners", "Agri-Input Distributors", "Agricultural Procurement Heads", "Agronomists"];
        } else if (/health|pharma|medical/i.test(lower)) {
          return ["Hospital Administrators", "Medical Procurement Directors", "Clinical Operations Leads"];
        }
        return ["Business Owners", "Managing Directors", "Procurement & Sourcing Heads", "Operations Directors"];
      };

      if (buyerPersonas.length < 3) {
        const fallbacks = getFallbackPersonas(identity.industry || identity.subIndustry || "");
        buyerPersonas = unique([...buyerPersonas, ...fallbacks]);
      }

      if (targetIndustries.length === 0) {
        targetIndustries = [identity.industry || "General Industry", identity.subIndustry || "Commercial Sector"].filter(Boolean);
      }

      if (geographies.length === 0) {
        if (identity.location) {
          const parts = identity.location.split(",").map((p) => p.trim());
          const country = parts[parts.length - 1];
          if (country) geographies.push(country);
        }
        geographies.push("Global / Export Markets");
      }
      geographies = unique(geographies);

      return {
        agent: this.name,
        version: this.version,
        confidence: "high",
        data: { buyerPersonas, geographies, targetIndustries },
        sources: buyerPersonas.slice(0, 3).map((evidence) => ({
          url: web?.crawledUrls?.[0] ?? "",
          field: "audience.buyerPersonas",
          evidence: `LLM Deduction: ${evidence}`,
          confidence: "high",
          inferred: true,
        })),
        warnings: [],
      };
    } catch (e: any) {
      const lower = (identity.industry || identity.subIndustry || "").toLowerCase();
      let buyerPersonas: string[];
      if (/manufactur|forg|machin|casting|steel|metal|industrial|engineering|auto/i.test(lower)) {
        buyerPersonas = ["Procurement Managers", "VP of Supply Chain", "Plant Operations Directors", "Chief Mechanical Engineers", "Tier-1 OEM Sourcing Leads"];
      } else if (/software|technology|it|saas|cloud/i.test(lower)) {
        buyerPersonas = ["Chief Technology Officers (CTOs)", "VP of Engineering", "IT Directors", "Enterprise Architects", "Product Managers"];
      } else if (/marketing|seo|advertising|digital|media|branding/i.test(lower)) {
        buyerPersonas = ["Chief Marketing Officers (CMOs)", "Brand Directors", "Marketing Operations Leads", "E-Commerce Growth Managers"];
      } else if (/seed|agri|crop|farming/i.test(lower)) {
        buyerPersonas = ["Commercial Farm Owners", "Agri-Input Distributors", "Agricultural Procurement Heads", "Agronomists"];
      } else {
        buyerPersonas = ["Business Owners", "Managing Directors", "Procurement & Sourcing Heads", "Operations Directors"];
      }

      let geographies = unique(web?.contact?.locations || []);
      if (geographies.length === 0 && identity.location) {
        const parts = identity.location.split(",").map((p) => p.trim());
        const country = parts[parts.length - 1];
        if (country) geographies.push(country);
      }
      if (geographies.length === 0) geographies.push("Global / Export Markets");

      return {
        agent: this.name,
        version: this.version,
        confidence: "medium",
        data: {
          buyerPersonas,
          geographies,
          targetIndustries: [identity.industry || "General Industry", identity.subIndustry || ""].filter(Boolean)
        },
        sources: [],
        warnings: [`LLM extraction fell back to heuristics: ${e.message}`],
      };
    }
  }
}
