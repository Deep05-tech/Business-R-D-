import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { SocialExtractorAgent } from "./socialExtractorAgent.js";
import axios from 'axios';
import { createLogger } from "../utils/logger.js";
import { z } from "zod";
import type { StructuredMemory } from "../types.js";
import { MemoryStore } from "../memory/memoryStore.js";
import { knowledgeIndex } from "../memory/knowledgeIndex.js";

const logger = createLogger("CronAgent");

function parseRelativeDate(dateStr: string): number {
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
      model: "gpt-4o",
      temperature: 0.1,
      maxTokens: 8000,
    });

    const feedSchema = z.object({
      posts: z.array(z.object({
        platform: z.string().describe("Platform name, e.g. LinkedIn, YouTube, Facebook"),
        platformIcon: z.string().describe("Emoji icon for platform, e.g. 🟦, ▶️, 𝕏"),
        competitorName: z.string().describe("Name of the competitor who posted"),
        date: z.string().describe("The exact relative or absolute date from the source (e.g., '3 months ago', '2 days ago', 'Oct 12'). YOU MUST USE THE EXACT TIMESTAMP PROVIDED IN THE DATA. NEVER hallucinate or use vague terms like 'Recent' if a real date is available."),
        content: z.string().describe("The caption, transcript, or summary of the post. If the 'exact_post_date' or relative date indicates the post is older than 7 days, you MUST append this exact phrase to the end of the content: '\n\n⚠️ Note: This is the most recent post crawled by search engines. Newer posts may exist on the platform but have not been indexed yet.'"),
        link: z.string().nullable().describe("Direct URL to the post. You MUST copy the exact 'url' field from the search result JSON. DO NOT GUESS OR MODIFY IT."),
        mediaUrl: z.string().nullable().describe("The exact URL to the image or video thumbnail, extracted from the 'Media URLs' field in the context. If there are multiple, just pick the first valid image URL. If none, return null."),
        mediaType: z.string().nullable().describe("The type of media (e.g. 'Image', 'Video', 'Carousel', 'Text'). Extract this from the 'Media Type' field in the context.")
      }))
    });

    let allPosts: FeedPost[] = [];

    const ytApiKey = process.env.YOUTUBE_API_KEY;
    const socialExtractor = new SocialExtractorAgent();

    const targetCompetitors = memory.competitors;
    const chunkSize = 2; // Grouping by 2 to balance exhaustive extraction with OpenAI rate limit overhead

    for (let i = 0; i < targetCompetitors.length; i += chunkSize) {
      const chunk = targetCompetitors.slice(i, i + chunkSize);
      let apiContext = "";

      for (const comp of chunk) {
        let skipBusiness = false;
        try {
          logger.info(`Fetching zero-day data for ${comp.name}...`);

          // 1. YouTube via SocialExtractorAgent
          let ytDataStr: string | null = null;
          if ((comp as any).socials?.youtube) {
            try {
              logger.info(`Triggering local SocialExtractorAgent for YouTube: ${(comp as any).socials.youtube}...`);
              const rawData = await socialExtractor.extract("YouTube", (comp as any).socials.youtube);

              // Age Filtering: Discard posts older than 90 days
              let isTooOld = false;
              const dateMatch = rawData.match(/Date:\n(.*?)\n/);
              if (dateMatch && dateMatch[1]) {
                const postDate = parseRelativeDate(dateMatch[1]);
                if (!isNaN(postDate)) {
                  const daysOld = (Date.now() - postDate) / (1000 * 60 * 60 * 24);
                  if (daysOld > 90) {
                    logger.warn(`Discarding YouTube video for ${comp.name} because it is ${Math.round(daysOld)} days old.`);
                    isTooOld = true;
                  }
                }
              }

              if (!isTooOld) ytDataStr = rawData;
            } catch (e: any) {
              if (e.message && e.message.includes("PRIVATE_ACCOUNT")) {
                logger.warn(`Private account detected for ${comp.name} on YouTube. Skipping business completely.`);
                skipBusiness = true;
              } else {
                logger.warn(`YouTube Extraction error for ${comp.name}: ${e.message}`);
              }
            }
          }
          if (skipBusiness) continue;

          // 2. LinkedIn via SocialExtractorAgent
          let liDataStr: string | null = null;
          if ((comp as any).socials?.linkedin) {
            try {
              logger.info(`Triggering local SocialExtractorAgent for LinkedIn: ${(comp as any).socials.linkedin}...`);
              const rawData = await socialExtractor.extract("LinkedIn", (comp as any).socials.linkedin);

              // Age Filtering: Discard posts older than 90 days
              let isTooOld = false;
              const dateMatch = rawData.match(/Date:\n(.*?)\n/);
              if (dateMatch && dateMatch[1]) {
                const postDate = parseRelativeDate(dateMatch[1]);
                if (!isNaN(postDate)) {
                  const daysOld = (Date.now() - postDate) / (1000 * 60 * 60 * 24);
                  if (daysOld > 90) {
                    logger.warn(`Discarding LinkedIn post for ${comp.name} because it is ${Math.round(daysOld)} days old.`);
                    isTooOld = true;
                  }
                }
              }

              if (!isTooOld) liDataStr = rawData;
            } catch (e: any) {
              if (e.message && e.message.includes("PRIVATE_ACCOUNT")) {
                logger.warn(`Private account detected for ${comp.name} on LinkedIn. Skipping business completely.`);
                skipBusiness = true;
              } else {
                logger.warn(`LinkedIn Extraction error for ${comp.name}: ${e.message}`);
              }
            }
          }
          if (skipBusiness) continue;

          // 3. Instagram via SocialExtractorAgent
          let instaDataStr: string | null = null;
          if ((comp as any).socials?.instagram) {
            try {
              logger.info(`Triggering local SocialExtractorAgent for Instagram: ${(comp as any).socials.instagram}...`);
              const rawData = await socialExtractor.extract("Instagram", (comp as any).socials.instagram);

              // Age Filtering: Discard posts older than 90 days
              let isTooOld = false;
              const dateMatch = rawData.match(/Date:\n(.*?)\n/);
              if (dateMatch && dateMatch[1]) {
                const postDate = parseRelativeDate(dateMatch[1]);
                if (!isNaN(postDate)) {
                  const daysOld = (Date.now() - postDate) / (1000 * 60 * 60 * 24);
                  if (daysOld > 90) {
                    logger.warn(`Discarding Instagram post for ${comp.name} because it is ${Math.round(daysOld)} days old.`);
                    isTooOld = true;
                  }
                }
              }

              if (!isTooOld) instaDataStr = rawData;
            } catch (e: any) {
              if (e.message && e.message.includes("PRIVATE_ACCOUNT")) {
                logger.warn(`Private account detected for ${comp.name} on Instagram. Skipping business completely.`);
                skipBusiness = true;
              } else {
                logger.warn(`Instagram Extraction error for ${comp.name}: ${e.message}`);
              }
            }
          }
          if (skipBusiness) continue;

          // 4. Facebook via SocialExtractorAgent
          let fbDataStr: string | null = null;
          if ((comp as any).socials?.facebook) {
            try {
              logger.info(`Triggering local SocialExtractorAgent for Facebook: ${(comp as any).socials.facebook}...`);
              const rawData = await socialExtractor.extract("Facebook", (comp as any).socials.facebook);

              // Age Filtering: Discard posts older than 90 days
              let isTooOld = false;
              const dateMatch = rawData.match(/Date:\n(.*?)\n/);
              if (dateMatch && dateMatch[1]) {
                const postDate = parseRelativeDate(dateMatch[1]);
                if (!isNaN(postDate)) {
                  const daysOld = (Date.now() - postDate) / (1000 * 60 * 60 * 24);
                  if (daysOld > 90) {
                    logger.warn(`Discarding Facebook post for ${comp.name} because it is ${Math.round(daysOld)} days old.`);
                    isTooOld = true;
                  }
                }
              }

              if (!isTooOld) fbDataStr = rawData;
            } catch (e: any) {
              if (e.message && e.message.includes("PRIVATE_ACCOUNT")) {
                logger.warn(`Private account detected for ${comp.name} on Facebook. Skipping business completely.`);
                skipBusiness = true;
              } else {
                logger.warn(`Facebook Extraction error for ${comp.name}: ${e.message}`);
              }
            }
          }
          if (skipBusiness) continue;

          const parsed = {
            // Deprecated youtube API block
          };

          apiContext += `\nCompetitor: ${comp.name}\nRecent Social/Web Footprint: ${JSON.stringify(parsed)}\n`;
          if (ytDataStr) apiContext += `\nYouTube Extraction Data:\n${ytDataStr}\n`;
          if (liDataStr) apiContext += `\nLinkedIn Extraction Data:\n${liDataStr}\n`;
          if (instaDataStr) apiContext += `\nInstagram Extraction Data:\n${instaDataStr}\n`;
          if (fbDataStr) apiContext += `\nFacebook Extraction Data:\n${fbDataStr}\n`;
        } catch (e: any) {
          logger.warn(`Failed to fetch footprint for ${comp.name}: ${e.message}`);
        }
      }

      if (!apiContext) continue;

      const currentDate = new Date().toISOString().split('T')[0];
      const prompt = `You are an automated Social Media Tracking AI. You have just crawled the web and directly integrated with APIs for the latest social media footprint of the competitors for this business.
        
SEARCH & API CONTEXT:
${apiContext}

INSTRUCTIONS:
1. Review the search results and meticulously extract ONLY genuine social media posts, videos, or news updates made by the competitors.
2. EXHAUSTIVE EXTRACTION: You MUST extract EVERY SINGLE VALID POST you find in the context. Do not stop after 1 or 2 posts. If there are 10 valid posts across the platforms, you MUST output all 10!
3. The current date is ${currentDate}.
4. If a dataset comes from "LinkedIn Extraction Data", "Instagram Extraction Data", "Facebook Extraction Data", or "YouTube Data API", the timestamps are 100% accurate zero-day data. You MUST NOT apply the search index warning to these posts. Use the provided dates exactly as written.
5. For other platforms (Facebook/Instagram), if a search result explicitly says "2023", "2024", "10 years ago", or is clearly an old post (older than 90 days), YOU MUST IGNORE IT ENTIRELY!
6. DO NOT extract company bio snippets, "About Us" sections, or generic profile text.
7. If there are NO genuine recent posts from the last 90 days, return an empty array []. Do not hallucinate posts.
8. For the 'link', 'mediaUrl', and 'mediaType' fields, you MUST extract the exact data provided. Do not hallucinate image URLs.
9. Output the feed as a structured JSON array.`;

      try {
        const structuredLlm = llm.withStructuredOutput(feedSchema);
        const response = await structuredLlm.invoke(prompt);
        allPosts = allPosts.concat(response.posts as FeedPost[]);

        // Anti-429 Delay: wait 10 seconds before processing the next chunk to strictly respect OpenAI's 30,000 TPM limit
        await new Promise(resolve => setTimeout(resolve, 10000));
      } catch (e: any) {
        logger.error(`Cron agent chunk synthesis failed: ${e.message}`);
      }
    }

    try {
      // Save feed to memory (OVERWRITE to flush old/historical posts)
      const updatedFeed = [...allPosts].slice(0, 50);

      (memory as any).socialFeed = updatedFeed;

      // Update memory store
      knowledgeIndex.add(memory);
      await memoryStore.save(memory);

      logger.info(`✅ Successfully completed Daily Competitor Social Tracker for ${memory.input.websiteUrl}. Extracted ${updatedFeed.length} recent posts.`);
      return updatedFeed;
    } catch (e: any) {
      logger.error(`Cron agent save failed: ${e.message}`);
      throw e;
    }
  }
}
