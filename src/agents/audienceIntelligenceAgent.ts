import { agentRules } from "../config/agentRules.js";
import type { AgentResult, AudienceIntelligence, BusinessIdentity, SemanticWebData, WebIntelligence } from "../types.js";
import { keywordHits, unique } from "../utils/text.js";

export class AudienceIntelligenceAgent {
  readonly name = "audience-intelligence-agent";
  readonly version = agentRules.version;

  async run(web: WebIntelligence, semantic: SemanticWebData, identity: BusinessIdentity): Promise<AgentResult<AudienceIntelligence>> {
    const text = [web.seo.metaDescription, web.homepage.businessSummary, semantic.combinedText, ...web.homepage.headlineMessaging].filter(Boolean).join(" ");
    const buyerPersonas = unique(keywordHits(text, Object.keys(agentRules.audience.personas)).map((persona) => this.labelPersona(persona)));
    const geographies = unique(web.contact.locations);
    const targetIndustries = unique([...keywordHits(text, [...agentRules.audience.targetIndustries]), identity.industry ?? ""]).filter(Boolean);

    return {
      agent: this.name,
      version: this.version,
      confidence: buyerPersonas.length + targetIndustries.length + geographies.length > 0 ? "medium" : "low",
      data: { buyerPersonas, geographies, targetIndustries },
      sources: buyerPersonas.slice(0, 5).map((evidence) => ({
        url: web.crawledUrls[0] ?? "",
        field: "audience.buyerPersonas",
        evidence,
        confidence: "low",
        inferred: true,
      })),
      warnings: buyerPersonas.length === 0 ? ["Audience could only be weakly inferred from available messaging."] : [],
    };
  }

  private labelPersona(value: string): string {
    const normalized = value.toLowerCase();
    const configured = agentRules.audience.personas[normalized as keyof typeof agentRules.audience.personas];
    if (configured) return configured;
    return `${normalized[0]?.toUpperCase() ?? ""}${normalized.slice(1)}`;
  }
}
