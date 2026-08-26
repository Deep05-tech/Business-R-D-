import { SocialExtractorAgent } from "./socialExtractorAgent.js";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory, SocialPost } from "../types.js";
import { MemoryStore } from "../memory/memoryStore.js";
import { knowledgeIndex } from "../memory/knowledgeIndex.js";
import { BingRssSearchEngine } from "../utils/bingRssSearchEngine.js";

const logger = createLogger("CronAgent");

export interface FeedPost extends SocialPost {
  platformIcon?: string;
}

export class CronAgent {
  readonly name = "cron-agent";
  readonly version = "1.0.0";

  async run(memory: StructuredMemory, memoryStore: MemoryStore): Promise<SocialPost[]> {
    logger.info(`Running Direct Social Media Account Scraper for ${memory.input.websiteUrl}...`);

    if (!memory.competitors || memory.competitors.length === 0) {
      logger.warn(`No competitors found for ${memory.input.websiteUrl}. Skipping cron.`);
      return [];
    }

    let allPosts: SocialPost[] = [];
    const socialExtractor = new SocialExtractorAgent();
    const targetCompetitors = memory.competitors || [];
    const MAX_POSTS_PER_COMP = 3;

    const isValidProfileUrl = (url?: string | null, platform?: string): boolean => {
      if (!url || typeof url !== 'string') return false;
      const lower = url.toLowerCase();
      if (lower.includes('/sharer') || lower.includes('/share?') || lower.includes('/cws/share') || lower.includes('/intent') || lower.includes('indiamart.com')) return false;

      try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        const segments = parsed.pathname.split('/').filter(Boolean);
        if (segments.length === 0) return false;

        if (platform === 'Instagram') {
          if (!lower.includes('instagram.com/')) return false;
          const handle = segments[0].toLowerCase();
          const invalidHandles = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'direct', 'accounts', 'stories', 'wix', 'share', 'sharer']);
          return !invalidHandles.has(handle);
        }
        if (platform === 'LinkedIn') {
          if (!lower.includes('linkedin.com/')) return false;
          return lower.includes('linkedin.com/company/') || lower.includes('linkedin.com/in/');
        }
        if (platform === 'Facebook') {
          return lower.includes('facebook.com/');
        }
        if (platform === 'YouTube') {
          return lower.includes('youtube.com/') || lower.includes('youtu.be/');
        }
        return true;
      } catch {
        return false;
      }
    };

    // Process all target competitors in parallel for maximum speed
    const competitorResults = await Promise.all(targetCompetitors.map(async (comp) => {
      const cleanName = comp.name.trim();

      const searchSocialUrl = async (platform: string, searchSite: string): Promise<string | null> => {
        try {
          const engine = new BingRssSearchEngine({ maxResults: 5 });
          const query = `"${cleanName}" site:${searchSite}`;
          const raw = await engine.invoke({ query });
          const results = JSON.parse(raw || "[]");
          for (const r of results) {
            const url = (r.url || "").trim();
            if (isValidProfileUrl(url, platform)) {
              return url;
            }
          }
        } catch {}
        return null;
      };

      let ytUrl = (comp as any).socials?.youtube;
      if (!ytUrl || !isValidProfileUrl(ytUrl, 'YouTube')) {
        ytUrl = await searchSocialUrl('YouTube', 'youtube.com');
        if (!ytUrl) ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(comp.name)}`;
      }

      let igUrl = (comp as any).socials?.instagram;
      if (!igUrl || !isValidProfileUrl(igUrl, 'Instagram')) {
        igUrl = await searchSocialUrl('Instagram', 'instagram.com');
        if (!igUrl) {
          const cleanHandle = comp.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanHandle.length > 2) igUrl = `https://www.instagram.com/${cleanHandle}/`;
        }
      }

      let fbUrl = (comp as any).socials?.facebook;
      if (!fbUrl || !isValidProfileUrl(fbUrl, 'Facebook')) {
        fbUrl = await searchSocialUrl('Facebook', 'facebook.com');
        if (!fbUrl) {
          const cleanHandle = comp.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanHandle.length > 2) fbUrl = `https://www.facebook.com/${cleanHandle}/`;
        }
      }

      let liUrl = (comp as any).socials?.linkedin;
      if (!liUrl || !isValidProfileUrl(liUrl, 'LinkedIn')) {
        liUrl = await searchSocialUrl('LinkedIn', 'linkedin.com/company');
        if (!liUrl) {
          const cleanHandle = comp.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (cleanHandle.length > 2) liUrl = `https://www.linkedin.com/company/${cleanHandle}/`;
        }
      }

      // Update socials object on competitor
      if (!comp.socials) comp.socials = { linkedin: null, instagram: null, facebook: null, youtube: null };
      if (isValidProfileUrl(ytUrl, 'YouTube')) comp.socials.youtube = ytUrl;
      if (isValidProfileUrl(igUrl, 'Instagram')) comp.socials.instagram = igUrl;
      if (isValidProfileUrl(fbUrl, 'Facebook')) comp.socials.facebook = fbUrl;
      if (isValidProfileUrl(liUrl, 'LinkedIn')) comp.socials.linkedin = liUrl;

      // Extract latest 3 posts per competitor per platform for multi-competitor representation
      const platformStatuses: Record<string, { status: string; reason?: string; count: number }> = {};
      const MAX_POSTS_PER_COMP = 3;

      const [ytPosts, igPosts, fbPosts, liPosts] = await Promise.all([
        socialExtractor.extractPosts("YouTube", ytUrl, comp.name, MAX_POSTS_PER_COMP).then(posts => {
          platformStatuses.YouTube = { status: posts.length > 0 ? "Success" : "No posts found", count: posts.length };
          return posts;
        }).catch(e => {
          logger.warn(`YouTube extraction error for ${comp.name}: ${e.message}`);
          platformStatuses.YouTube = { status: "Failed", reason: e.message || "Extraction timeout", count: 0 };
          return [];
        }),
        socialExtractor.extractPosts("Instagram", igUrl, comp.name, MAX_POSTS_PER_COMP).then(posts => {
          platformStatuses.Instagram = { status: posts.length > 0 ? "Success" : "No posts found", count: posts.length };
          return posts;
        }).catch(e => {
          logger.warn(`Instagram extraction error for ${comp.name}: ${e.message}`);
          platformStatuses.Instagram = { status: "Failed", reason: e.message || "Extraction timeout", count: 0 };
          return [];
        }),
        socialExtractor.extractPosts("Facebook", fbUrl, comp.name, MAX_POSTS_PER_COMP).then(posts => {
          platformStatuses.Facebook = { status: posts.length > 0 ? "Success" : "No posts found", count: posts.length };
          return posts;
        }).catch(e => {
          logger.warn(`Facebook extraction error for ${comp.name}: ${e.message}`);
          platformStatuses.Facebook = { status: "Failed", reason: e.message || "Extraction timeout", count: 0 };
          return [];
        }),
        socialExtractor.extractPosts("LinkedIn", liUrl, comp.name, MAX_POSTS_PER_COMP).then(posts => {
          platformStatuses.LinkedIn = { status: posts.length > 0 ? "Success" : "No posts found", count: posts.length };
          return posts;
        }).catch(e => {
          logger.warn(`LinkedIn extraction error for ${comp.name}: ${e.message}`);
          platformStatuses.LinkedIn = { status: "Failed", reason: e.message || "Extraction timeout", count: 0 };
          return [];
        })
      ]);

      const compPosts = [...ytPosts, ...igPosts, ...fbPosts, ...liPosts];
      (comp as any).socialStatus = platformStatuses;
      logger.info(`Extracted ${compPosts.length} verified social posts directly from accounts for ${comp.name}.`);
      return { compName: comp.name, posts: compPosts };
    }));

    try {
      // Group posts by platform -> Map<platformName, Map<competitorName, SocialPost[]>>
      const platformCompMap = new Map<string, Map<string, SocialPost[]>>();

      for (const res of competitorResults) {
        for (const post of res.posts) {
          const plat = (post.platform || 'Other').trim();
          const compName = (post.company || post.competitorName || res.compName || 'Unknown').trim();

          if (!platformCompMap.has(plat)) {
            platformCompMap.set(plat, new Map<string, SocialPost[]>());
          }
          const compMap = platformCompMap.get(plat)!;
          if (!compMap.has(compName)) {
            compMap.set(compName, []);
          }
          compMap.get(compName)!.push(post);
        }
      }

      // For each platform, interleave competitor posts round-robin so that post 1 of all competitors appear first, then post 2, then post 3
      const balancedFeed: FeedPost[] = [];
      const platformOrder = ["YouTube", "Instagram", "Facebook", "LinkedIn"];
      const allPlats = Array.from(new Set([...platformOrder, ...platformCompMap.keys()]));

      for (const plat of allPlats) {
        const compMap = platformCompMap.get(plat);
        if (!compMap || compMap.size === 0) continue;

        const compNames = Array.from(compMap.keys());
        let added = true;
        let idx = 0;

        while (added && idx < MAX_POSTS_PER_COMP) {
          added = false;
          for (const compName of compNames) {
            const posts = compMap.get(compName)!;
            if (idx < posts.length) {
              balancedFeed.push(posts[idx]);
              added = true;
            }
          }
          idx++;
        }
      }

      const updatedFeed = balancedFeed.length > 0 ? balancedFeed : competitorResults.flatMap(r => r.posts);

      (memory as any).socialFeed = updatedFeed;

      // Update memory store
      knowledgeIndex.add(memory);
      await memoryStore.save(memory);

      logger.info(`✅ Successfully completed Daily Competitor Social Tracker for ${memory.input.websiteUrl}. Extracted ${updatedFeed.length} verified posts across competitors.`);
      return updatedFeed;
    } catch (e: any) {
      logger.error(`Cron agent save failed: ${e.message}`);
      throw e;
    }
  }
}
