import { SocialExtractorAgent } from "./socialExtractorAgent.js";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory, SocialPost, CompetitorProfile } from "../types.js";
import { MemoryStore } from "../memory/memoryStore.js";
import { knowledgeIndex } from "../memory/knowledgeIndex.js";
import { BingRssSearchEngine } from "../utils/bingRssSearchEngine.js";
import { BraveSearchEngine } from "../utils/braveSearchEngine.js";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";
import { isTavilyAvailable, markTavilyQuotaExhausted } from "../utils/tavilyClient.js";
import { CompetitorAgent } from "./competitorAgent.js";
import { isAuthenticCompetitorProfile, isInstagramBundleHash } from "../utils/socialVerificationUtils.js";
import axios from "axios";
import pLimit from "p-limit";

const logger = createLogger("CronAgent");

export interface FeedPost extends SocialPost {
  platformIcon?: string;
}

export class CronAgent {
  readonly name = "cron-agent";
  readonly version = "1.0.0";

  async run(memory: StructuredMemory, memoryStore: MemoryStore = new MemoryStore()): Promise<SocialPost[]> {
    logger.info(`Running Direct Social Media Account Scraper for ${memory.input.websiteUrl}...`);

    if (!memory.competitors || memory.competitors.length === 0) {
      logger.info(`No competitors found in memory for ${memory.input.websiteUrl}. Automatically discovering competitors first...`);
      try {
        const discovered = await new CompetitorAgent().run(memory, "all", undefined, 15);
        if (discovered && discovered.length > 0) {
          memory.competitors = discovered;
          knowledgeIndex.add(memory);
          await memoryStore.save(memory);
          logger.success(`Discovered ${discovered.length} competitors. Proceeding with competitor feed tracking...`);
        } else {
          logger.warn(`No competitors could be discovered for ${memory.input.websiteUrl}. Skipping feed crawl.`);
          return [];
        }
      } catch (err: any) {
        logger.warn(`Competitor auto-discovery failed: ${err.message}. Skipping feed crawl.`);
        return [];
      }
    }

    let allPosts: SocialPost[] = [];
    const socialExtractor = new SocialExtractorAgent();
    
    // Track all project competitors (up to 45 competitors) to ensure full footprint coverage
    const MAX_TARGET_COMPETITORS = Math.min(45, Math.max(25, (memory.competitors || []).length));
    const seenCompUrls = new Set<string>();
    const targetCompetitors: CompetitorProfile[] = [];

    const addComp = (c: CompetitorProfile) => {
      if (!c) return;
      const key = (c.url || c.name || "").toLowerCase().trim();
      if (!key || seenCompUrls.has(key) || targetCompetitors.length >= MAX_TARGET_COMPETITORS) return;
      seenCompUrls.add(key);
      targetCompetitors.push(c);
    };

    // Priority 1: Competitors that already have at least one active social URL
    for (const c of (memory.competitors || [])) {
      const hasSocial = c.socials && Object.values(c.socials).some(v => typeof v === 'string' && v.trim().length > 0);
      if (hasSocial) {
        addComp(c);
      }
    }

    // Priority 2: All remaining competitors up to MAX_TARGET_COMPETITORS
    for (const c of (memory.competitors || [])) {
      addComp(c);
    }
    const MAX_POSTS_PER_COMP = 10;
    const configuredConcurrency = Number(process.env.SOCIAL_TRACKER_CONCURRENCY || 3);
    const competitorLimit = pLimit(Number.isFinite(configuredConcurrency) ? Math.max(1, Math.min(configuredConcurrency, 4)) : 3);

    // A missing or human-readable date is not evidence of inactivity. We only
    // retire a competitor when every retrieved post has a reliable date and
    // the newest one is older than the six-month activity window.
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const parsePostDate = (post: SocialPost): Date | null => {
      const raw = String(post.published_date || post.date || post.timestamp || "").trim();
      if (!raw || /^(recent|just now|unknown|n\/a)$/i.test(raw)) return null;
      const direct = new Date(raw);
      if (!Number.isNaN(direct.getTime())) return direct;
      const relative = raw.toLowerCase().match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/);
      if (!relative) return null;
      const date = new Date();
      const amount = Number(relative[1]);
      const unit = relative[2];
      if (unit === "minute") date.setMinutes(date.getMinutes() - amount);
      else if (unit === "hour") date.setHours(date.getHours() - amount);
      else if (unit === "day") date.setDate(date.getDate() - amount);
      else if (unit === "week") date.setDate(date.getDate() - amount * 7);
      else if (unit === "month") date.setMonth(date.getMonth() - amount);
      else date.setFullYear(date.getFullYear() - amount);
      return date;
    };
    const hasOnlyStalePosts = (posts: SocialPost[]): boolean => {
      if (posts.length === 0) return false;
      const dates = posts.map(parsePostDate);
      return dates.every((date): date is Date => date !== null) && dates.every(date => date < sixMonthsAgo);
    };

