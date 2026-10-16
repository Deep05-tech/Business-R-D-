import { agentRules } from "../config/agentRules.js";
import type { AgentResult, SocialIntelligence, SocialPost, SourceRef } from "../types.js";
import { WebTool } from "../tools/webTool.js";
import { SocialExtractorAgent } from "./socialExtractorAgent.js";
import { firstSentence, keywordHits, unique } from "../utils/text.js";

const themeKeywords = ["launch", "case study", "customer", "event", "hiring", "product", "service", "offer", "testimonial"];
const visualKeywords = ["brand", "logo", "creative", "design", "gallery", "portfolio", "visual", "video"];

export class SocialIntelligenceAgent {
  readonly name = "social-intelligence-agent";
  readonly version = agentRules.version;
  private readonly socialExtractor = new SocialExtractorAgent();

  constructor(private readonly webTool: WebTool) {}

  private detectPlatform(url: string): "Instagram" | "LinkedIn" | "Facebook" | "YouTube" | null {
    const lower = url.toLowerCase();
    if (lower.includes("instagram.com")) return "Instagram";
    if (lower.includes("linkedin.com")) return "LinkedIn";
    if (lower.includes("facebook.com")) return "Facebook";
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "YouTube";
    return null;
  }

  async run(socialUrls: string[]): Promise<AgentResult<SocialIntelligence>> {
    const results = await Promise.all(
      socialUrls.map(async (url) => {
        try {
          const page = await this.webTool.fetchPage(url);
          const bio = firstSentence(page.metaDescription ?? page.text, 260);
          
          let posts: SocialPost[] = [];
          const platform = this.detectPlatform(url);
          if (platform) {
            try {
              posts = await this.socialExtractor.extractPosts(platform, url, undefined, 3, { preferHttp: true });
            } catch (err: any) {
              console.log(`[SocialIntelligenceAgent] Scraper for ${platform} (${url}) failed: ${err.message}`);
            }
          }

          const hasPosts = posts.length > 0;
          const accessStatus = (page.status >= 200 && page.status < 400 && page.text) || hasPosts ? "fetched" : page.status === 0 ? "failed" : "blocked";

          const profile = {
            url,
            bio,
            identitySignals: unique([page.title ?? "", ...page.headings.slice(0, 5)]).filter(Boolean),
            contentThemes: keywordHits(page.text + " " + posts.map(p => p.caption).join(" "), themeKeywords),
            visualSignals: keywordHits(page.text + " " + posts.map(p => p.caption).join(" "), visualKeywords),
            engagementSignals: unique(page.text.match(/\b\d+(?:,\d+)?\s*(?:followers|likes|comments|posts|subscribers)\b/gi) ?? []).slice(0, 8),
            accessStatus: accessStatus as "fetched" | "blocked" | "failed",
            posts
          };
          const source: SourceRef | null = bio ? { url, field: "social.bio", evidence: bio, confidence: "medium", inferred: false } : null;
          return { profile, source };
        } catch {
          let posts: SocialPost[] = [];
          const platform = this.detectPlatform(url);
          if (platform) {
            try {
              posts = await this.socialExtractor.extractPosts(platform, url, undefined, 3, { preferHttp: true });
            } catch {}
          }

          return {
            profile: {
              url,
              bio: "",
              identitySignals: [],
              contentThemes: [],
              visualSignals: [],
              engagementSignals: [],
              accessStatus: posts.length > 0 ? ("fetched" as const) : ("failed" as const),
              posts
            },
            source: null,
          };
        }
      })
    );

    const profiles = results.map((r) => r.profile);
    const sources: SourceRef[] = results.map((r) => r.source).filter((s): s is SourceRef => s !== null);

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
