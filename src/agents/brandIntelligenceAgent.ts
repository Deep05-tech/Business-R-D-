import { agentRules } from "../config/agentRules.js";
import type { AgentResult, BrandIntelligence, OfferingsIntelligence, SemanticWebData, WebIntelligence } from "../types.js";
import { unique } from "../utils/text.js";

export class BrandIntelligenceAgent {
  readonly name = "brand-intelligence-agent";
  readonly version = agentRules.version;

  async run(web: WebIntelligence, semantic: SemanticWebData, offerings: OfferingsIntelligence): Promise<AgentResult<BrandIntelligence>> {
    const messaging = [web.seo.metaDescription, web.homepage.businessSummary, semantic.combinedText, ...web.homepage.headlineMessaging].filter(Boolean).join(" ");
    const tone = this.detectTone(messaging);
    const positioning = web.homepage.valueProposition ?? web.homepage.businessSummary;
    const usps = unique([
      ...offerings.valuePropositions,
      ...web.homepage.headlineMessaging.filter((heading) => new RegExp(agentRules.brand.uspPatterns.join("|"), "i").test(heading)),
    ]).slice(0, 8);
    const messagingStyle = this.detectMessagingStyle(messaging);

    return {
      agent: this.name,
      version: this.version,
      confidence: positioning ? "medium" : "low",
      data: { tone, positioning, usps, messagingStyle },
      sources: positioning
        ? [
            {
              url: web.crawledUrls[0] ?? "",
              field: "brand.positioning",
              evidence: positioning,
              confidence: "medium",
              inferred: false,
            },
          ]
        : [],
      warnings: positioning ? [] : ["Brand positioning was not explicit in the readable website content."],
    };
  }

  private detectTone(text: string): string | null {
    if (!text) return null;
    const tone = agentRules.brand.tones.find((rule) => new RegExp(rule.pattern, "i").test(text));
    if (tone) return tone.label;
    return "Informational";
  }

  private detectMessagingStyle(text: string): string | null {
    if (!text) return null;
    if (/\bwe\b|\bour\b/i.test(text)) return "Company-led narrative";
    if (/\byou\b|\byour\b/i.test(text)) return "Customer-outcome focused";
    return "Descriptive";
  }
}
