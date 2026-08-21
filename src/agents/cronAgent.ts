import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { SocialExtractorAgent } from "./socialExtractorAgent.js";
import { NewsSearchEngine } from "../utils/newsSearchEngine.js";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";
import axios from 'axios';
import { createLogger } from "../utils/logger.js";
import { z } from "zod";
import type { StructuredMemory } from "../types.js";
import { MemoryStore } from "../memory/memoryStore.js";
import { knowledgeIndex } from "../memory/knowledgeIndex.js";
import { agentRules } from "../config/agentRules.js";

const logger = createLogger("CronAgent");

function parseRelativeDate(dateStr?: string | null): number {
  if (!dateStr || typeof dateStr !== 'string') return 0;
  const now = Date.now();
  const str = dateStr.toLowerCase().trim();

  // Exact dates
  const parsed = new Date(dateStr).getTime();
  if (!isNaN(parsed)) return parsed;

  // Relative dates
  let match = str.match(/(\d+)\s*(m|min|mins|minute|minutes)s?/);
  if (match) return now - parseInt(match[1]) * 60 * 1000;

  match = str.match(/(\d+)\s*(h|hr|hrs|hour|hours)s?/);
  if (match) return now - parseInt(match[1]) * 60 * 60 * 1000;

  match = str.match(/(\d+)\s*(d|day|days)s?/);
  if (match) return now - parseInt(match[1]) * 24 * 60 * 60 * 1000;

  match = str.match(/(\d+)\s*(w|wk|wks|week|weeks)s?/);
  if (match) return now - parseInt(match[1]) * 7 * 24 * 60 * 60 * 1000;

  match = str.match(/(\d+)\s*(mo|mos|month|months)s?/);
  if (match) return now - parseInt(match[1]) * 30 * 24 * 60 * 60 * 1000;

  match = str.match(/(\d+)\s*(y|yr|yrs|year|years)s?/);
  if (match) return now - parseInt(match[1]) * 365 * 24 * 60 * 60 * 1000;

  return NaN;
}

export interface FeedPost {
  platform: string;
  platformIcon: string;
  competitorName: string;
  date: string;
  content: string;
  link: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
}

export class CronAgent {
  readonly name = "cron-agent";
  readonly version = "1.0.0";

