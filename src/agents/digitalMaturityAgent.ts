import { agentRules } from "../config/agentRules.js";
import type { AgentResult, DigitalMaturity, SocialIntelligence, WebIntelligence } from "../types.js";

export class DigitalMaturityAgent {
  readonly name = "digital-maturity-agent";
  readonly version = agentRules.version;

  async run(web: WebIntelligence, social: SocialIntelligence): Promise<AgentResult<DigitalMaturity>> {
    const websiteSignals = [
      web.homepage.headlineMessaging.length > 0 ? "Clear page headings detected" : "",
      web.contact.emails.length + web.contact.phones.length > 0 ? "Contact details visible" : "",
      web.contact.legitimacySignals.length > 0 ? "Legitimacy pages or organization schema detected" : "",
      web.crawledUrls.length > 1 ? "Multiple website pages crawlable" : "",
    ].filter(Boolean);
    const seoSignals = [
      web.seo.metaTitle ? "Meta title present" : "",
      web.seo.metaDescription ? "Meta description present" : "",
      web.seo.keywords.length > 0 ? "Meta keywords present" : "",
      web.seo.schemaSignals.length > 0 ? "Structured data present" : "",
    ].filter(Boolean);
    const seoGaps = [
      !web.seo.metaTitle ? "Missing meta title" : "",
      !web.seo.metaDescription ? "Missing meta description" : "",
      web.seo.schemaSignals.length === 0 ? "No structured schema detected" : "",
    ].filter(Boolean);
    const socialSignals = [
      social.profiles.length > 0 ? "Social profile URLs supplied" : "",
      social.profiles.some((profile) => profile.bio) ? "Social bio readable" : "",
      social.profiles.some((profile) => profile.contentThemes.length > 0) ? "Social content themes visible" : "",
      social.profiles.some((profile) => profile.engagementSignals.length > 0) ? "Visible engagement metrics found" : "",
    ].filter(Boolean);

    const websiteScore = Math.round((websiteSignals.length / 4) * 100);
    const seoScore = Math.round((seoSignals.length / 4) * 100);
    const socialScore = social.profiles.length === 0 ? 0 : Math.round((socialSignals.length / 4) * 100);
    const score = Math.round(websiteScore * 0.45 + seoScore * 0.35 + socialScore * 0.2);

    return {
      agent: this.name,
      version: this.version,
      confidence: score >= 40 ? "high" : "medium",
      data: {
        score,
        websiteQuality: { score: websiteScore, signals: websiteSignals },
        seoReadiness: { score: seoScore, signals: seoSignals, gaps: seoGaps },
        socialActivity: { score: socialScore, signals: socialSignals },
      },
      sources: seoSignals.map((evidence) => ({
        url: web.crawledUrls[0] ?? "",
        field: "digitalMaturity.seoReadiness.signals",
        evidence,
        confidence: "high",
        inferred: false,
      })),
      warnings: [],
    };
  }
}
