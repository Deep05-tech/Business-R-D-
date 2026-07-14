import type { AgentResult, BrandIntelligence, SemanticWebData, WebIntelligence, OfferingsIntelligence } from "../types.js";
import { unique } from "../utils/text.js";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

const BrandSchema = z.object({
  tone: z.string().describe("The primary tone of the website, e.g. 'Professional and enterprise-oriented', 'Creative and expressive', 'Accessible and helpful', 'Value-driven', or 'Innovative'").nullable(),
  positioning: z.string().describe("A 1-sentence summary of how the brand positions itself in the market").nullable(),
  usps: z.array(z.string()).describe("List of 2-5 Unique Selling Propositions (USPs) claimed by the brand"),
  messagingStyle: z.string().describe("The messaging style, e.g. 'Direct and benefits-focused', 'Story-driven', 'Technical and authoritative'").nullable(),
});

export class BrandIntelligenceAgent {
  readonly name = "brand-intelligence-agent";
  readonly version = "smart-llm-v1";

  async run(web: WebIntelligence, semantic: SemanticWebData, offerings: OfferingsIntelligence, customInstructions?: string): Promise<AgentResult<BrandIntelligence>> {
    const text = [
      web.homepage.valueProposition,
      web.seo.metaDescription,
      web.homepage.businessSummary,
      ...web.homepage.headlineMessaging,
    ].filter(Boolean).join(" ");
    
    if (text.length < 50) {
      return {
        agent: this.name,
        version: this.version,
        confidence: "low",
        data: { tone: null, positioning: null, usps: [], messagingStyle: null },
        sources: [],
        warnings: ["Insufficient text for brand intelligence extraction."],
      };
    }

    const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.0 }).withStructuredOutput(BrandSchema);
    const prompt = `Analyze the following messaging pulled from a business website and extract brand intelligence.
    
    Identify the brand's tone, a single-sentence positioning statement, their core Unique Selling Propositions (USPs), and their general messaging style.
    Keep USPs concise (under 8 words each).
    
    ${customInstructions ? `USER INSTRUCTIONS / REVIEWS: \n${customInstructions}\n\nStrictly follow the user instructions above.` : ""}

    Messaging Context:
    ${text}
    `;

    try {
      const result = await llm.invoke(prompt);
      
      const usps = unique(result.usps || []);

      return {
        agent: this.name,
        version: this.version,
        confidence: "high",
        data: {
          tone: result.tone || null,
          positioning: result.positioning || null,
          usps,
          messagingStyle: result.messagingStyle || null,
        },
        sources: usps.slice(0, 3).map((usp) => ({
          url: web.crawledUrls[0] ?? "",
          field: "brandPositioning.usps",
          evidence: `LLM Extraction: ${usp}`,
          confidence: "high",
          inferred: true,
        })),
        warnings: [],
      };
    } catch (e: any) {
      return {
        agent: this.name,
        version: this.version,
        confidence: "low",
        data: { tone: null, positioning: null, usps: [], messagingStyle: null },
        sources: [],
        warnings: [`LLM brand extraction failed: ${e.message}`],
      };
    }
  }
}
