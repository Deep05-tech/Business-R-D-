import { agentRules } from "../config/agentRules.js";
import type { AgentResult, SocialIntelligence, SourceRef } from "../types.js";
import { WebTool } from "../tools/webTool.js";
import { firstSentence, keywordHits, unique } from "../utils/text.js";

const themeKeywords = ["launch", "case study", "customer", "event", "hiring", "product", "service", "offer", "testimonial"];
const visualKeywords = ["brand", "logo", "creative", "design", "gallery", "portfolio", "visual", "video"];

export class SocialIntelligenceAgent {
  readonly name = "social-intelligence-agent";
  readonly version = agentRules.version;

  constructor(private readonly webTool: WebTool) {}

  async run(socialUrls: string[]): Promise<AgentResult<SocialIntelligence>> {
    const profiles = [];
    const sources: SourceRef[] = [];

    for (const url of socialUrls) {
      const page = await this.webTool.fetchPage(url);
      const bio = firstSentence(page.metaDescription ?? page.text, 260);
      const accessStatus = page.status >= 200 && page.status < 400 && page.text ? "fetched" : page.status === 0 ? "failed" : "blocked";
      const profile = {
        url,
        bio,
        identitySignals: unique([page.title ?? "", ...page.headings.slice(0, 5)]).filter(Boolean),
        contentThemes: keywordHits(page.text, themeKeywords),
        visualSignals: keywordHits(page.text, visualKeywords),
        engagementSignals: unique(page.text.match(/\b\d+(?:,\d+)?\s*(?:followers|likes|comments|posts|subscribers)\b/gi) ?? []).slice(0, 8),
        accessStatus: accessStatus as "fetched" | "blocked" | "failed",
      };
      profiles.push(profile);
      if (bio) sources.push({ url, field: "social.bio", evidence: bio, confidence: "medium", inferred: false });
    }

    return {
      agent: this.name,
      version: this.version,
      confidence: socialUrls.length === 0 ? "medium" : profiles.some((profile) => profile.accessStatus === "fetched") ? "medium" : "low",
      data: { profiles },
      sources,
      warnings: profiles.filter((profile) => profile.accessStatus !== "fetched").map((profile) => `Social URL not fully readable: ${profile.url}`),
    };
  }
}