  async run(memory: StructuredMemory, memoryStore: MemoryStore): Promise<FeedPost[]> {
    logger.info(`Running Daily Competitor Social Tracker for ${memory.input.websiteUrl}...`);

    if (!memory.competitors || memory.competitors.length === 0) {
      logger.warn(`No competitors found for ${memory.input.websiteUrl}. Skipping cron.`);
      return [];
    }

    const llm = new ChatOpenAI({
      model: agentRules.models.default,
      temperature: 0.1,
      maxTokens: 8000,
    });

    const feedSchema = z.object({
      posts: z.array(z.object({
        platform: z.string().describe("Platform name, e.g. LinkedIn, YouTube, Facebook"),
        platformIcon: z.string().describe("Emoji icon for platform, e.g. 🟦, ▶️, 𝕏"),
        competitorName: z.string().describe("Name of the competitor who posted"),
        content: z.string().describe("The caption, transcript, or summary of the post. DO NOT output 'No caption'. If the caption is missing or minimal, summarize the post topic or competitor activity cleanly based on the available title, snippet, or profile context."),
        link: z.string().nullable().describe("Direct URL to the post. You MUST copy the exact 'postUrl' field from the extraction data. DO NOT GUESS OR MODIFY IT."),
        mediaUrl: z.string().nullable().describe("The exact URL to the image or video thumbnail, extracted from the 'mediaUrls' field in the extraction data. If there are multiple, just pick the first valid image URL. If none, return null."),
        mediaType: z.string().nullable().describe("The type of media (e.g. 'Image', 'Video', 'Carousel', 'Text'). Extract this from the 'Media Type' field in the context.")
      }))
    });

    let allPosts: FeedPost[] = [];
    const socialExtractor = new SocialExtractorAgent();
    const targetCompetitors = memory.competitors || [];

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

    const freeEngine = new FreeSearchEngine({ maxResults: 4 });
    const newsEngine = new NewsSearchEngine({ maxResults: 5 });

    for (const comp of targetCompetitors) {
      let combinedRawData = "";

      const searchName = comp.name.split(',')[0].split('-')[0].trim();

      // 1. YouTube (Direct scraping + Search Fallback)
      const ytUrl = (comp as any).socials?.youtube;
      let ytData = "";
      if (isValidProfileUrl(ytUrl, 'YouTube')) {
        try {
          logger.info(`Triggering SocialExtractorAgent for ${comp.name} (YouTube: ${ytUrl})...`);
          ytData = await socialExtractor.extract("YouTube", ytUrl, comp.name);
        } catch (e: any) {
          logger.warn(`YouTube extraction error for ${comp.name}: ${e.message}`);
        }
      }
      if (!ytData || ytData.includes("Extraction Failed")) {
        try {
          logger.info(`Running YouTube search fallback for ${searchName}...`);
          let results = await newsEngine.search(`${searchName} youtube video OR channel`);
          if (!results || results.length === 0) {
            const rawFree = await freeEngine.invoke({ query: `${searchName} youtube video` });
            try { results = JSON.parse(rawFree); } catch {}
          }
          if (Array.isArray(results) && results.length > 0) {
            ytData = `Platform: YouTube\nProfile URL: ${ytUrl || "https://www.youtube.com"}\nExtracted Posts:\n`;
            for (const r of results) {
              ytData += `- Caption: ${r.title} - ${r.content}\n  Post URL: ${r.url}\n  Date: ${r.published_date || "Recent"}\n`;
            }
          }
        } catch (e: any) {
          logger.warn(`YouTube search fallback error: ${e.message}`);
        }
      }
      if (ytData && !ytData.includes("Extraction Failed")) {
        combinedRawData += `\n--- YOUTUBE DATA ---\n${ytData}\n`;
      }

      // 2. Instagram (Direct scraping + Search Fallback)
      const igUrl = (comp as any).socials?.instagram;
      let igData = "";
      if (isValidProfileUrl(igUrl, 'Instagram')) {
        try {
          logger.info(`Triggering SocialExtractorAgent for ${comp.name} (Instagram: ${igUrl})...`);
          igData = await socialExtractor.extract("Instagram", igUrl);
        } catch (e: any) {
          logger.warn(`Instagram direct extraction error for ${comp.name}: ${e.message}`);
        }
      }
      if (!igData || igData.includes("Extraction Failed")) {
        try {
          logger.info(`Running Instagram search fallback for ${searchName}...`);
          let results = await newsEngine.search(`${searchName} instagram post OR photo OR reel`);
          if (!results || results.length === 0) {
            const rawFree = await freeEngine.invoke({ query: `${searchName} instagram` });
            try { results = JSON.parse(rawFree); } catch {}
          }
          if (Array.isArray(results) && results.length > 0) {
            igData = `Platform: Instagram\nProfile URL: ${igUrl || "https://www.instagram.com"}\nExtracted Posts:\n`;
            for (const r of results) {
              igData += `- Caption: ${r.title} - ${r.content}\n  Post URL: ${r.url}\n  Date: ${r.published_date || "Recent"}\n`;
            }
          }
        } catch (e: any) {
          logger.warn(`Instagram search fallback error: ${e.message}`);
        }
      }
      if (igData && !igData.includes("Extraction Failed")) {
        combinedRawData += `\n--- INSTAGRAM DATA ---\n${igData}\n`;
      }

      // 3. Facebook (Direct scraping + Search Fallback)
      const fbUrl = (comp as any).socials?.facebook;
      let fbData = "";
      if (isValidProfileUrl(fbUrl, 'Facebook')) {
        try {
          logger.info(`Triggering SocialExtractorAgent for ${comp.name} (Facebook: ${fbUrl})...`);
          fbData = await socialExtractor.extract("Facebook", fbUrl);
        } catch (e: any) {
          logger.warn(`Facebook direct extraction error for ${comp.name}: ${e.message}`);
        }
      }
      if (!fbData || fbData.includes("Extraction Failed")) {
        try {
          logger.info(`Running Facebook search fallback for ${searchName}...`);
          let results = await newsEngine.search(`site:facebook.com "${searchName}" (posts OR pfbid OR photos OR videos OR story OR permalink)`);
          if (!results || results.length === 0) {
            const rawFree = await freeEngine.invoke({ query: `site:facebook.com "${searchName}" posts` });
            try { results = JSON.parse(rawFree); } catch {}
          }
          if (Array.isArray(results) && results.length > 0) {
            fbData = `Platform: Facebook\nProfile URL: ${fbUrl || "https://www.facebook.com"}\nExtracted Posts:\n`;
            for (const r of results) {
              let pUrl = r.url || "";
              fbData += `- Caption: ${r.title} - ${r.content}\n  Post URL: ${pUrl}\n  Date: ${r.published_date || "Recent"}\n`;
            }
          }
        } catch (e: any) {
          logger.warn(`Facebook search fallback error: ${e.message}`);
        }
      }
      if (fbData && !fbData.includes("Extraction Failed")) {
        combinedRawData += `\n--- FACEBOOK DATA ---\n${fbData}\n`;
      }

      // 4. LinkedIn (Direct scraping + Search Fallback)
      const liUrl = (comp as any).socials?.linkedin;
      let liData = "";
      if (isValidProfileUrl(liUrl, 'LinkedIn')) {
        try {
          logger.info(`Triggering SocialExtractorAgent for ${comp.name} (LinkedIn: ${liUrl})...`);
          liData = await socialExtractor.extract("LinkedIn", liUrl);
        } catch (e: any) {
          logger.warn(`LinkedIn direct extraction error for ${comp.name}: ${e.message}`);
        }
      }
      if (!liData || liData.includes("Extraction Failed")) {
        try {
          logger.info(`Running LinkedIn search fallback for ${searchName}...`);
          let results = await newsEngine.search(`${searchName} linkedin post OR update OR announcement`);
          if (!results || results.length === 0) {
            const rawFree = await freeEngine.invoke({ query: `${searchName} linkedin` });
            try { results = JSON.parse(rawFree); } catch {}
          }
          if (Array.isArray(results) && results.length > 0) {
            liData = `Platform: LinkedIn\nProfile URL: ${liUrl || "https://www.linkedin.com"}\nExtracted Posts:\n`;
            for (const r of results) {
              liData += `- Caption: ${r.title} - ${r.content}\n  Post URL: ${r.url}\n  Date: ${r.published_date || "Recent"}\n`;
            }
          }
        } catch (e: any) {
          logger.warn(`LinkedIn search fallback error: ${e.message}`);
        }
      }
      if (liData && !liData.includes("Extraction Failed")) {
        combinedRawData += `\n--- LINKEDIN DATA ---\n${liData}\n`;
      }

      // 5. News & Press Updates Fallback
      try {
        logger.info(`Fetching News & Press updates for ${searchName}...`);
        let newsHits = await newsEngine.search(`${searchName} press release OR news OR announcement`);
        if (!newsHits || newsHits.length === 0) {
          const rawFree = await freeEngine.invoke({ query: `${searchName} news press release announcement` });
          try { newsHits = JSON.parse(rawFree); } catch {}
        }
        if (Array.isArray(newsHits) && newsHits.length > 0) {
          combinedRawData += `\n--- NEWS & PRESS UPDATES ---\n`;
          for (const hit of newsHits) {
            combinedRawData += `Title: ${hit.title}\nURL: ${hit.url}\nDate: ${hit.published_date || "Recent"}\nSnippet: ${hit.content}\n\n`;
          }
        }
      } catch (newsErr: any) {
        logger.warn(`News search error for ${comp.name}: ${newsErr.message}`);
      }

      if (!combinedRawData.trim()) {
        logger.info(`No social extraction or news data obtained for ${comp.name}.`);
        continue;
      }

      try {
        const currentDate = new Date().toISOString().split('T')[0];
        const prompt = `You are an automated Social Media Tracking AI for competitor intelligence.
You are parsing raw social media extraction and search data strictly for competitor: "${comp.name}".

COMPETITOR NAME: ${comp.name}
RAW EXTRACTION DATA:
${combinedRawData}

INSTRUCTIONS:
1. Extract ALL valid posts, updates, and announcements present in the raw data above for "${comp.name}".
2. YOU MUST INCLUDE POSTS FROM MULTIPLE PLATFORMS present in the raw data (LinkedIn, Facebook, Instagram, YouTube, News, Press). DO NOT output only YouTube videos. Ensure a diverse mix across platforms.
3. For EVERY post, competitorName MUST be set to EXACTLY "${comp.name}".
4. Set platform to the corresponding platform ("LinkedIn", "Facebook", "Instagram", "YouTube", "News", or "Press").
5. Set platformIcon accordingly (🟦 for LinkedIn, 🔵 for Facebook, 📸 for Instagram, ▶️ for YouTube, 📰 for News/Press).
6. For EVERY post, copy the exact post URL from the extraction data. DO NOT make up fake URLs.
7. Current date is ${currentDate}. Preserve extracted dates accurately.
8. Output JSON matching feedSchema.`;

        const structuredLlm = llm.withStructuredOutput(feedSchema);
        const response = await structuredLlm.invoke(prompt);

        if (response && Array.isArray(response.posts)) {
          const validPosts = (response.posts as FeedPost[]).filter(p => {
            const link = String(p.link || "");
            const isFakeUrl = link.includes("xyz123") || link.includes("abc456") || link.includes("example.com");
            return link.length > 5 && !isFakeUrl;
          }).map(p => ({
            ...p,
            competitorName: comp.name // Hard lock competitor name to guarantee 100% accurate attribution
          }));

          logger.info(`Extracted ${validPosts.length} verified social posts for ${comp.name}.`);
          allPosts = allPosts.concat(validPosts);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e: any) {
        logger.warn(`Social synthesis error for ${comp.name}: ${e.message}`);
      }
    }

    try {
      // Group posts by platform to guarantee diverse platform representation across platforms
      const platformMap = new Map<string, FeedPost[]>();
      for (const p of allPosts) {
        const plat = (p.platform || 'Other').trim();
        if (!platformMap.has(plat)) platformMap.set(plat, []);
        platformMap.get(plat)!.push(p);
      }

      // Interleave posts across platforms (round-robin)
      const balancedPosts: FeedPost[] = [];
      const platformKeys = Array.from(platformMap.keys());
      let added = true;
      let idx = 0;

      while (added && balancedPosts.length < 60) {
        added = false;
        for (const k of platformKeys) {
          const list = platformMap.get(k)!;
          if (idx < list.length) {
            balancedPosts.push(list[idx]);
            added = true;
          }
        }
        idx++;
      }

      const updatedFeed = balancedPosts.length > 0 ? balancedPosts : allPosts.slice(0, 50);

      (memory as any).socialFeed = updatedFeed;

      // Update memory store
      knowledgeIndex.add(memory);
      await memoryStore.save(memory);

      logger.info(`✅ Successfully completed Daily Competitor Social Tracker for ${memory.input.websiteUrl}. Extracted ${updatedFeed.length} verified posts.`);
      return updatedFeed;
    } catch (e: any) {
      logger.error(`Cron agent save failed: ${e.message}`);
      throw e;
    }
  }
}