    const isValidProfileUrl = (url?: string | null, platform?: string, competitorName?: string, pageTitle?: string): boolean => {
      if (!url || typeof url !== 'string' || !platform) return false;
      const lower = url.toLowerCase().trim();
      if (lower.includes('/sharer') || lower.includes('/share?') || lower.includes('/cws/share') || lower.includes('/intent') || lower.includes('indiamart.com')) return false;

      // If competitorName is provided, strictly enforce authenticity
      if (competitorName) {
        return isAuthenticCompetitorProfile(url, platform, competitorName, pageTitle);
      }

      try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        const segments = parsed.pathname.split('/').filter(Boolean);
        if (segments.length === 0) return false;

        if (platform === 'Instagram') {
          if (!lower.includes('instagram.com/')) return false;
          const handle = segments[0].toLowerCase();
          const invalidHandles = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'direct', 'accounts', 'stories', 'wix', 'share', 'sharer', 'popular', 'tags', 'locations', 'login', 'about']);
          return !invalidHandles.has(handle) && segments.length <= 2;
        }
        if (platform === 'LinkedIn') {
          if (!lower.includes('linkedin.com/')) return false;
          return lower.includes('linkedin.com/company/') || lower.includes('linkedin.com/in/');
        }
        if (platform === 'Facebook') {
          if (!lower.includes('facebook.com/')) return false;
          if (lower.includes('/groups/') || lower.includes('/sharer') || lower.includes('/share?') || lower.includes('/dialog/') || lower.includes('/login')) return false;
          const handle = segments[0].toLowerCase();
          const invalidHandles = new Set(['groups', 'sharer', 'share', 'login', 'policies', 'dialog', 'events', 'photo', 'photos', 'video', 'videos', 'story', 'permalink', 'help']);
          return !invalidHandles.has(handle);
        }
        if (platform === 'YouTube') {
          if (!lower.includes('youtube.com/') && !lower.includes('youtu.be/')) return false;
          if (lower.includes('/results?') || lower.includes('%27') || lower.includes(';') || lower.includes(')')) return false;
          return true;
        }
        return true;
      } catch {
        return false;
      }
    };

    const competitorResults = await Promise.all(targetCompetitors.map(comp => competitorLimit(async () => {
      const cleanName = comp.name
        .replace(/^m\/s\.?\s+/i, '')
        .split(/[-–—|(/]/)[0]
        .replace(/\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?|gmbh)\b/gi, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || comp.name.trim();

      const searchSocialUrl = async (platform: string, searchSite: string): Promise<string | null> => {
        if (isTavilyAvailable()) {
          const tavilyKey = process.env.TAVILY_API_KEY;
          try {
            const domain = searchSite.split('/')[0];
            const tavilyRes = await axios.post("https://api.tavily.com/search", {
              api_key: tavilyKey,
              query: `${cleanName} ${platform.toLowerCase()} official profile`,
              search_depth: "basic",
              include_domains: [domain],
              max_results: 5
            }, { timeout: 6000 });
            if (tavilyRes.data && Array.isArray(tavilyRes.data.results)) {
              for (const r of tavilyRes.data.results) {
                const u = (r.url || "").trim();
                if (isValidProfileUrl(u, platform, cleanName, r.title)) return u;
              }
            }
          } catch (tavErr: any) {
            const status = tavErr.response?.status;
            const errMsg = tavErr.response?.data?.detail?.error || tavErr.message || '';
            if (status === 432 || status === 429 || errMsg.includes('limit') || errMsg.includes('quota')) {
              markTavilyQuotaExhausted(errMsg);
            }
          }
        }
        // Fallback 1: Fast, keyless Brave Search Engine
        try {
          const engine = new BraveSearchEngine({ maxResults: 5 });
          const query = `"${cleanName}" site:${searchSite}`;
          const raw = await engine.invoke({ query });
          const results = JSON.parse(raw || "[]");
          for (const r of results) {
            const url = (r.url || "").trim();
            if (isValidProfileUrl(url, platform, cleanName, r.title)) {
              return url;
            }
          }
        } catch {}

        // Fallback 2: Free DuckDuckGo Search Engine
        try {
          const engine = new FreeSearchEngine({ maxResults: 5 });
          const query = `${cleanName} site:${searchSite}`;
          const raw = await engine.invoke({ query });
          const results = JSON.parse(raw || "[]");
          for (const r of results) {
            const url = (r.url || "").trim();
            if (isValidProfileUrl(url, platform, cleanName, r.title)) {
              return url;
            }
          }
        } catch {}

        // Fallback 3: Bing RSS Search Engine
        try {
          const engine = new BingRssSearchEngine({ maxResults: 5 });
          const query = `"${cleanName}" site:${searchSite}`;
          const raw = await engine.invoke({ query });
          const results = JSON.parse(raw || "[]");
          for (const r of results) {
            const url = (r.url || "").trim();
            if (isValidProfileUrl(url, platform, cleanName, r.title)) {
              return url;
            }
          }
        } catch {}
        return null;
      };

      let ytUrl = (comp as any).socials?.youtube;
      if (ytUrl && typeof ytUrl === 'string' && ytUrl.startsWith('http') && isValidProfileUrl(ytUrl, 'YouTube')) {
        // Valid existing profile URL - preserve it
      } else if (!ytUrl || !isValidProfileUrl(ytUrl, 'YouTube')) {
        ytUrl = await searchSocialUrl('YouTube', 'youtube.com');
      }

      let igUrl = (comp as any).socials?.instagram;
      if (igUrl && typeof igUrl === 'string' && igUrl.startsWith('http') && isValidProfileUrl(igUrl, 'Instagram')) {
        // Valid existing profile URL - preserve it
      } else if (!igUrl || !isValidProfileUrl(igUrl, 'Instagram')) {
        igUrl = await searchSocialUrl('Instagram', 'instagram.com');
      }

      let fbUrl = (comp as any).socials?.facebook;
      if (fbUrl && typeof fbUrl === 'string' && fbUrl.startsWith('http') && isValidProfileUrl(fbUrl, 'Facebook')) {
        // Valid existing profile URL - preserve it
      } else if (!fbUrl || !isValidProfileUrl(fbUrl, 'Facebook')) {
        fbUrl = await searchSocialUrl('Facebook', 'facebook.com');
      }

      let liUrl = (comp as any).socials?.linkedin;
      if (liUrl && typeof liUrl === 'string' && liUrl.startsWith('http') && isValidProfileUrl(liUrl, 'LinkedIn')) {
        // Valid existing profile URL - preserve it
      } else if (!liUrl || !isValidProfileUrl(liUrl, 'LinkedIn')) {
        liUrl = await searchSocialUrl('LinkedIn', 'linkedin.com/company');
      }

      // Update socials object on competitor without clearing existing authentic accounts
      if (!comp.socials) comp.socials = { linkedin: null, instagram: null, facebook: null, youtube: null };
      if (ytUrl) comp.socials.youtube = ytUrl;
      if (igUrl) comp.socials.instagram = igUrl;
      if (fbUrl) comp.socials.facebook = fbUrl;
      if (liUrl) comp.socials.linkedin = liUrl;

      // Extract up to 10 posts per competitor per platform for rich feed coverage
      const platformStatuses: Record<string, { status: string; reason?: string; count: number }> = {};

      const [ytPosts, igPosts, fbPosts, liPosts] = await Promise.all([
        socialExtractor.extractPosts("YouTube", ytUrl, cleanName, MAX_POSTS_PER_COMP, { preferHttp: true }).then(posts => {
          platformStatuses.YouTube = { status: posts.length > 0 ? "Success" : "No posts found", count: posts.length };
          return posts;
        }).catch(e => {
          logger.warn(`YouTube extraction error for ${comp.name}: ${e.message}`);
          platformStatuses.YouTube = { status: "Failed", reason: e.message || "Extraction timeout", count: 0 };
          return [];
        }),
        socialExtractor.extractPosts("Instagram", igUrl, cleanName, MAX_POSTS_PER_COMP, { preferHttp: true }).then(posts => {
          platformStatuses.Instagram = { status: posts.length > 0 ? "Success" : "No posts found", count: posts.length };
          return posts;
        }).catch(e => {
          logger.warn(`Instagram extraction error for ${comp.name}: ${e.message}`);
          platformStatuses.Instagram = { status: "Failed", reason: e.message || "Extraction timeout", count: 0 };
          return [];
        }),
        socialExtractor.extractPosts("Facebook", fbUrl, cleanName, MAX_POSTS_PER_COMP, { preferHttp: true }).then(posts => {
          platformStatuses.Facebook = { status: posts.length > 0 ? "Success" : "No posts found", count: posts.length };
          return posts;
        }).catch(e => {
          logger.warn(`Facebook extraction error for ${comp.name}: ${e.message}`);
          platformStatuses.Facebook = { status: "Failed", reason: e.message || "Extraction timeout", count: 0 };
          return [];
        }),
        socialExtractor.extractPosts("LinkedIn", liUrl, cleanName, MAX_POSTS_PER_COMP, { preferHttp: true }).then(posts => {
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

      // Self-healing backfill: if search fallback discovered posts with a verified profile, persist it to comp.socials
      if (!comp.socials) comp.socials = { linkedin: null, instagram: null, facebook: null, youtube: null };
      if (!comp.socials.youtube && ytPosts.length > 0) {
        const foundUrl = ytPosts.find(p => p.profile_url || p.profileUrl)?.profile_url || (ytPosts[0] as any).channelUrl;
        if (foundUrl && isValidProfileUrl(foundUrl, 'YouTube', cleanName)) comp.socials.youtube = foundUrl;
      }
      if (!comp.socials.instagram && igPosts.length > 0) {
        const foundUrl = igPosts.find(p => p.profile_url || p.profileUrl)?.profile_url;
        if (foundUrl && isValidProfileUrl(foundUrl, 'Instagram', cleanName)) comp.socials.instagram = foundUrl;
      }
      if (!comp.socials.facebook && fbPosts.length > 0) {
        const foundUrl = fbPosts.find(p => p.profile_url || p.profileUrl)?.profile_url;
        if (foundUrl && isValidProfileUrl(foundUrl, 'Facebook', cleanName)) comp.socials.facebook = foundUrl;
      }
      if (!comp.socials.linkedin && liPosts.length > 0) {
        const foundUrl = liPosts.find(p => p.profile_url || p.profileUrl)?.profile_url;
        if (foundUrl && isValidProfileUrl(foundUrl, 'LinkedIn', cleanName)) comp.socials.linkedin = foundUrl;
      }

      logger.info(`Extracted ${compPosts.length} verified social posts directly from accounts for ${comp.name}.`);
      return { compName: comp.name, competitor: comp, posts: compPosts };
    })));

    const staleCompetitors = competitorResults
      .filter(result => hasOnlyStalePosts(result.posts))
      .map(result => result.competitor);
    const retiredCompetitorUrls = new Set<string>();

    if (staleCompetitors.length > 0) {
      const staleUrls = new Set(staleCompetitors.map(competitor => competitor.url));
      staleUrls.forEach(url => retiredCompetitorUrls.add(url));
      const staleNames = staleCompetitors.map(competitor => competitor.name).join(", ");
      logger.info(`Flagging ${staleCompetitors.length} competitor(s) with no recent social activity: ${staleNames}.`);

      // In B2B manufacturing, lack of recent social posts does not disqualify an operating competitor.
      // Flag inactive social accounts so the UI displays the DEAD ACCOUNT badge without destroying
      // the user's mapped competitors in memory.competitors.
      for (const comp of (memory.competitors || [])) {
        if (staleUrls.has(comp.url)) {
          (comp as any).isDeadAccount = true;
          (comp as any).isInactiveSocial = true;
        }
      }

      // Optionally attempt to discover fresh active replacement competitors to expand the tracking list
      try {
        const replacements = await new CompetitorAgent().run(memory, "regional", undefined, staleCompetitors.length);
        const selected = replacements.slice(0, staleCompetitors.length);
        if (selected.length > 0) {
          const compMap = new Map<string, any>();
          for (const c of (memory.competitors || [])) {
            if (c?.url) compMap.set(c.url.toLowerCase(), c);
          }
          for (const c of selected) {
            if (c?.url) compMap.set(c.url.toLowerCase(), c);
          }
          memory.competitors = Array.from(compMap.values());
          logger.info(`Added ${selected.length} fresh replacement competitor(s) to tracking footprint.`);
        }
      } catch (error: any) {
        logger.warn(`Could not fetch replacement competitors: ${error.message}`);
      }
    }

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

      // Merge freshly crawled posts with any previously saved verified posts
      // so temporary timeouts or single-platform rate limits never wipe out historical verified posts
      const existingFeed: FeedPost[] = Array.isArray((memory as any).socialFeed) ? (memory as any).socialFeed : [];
      const mergedMap = new Map<string, FeedPost>();

      const normalizePostKey = (p: any): string => {
        const plat = String(p.platform || p._detectedPlatform || '').trim().toLowerCase();
        const cleanComp = String(p.company || p.competitorName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        const rawUrl = String(p.post_url || p.link || p.postUrl || '').trim().toLowerCase();
        const ytMatch = rawUrl.match(/(?:v=|\/vi\/|shorts\/)([\w-]{11})/);
        if (ytMatch && ytMatch[1]) {
          return `youtube_${ytMatch[1]}`;
        }
        const cleanUrl = rawUrl
          .replace(/([?&])(?:utm_[^&]+|fbclid=[^&]+|igsh=[^&]+|si=[^&]+|__cft__[^&]+|__tn__[^&]+)/gi, '$1')
          .replace(/[?&]$/, '')
          .replace(/\/+$/, '');
        const id = String(p.id || '').trim().toLowerCase();
        return `${plat}_${cleanComp}_${cleanUrl || id}`;
      };

      // Add fresh crawled posts first
      for (const p of updatedFeed) {
        const k = normalizePostKey(p);
        if (k && !mergedMap.has(k)) {
          mergedMap.set(k, p);
        }
      }

      // Preserve previously verified posts that were not re-scraped in this run
      for (const p of existingFeed) {
        if (!p) continue;
        const u = String(p.post_url || p.link || p.postUrl || '').toLowerCase();
        const id = String(p.id || '').toLowerCase();
        if (isInstagramBundleHash(u) || isInstagramBundleHash(id)) continue;

        // Auto-heal Facebook posts if thumbnail is missing
        if (p.platform === 'Facebook' && (!p.thumbnail || !p.thumbnail.startsWith('http'))) {
          const photoMatch = u.match(/(?:fbid=|\/photos\/(?:[^\/]+\/)?|\/photo\/?\?fbid=|\bmedia_id=)(\d{8,25})/i);
          if (photoMatch && photoMatch[1]) {
            p.thumbnail = `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${photoMatch[1]}`;
            p.media_url = p.thumbnail;
          }
        }

        const k = normalizePostKey(p);
        if (k && !mergedMap.has(k)) {
          mergedMap.set(k, p);
        }
      }

      const mergedFeed = Array.from(mergedMap.values());

      const getPostTimestamp = (p: any): number => {
        const raw = String(p.date || p.published_date || p.timestamp || '').trim();
        if (!raw) return 0;
        const lower = raw.toLowerCase();
        if (lower === 'today' || lower === 'just now' || lower.includes('minute') || lower.includes('second')) return Date.now();
        if (lower === 'yesterday') return Date.now() - 86400000;
        if (lower.includes('hour') && lower.includes('ago')) {
          const hrs = parseInt(lower) || 1;
          return Date.now() - (hrs * 3600000);
        }
        if (lower.includes('day') && lower.includes('ago')) {
          const days = parseInt(lower) || 1;
          return Date.now() - (days * 86400000);
        }
        if (lower.includes('week') && lower.includes('ago')) {
          const wks = parseInt(lower) || 1;
          return Date.now() - (wks * 7 * 86400000);
        }
        if (lower.includes('month') && lower.includes('ago')) {
          const mos = parseInt(lower) || 1;
          return Date.now() - (mos * 30 * 86400000);
        }
        if (lower.includes('year') && lower.includes('ago')) {
          const yrs = parseInt(lower) || 1;
          return Date.now() - (yrs * 365 * 86400000);
        }
        if (lower === 'recent') return Date.now() - 43200000;
        const parsed = Date.parse(raw);
        if (!isNaN(parsed)) return parsed;
        return 0;
      };

      mergedFeed.sort((a, b) => getPostTimestamp(b) - getPostTimestamp(a));
      (memory as any).socialFeed = mergedFeed;

      // Update memory store
      knowledgeIndex.add(memory);
      await memoryStore.save(memory);

      logger.info(`✅ Successfully completed Daily Competitor Social Tracker for ${memory.input.websiteUrl}. Feed now contains ${mergedFeed.length} verified posts across competitors.`);
      return mergedFeed;
    } catch (e: any) {
      logger.error(`Cron agent save failed: ${e.message}`);
      throw e;
    }
  }
}
