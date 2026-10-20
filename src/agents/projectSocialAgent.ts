import axios from "axios";
import * as cheerio from "cheerio";
import { SocialExtractorAgent } from "./socialExtractorAgent.js";
import { BingRssSearchEngine } from "../utils/bingRssSearchEngine.js";
import { createChatModel } from "../utils/llm.js";
import { createLogger } from "../utils/logger.js";
import type { BrandVoicePattern, PageSnapshot, SocialPost } from "../types.js";

const logger = createLogger("ProjectSocialAgent");

export interface ProjectSocials {
  linkedin: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  twitter?: string | null;
}

export class ProjectSocialAgent {
  readonly name = "project-social-agent";
  readonly version = "1.0.0";
  private readonly socialExtractor = new SocialExtractorAgent();

  public isValidProfileUrl(url: string | null | undefined, platform: "LinkedIn" | "Instagram" | "Facebook" | "YouTube" | "Twitter"): boolean {
    if (!url || typeof url !== "string") return false;
    const lower = url.toLowerCase().trim();
    if (
      lower.includes("/sharer") ||
      lower.includes("/share?") ||
      lower.includes("/cws/share") ||
      lower.includes("/intent") ||
      lower.includes("/sharearticle") ||
      lower.includes("indiamart.com") ||
      lower.includes("wix.com") ||
      lower.includes("wordpress.com")
    ) {
      return false;
    }

    try {
      const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length === 0) return false;

      if (platform === "Instagram") {
        if (!lower.includes("instagram.com/")) return false;
        const handle = segments[0].toLowerCase();
        const invalidHandles = new Set(["p", "reel", "reels", "tv", "explore", "direct", "accounts", "stories", "wix", "share", "sharer", "home"]);
        return !invalidHandles.has(handle);
      }
      if (platform === "LinkedIn") {
        if (!lower.includes("linkedin.com/")) return false;
        return lower.includes("linkedin.com/company/") || lower.includes("linkedin.com/in/");
      }
      if (platform === "Facebook") {
        if (!lower.includes("facebook.com/")) return false;
        const invalidSegments = new Set(["sharer", "share", "dialog", "login", "recover", "help"]);
        return !invalidSegments.has(segments[0].toLowerCase());
      }
      if (platform === "YouTube") {
        return (lower.includes("youtube.com/") || lower.includes("youtu.be/")) && !lower.includes("/results?");
      }
      if (platform === "Twitter") {
        return (lower.includes("twitter.com/") || lower.includes("x.com/")) && !lower.includes("/intent");
      }
      return true;
    } catch {
      return false;
    }
  }

  public async discoverSocials(
    companyName: string,
    websiteUrl: string,
    existingSocials?: any,
    scrapedPages?: PageSnapshot[]
  ): Promise<ProjectSocials> {
    const socials: ProjectSocials = {
      linkedin: null,
      instagram: null,
      facebook: null,
      youtube: null,
      twitter: null,
    };

    // 1. Ingest existing socials if provided
    if (existingSocials && typeof existingSocials === "object") {
      if (this.isValidProfileUrl(existingSocials.linkedin, "LinkedIn")) socials.linkedin = existingSocials.linkedin;
      if (this.isValidProfileUrl(existingSocials.instagram, "Instagram")) socials.instagram = existingSocials.instagram;
      if (this.isValidProfileUrl(existingSocials.facebook, "Facebook")) socials.facebook = existingSocials.facebook;
      if (this.isValidProfileUrl(existingSocials.youtube, "YouTube")) socials.youtube = existingSocials.youtube;
      if (this.isValidProfileUrl(existingSocials.twitter, "Twitter")) socials.twitter = existingSocials.twitter;
    }

    // Also support string array of social URLs (e.g. from BusinessInput.socialUrls)
    if (Array.isArray(existingSocials)) {
      for (const u of existingSocials) {
        if (typeof u === "string") {
          const lower = u.toLowerCase();
          if (lower.includes("linkedin.com") && !socials.linkedin && this.isValidProfileUrl(u, "LinkedIn")) socials.linkedin = u;
          if (lower.includes("instagram.com") && !socials.instagram && this.isValidProfileUrl(u, "Instagram")) socials.instagram = u;
          if (lower.includes("facebook.com") && !socials.facebook && this.isValidProfileUrl(u, "Facebook")) socials.facebook = u;
          if ((lower.includes("youtube.com") || lower.includes("youtu.be")) && !socials.youtube && this.isValidProfileUrl(u, "YouTube")) socials.youtube = u;
          if ((lower.includes("twitter.com") || lower.includes("x.com")) && !socials.twitter && this.isValidProfileUrl(u, "Twitter")) socials.twitter = u;
        }
      }
    }

    // 2. Discover from scraped website pages
    if (scrapedPages && Array.isArray(scrapedPages)) {
      for (const page of scrapedPages) {
        if (!page.links) continue;
        for (const link of page.links) {
          const href = (link.href || "").trim();
          const lower = href.toLowerCase();
          if (!socials.linkedin && lower.includes("linkedin.com") && this.isValidProfileUrl(href, "LinkedIn")) socials.linkedin = href;
          if (!socials.instagram && lower.includes("instagram.com") && this.isValidProfileUrl(href, "Instagram")) socials.instagram = href;
          if (!socials.facebook && lower.includes("facebook.com") && this.isValidProfileUrl(href, "Facebook")) socials.facebook = href;
          if (!socials.youtube && (lower.includes("youtube.com") || lower.includes("youtu.be")) && this.isValidProfileUrl(href, "YouTube")) socials.youtube = href;
          if (!socials.twitter && (lower.includes("twitter.com") || lower.includes("x.com")) && this.isValidProfileUrl(href, "Twitter")) socials.twitter = href;
        }

        // Also check JSON-LD blocks on page if available
        if (page.jsonLdBlocks && Array.isArray(page.jsonLdBlocks)) {
          for (const block of page.jsonLdBlocks) {
            try {
              const data = JSON.parse(block);
              const sameAs = Array.isArray(data.sameAs) ? data.sameAs : [data.sameAs].filter(Boolean);
              for (const u of sameAs) {
                if (typeof u === "string") {
                  const lower = u.toLowerCase();
                  if (!socials.linkedin && lower.includes("linkedin.com") && this.isValidProfileUrl(u, "LinkedIn")) socials.linkedin = u;
                  if (!socials.instagram && lower.includes("instagram.com") && this.isValidProfileUrl(u, "Instagram")) socials.instagram = u;
                  if (!socials.facebook && lower.includes("facebook.com") && this.isValidProfileUrl(u, "Facebook")) socials.facebook = u;
                  if (!socials.youtube && (lower.includes("youtube.com") || lower.includes("youtu.be")) && this.isValidProfileUrl(u, "YouTube")) socials.youtube = u;
                  if (!socials.twitter && (lower.includes("twitter.com") || lower.includes("x.com")) && this.isValidProfileUrl(u, "Twitter")) socials.twitter = u;
                }
              }
            } catch {}
          }
        }
      }
    }

    // 3. Fallback search via DuckDuckGo / Bing RSS for missing profiles
    const cleanName = companyName
      .replace(/\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|inc\.?|llc|corp\.?|co\.?)\b/gi, "")
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || companyName.trim();

    const searchSiteProfile = async (platform: "LinkedIn" | "Instagram" | "Facebook" | "YouTube", searchSite: string): Promise<string | null> => {
      try {
        const engine = new BingRssSearchEngine({ maxResults: 5 });
        const query = `"${cleanName}" site:${searchSite}`;
        const raw = await engine.invoke({ query });
        const results = JSON.parse(raw || "[]");
        for (const r of results) {
          const url = (r.url || "").trim();
          if (this.isValidProfileUrl(url, platform)) {
            return url;
          }
        }
      } catch (e: any) {
        logger.debug(`Search error discovering ${platform} for ${cleanName}: ${e.message}`);
      }
      return null;
    };

    if (!socials.linkedin) {
      socials.linkedin = await searchSiteProfile("LinkedIn", "linkedin.com/company");
    }
    if (!socials.instagram) {
      socials.instagram = await searchSiteProfile("Instagram", "instagram.com");
    }
    if (!socials.youtube) {
      socials.youtube = await searchSiteProfile("YouTube", "youtube.com");
    }
    if (!socials.facebook) {
      socials.facebook = await searchSiteProfile("Facebook", "facebook.com");
    }

    logger.info(`Discovered socials for ${companyName}: LinkedIn=${socials.linkedin || 'None'}, Instagram=${socials.instagram || 'None'}, YouTube=${socials.youtube || 'None'}, Facebook=${socials.facebook || 'None'}`);
    return socials;
  }

  public async extractPosts(socials: ProjectSocials, companyName: string): Promise<SocialPost[]> {
    const posts: SocialPost[] = [];
    const MAX_POSTS_PER_PLATFORM = 5;

    const tasks: Promise<any[]>[] = [];

    if (socials.youtube && this.isValidProfileUrl(socials.youtube, "YouTube")) {
      tasks.push(
        this.socialExtractor.extractPosts("YouTube", socials.youtube, companyName, MAX_POSTS_PER_PLATFORM, { preferHttp: true })
          .catch(e => {
            logger.warn(`YouTube extraction error for own account (${companyName}): ${e.message}`);
            return [];
          })
      );
    }
    if (socials.instagram && this.isValidProfileUrl(socials.instagram, "Instagram")) {
      tasks.push(
        this.socialExtractor.extractPosts("Instagram", socials.instagram, companyName, MAX_POSTS_PER_PLATFORM, { preferHttp: true })
          .catch(e => {
            logger.warn(`Instagram extraction error for own account (${companyName}): ${e.message}`);
            return [];
          })
      );
    }
    if (socials.linkedin && this.isValidProfileUrl(socials.linkedin, "LinkedIn")) {
      tasks.push(
        this.socialExtractor.extractPosts("LinkedIn", socials.linkedin, companyName, MAX_POSTS_PER_PLATFORM, { preferHttp: true })
          .catch(e => {
            logger.warn(`LinkedIn extraction error for own account (${companyName}): ${e.message}`);
            return [];
          })
      );
    }
    if (socials.facebook && this.isValidProfileUrl(socials.facebook, "Facebook")) {
      tasks.push(
        this.socialExtractor.extractPosts("Facebook", socials.facebook, companyName, MAX_POSTS_PER_PLATFORM, { preferHttp: true })
          .catch(e => {
            logger.warn(`Facebook extraction error for own account (${companyName}): ${e.message}`);
            return [];
          })
      );
    }

    const taskResults = await Promise.all(tasks);
    for (const batch of taskResults) {
      for (const p of batch) {
        if (p && (p.caption || p.content || p.post_url)) {
          posts.push(p);
        }
      }
    }

    // Deduplicate by URL or caption snippet
    const seen = new Set<string>();
    const deduplicated: SocialPost[] = [];
    for (const p of posts) {
      const key = (p.post_url || p.link || (p.caption || "").slice(0, 50)).trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(p);
      }
    }

    logger.info(`Extracted ${deduplicated.length} verified social posts for own company ${companyName}.`);
    return deduplicated;
  }

  public async analyzePattern(
    posts: SocialPost[],
    companyContext: {
      name: string;
      industry?: string | null;
      subIndustry?: string | null;
      description?: string | null;
      offerings?: { products?: any[]; services?: any[] };
    }
  ): Promise<BrandVoicePattern> {
    const isMfg = /manufactur|forg|machin|casting|steel|metal|industrial|engineering|auto|component|bearing|valve/i.test(
      `${companyContext.industry || ""} ${companyContext.subIndustry || ""}`
    );
    const isTech = /software|technology|it|saas|cloud|data|platform/i.test(
      `${companyContext.industry || ""} ${companyContext.subIndustry || ""}`
    );

    // If we have actual posts, analyze them with LLM
    if (posts && posts.length > 0) {
      try {
        const llm = createChatModel({
          model: "gpt-4o",
          temperature: 0.2,
          maxTokens: 2000,
        });

        const postsSummary = posts.slice(0, 15).map((p, idx) => {
          const cap = (p.caption || p.content || "").slice(0, 300).replace(/\n+/g, " ");
          const plat = p.platform || "Social";
          const date = p.date || p.published_date || "Recent";
          return `[Post ${idx + 1} (${plat}, ${date})]: "${cap}"`;
        }).join("\n");

        const prompt = `You are an elite B2B Social Media Strategist and Brand Voice Profiler.
Analyze the following actual posts recently published by "${companyContext.name}":

${postsSummary}

Extract the company's social media posting patterns and authentic brand voice into a strict JSON object:
{
  "captionStyle": "Concise summary of their caption structure and length (e.g. 'Punchy 2-3 sentences with bullet points and clear technical specs')",
  "tone": "Core brand voice tone (e.g. 'Authoritative industrial B2B, highlighting precision engineering and quality')",
  "formattingPreferences": ["Array of 3-5 formatting habits observed, e.g. 'Structured emoji checkmarks (✅)', 'Clear line breaks', 'Technical spec callouts'"],
  "signatureHashtags": ["Array of 3-8 hashtags they actually use or closely match their brand"],
  "preferredCTAs": ["Array of 2-4 call-to-action styles they typically use, e.g. 'Contact sales team for custom RFQ', 'Visit our manufacturing plant in Rajkot'"],
  "frequentThemes": ["Array of 3-6 themes they frequently post about, e.g. 'Heavy Forging Machinery', 'Quality Certifications', 'Export Milestones'"],
  "recentPostTopics": ["Array of clean 1-line summary strings of the core topic/headline of each post analyzed. These will be strictly EXCLUDED from future generation to prevent duplication."]
}

Output ONLY valid JSON. No conversational text or markdown code fences.`;

        const res = await llm.invoke(prompt);
        const rawText = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
        const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);

        return {
          captionStyle: parsed.captionStyle || (isMfg ? "Technical B2B storytelling with engineering precision" : "Engaging B2B thought leadership"),
          tone: parsed.tone || (isMfg ? "Authoritative industrial engineering, emphasizing metallurgical quality" : "Modern professional B2B"),
          formattingPreferences: Array.isArray(parsed.formattingPreferences) && parsed.formattingPreferences.length > 0
            ? parsed.formattingPreferences
            : ["Structured bullet points", "Clear paragraph breaks", "Targeted technical metrics"],
          signatureHashtags: Array.isArray(parsed.signatureHashtags) && parsed.signatureHashtags.length > 0
            ? parsed.signatureHashtags
            : [`#${companyContext.name.replace(/\s+/g, '')}`, `#${(companyContext.industry || 'Manufacturing').replace(/\s+/g, '')}`, "#EngineeringExcellence"],
          preferredCTAs: Array.isArray(parsed.preferredCTAs) && parsed.preferredCTAs.length > 0
            ? parsed.preferredCTAs
            : ["Inquire for batch RFQ specifications", "Connect with our engineering specialists"],
          frequentThemes: Array.isArray(parsed.frequentThemes) && parsed.frequentThemes.length > 0
            ? parsed.frequentThemes
            : ["Component Manufacturing", "Quality Assurance", "Plant Infrastructure"],
          recentPostTopics: Array.isArray(parsed.recentPostTopics) && parsed.recentPostTopics.length > 0
            ? parsed.recentPostTopics
            : posts.slice(0, 10).map(p => (p.caption || p.content || "Operational Milestone").slice(0, 70)),
          analyzedPostCount: posts.length,
          lastAnalyzedAt: new Date().toISOString()
        };
      } catch (e: any) {
        logger.warn(`LLM brand voice pattern extraction failed: ${e.message}. Using synthesized baseline pattern.`);
      }
    }

    // Baseline fallback synthesis (ensures non-empty and zero crashes)
    const cleanCompanyTag = `#${companyContext.name.replace(/[^\w]/g, '')}`;
    const indTag = `#${(companyContext.industry || 'Business').replace(/[^\w]/g, '')}`;

    return {
      captionStyle: isMfg
        ? "Medium-length storytelling with technical precision and structured bulleted specs"
        : isTech
        ? "Punchy problem-solution breakdown with actionable metrics and clear callouts"
        : "Professional value-driven B2B narrative with structured highlights",
      tone: isMfg
        ? "Authoritative industrial manufacturer, high metallurgical and engineering depth"
        : isTech
        ? "Innovative, customer-centric technology leader"
        : "Authoritative and trustworthy industry leader",
      formattingPreferences: [
        "Structured bullet points with checkmark emojis (✅)",
        "Clear technical specification callouts",
        "Direct problem-to-solution narrative structure",
        "Clean, professional spacing"
      ],
      signatureHashtags: [
        cleanCompanyTag,
        indTag,
        isMfg ? "#PrecisionEngineering" : "#DigitalTransformation",
        isMfg ? "#QualityManufacturing" : "#Innovation",
        "#B2B"
      ],
      preferredCTAs: [
        isMfg ? "Connect with our engineering team for technical drawing reviews" : "Schedule a discovery consultation",
        isMfg ? "Request a custom batch manufacturing RFQ" : "Contact our solutions team"
      ],
      frequentThemes: [
        isMfg ? "Machining & Tolerances" : "Product Features & Architecture",
        isMfg ? "Quality Testing & ISO Standards" : "Customer Case Studies",
        isMfg ? "Facility & Infrastructure Capabilities" : "Industry Insights"
      ],
      recentPostTopics: posts.map(p => (p.caption || p.content || "Company update").slice(0, 70)).filter(Boolean),
      analyzedPostCount: posts.length,
      lastAnalyzedAt: new Date().toISOString()
    };
  }

  public async run(
    companyName: string,
    websiteUrl: string,
    existingSocials?: any,
    scrapedPages?: PageSnapshot[],
    memoryPartial?: any
  ): Promise<{
    ownSocials: ProjectSocials;
    ownSocialFeed: SocialPost[];
    brandVoicePattern: BrandVoicePattern;
  }> {
    logger.info(`Running ProjectSocialAgent for "${companyName}" (${websiteUrl})...`);

    const ownSocials = await this.discoverSocials(companyName, websiteUrl, existingSocials, scrapedPages);
    const ownSocialFeed = await this.extractPosts(ownSocials, companyName);

    const companyContext = {
      name: companyName,
      industry: memoryPartial?.businessIdentity?.industry || memoryPartial?.industryClassification?.industry,
      subIndustry: memoryPartial?.businessIdentity?.subIndustry || memoryPartial?.industryClassification?.subIndustry,
      description: memoryPartial?.businessIdentity?.description,
      offerings: memoryPartial?.offerings
    };

    const brandVoicePattern = await this.analyzePattern(ownSocialFeed, companyContext);

    return {
      ownSocials,
      ownSocialFeed,
      brandVoicePattern
    };
  }
}
