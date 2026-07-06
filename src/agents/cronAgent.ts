import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { ApifyClient } from 'apify-client';
import axios from 'axios';
import { createLogger } from "../utils/logger.js";
import { z } from "zod";
import type { StructuredMemory } from "../types.js";
import { MemoryStore } from "../memory/memoryStore.js";
import { knowledgeIndex } from "../memory/knowledgeIndex.js";

const logger = createLogger("CronAgent");

export interface FeedPost {
  platform: string;
  platformIcon: string;
  competitorName: string;
  date: string;
  content: string;
  link: string | null;
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
        platform: z.string().describe("Platform name, e.g. LinkedIn, YouTube, Twitter"),
        platformIcon: z.string().describe("Emoji icon for platform, e.g. 🟦, ▶️, 𝕏"),
        competitorName: z.string().describe("Name of the competitor who posted"),
        date: z.string().describe("The exact relative or absolute date from the source (e.g., '3 months ago', '2 days ago', 'Oct 12'). NEVER use vague terms like 'Recent'."),
        content: z.string().describe("The caption, transcript, or summary of the post. If the 'exact_post_date' or relative date indicates the post is older than 7 days, you MUST append this exact phrase to the end of the content: '\n\n⚠️ Note: This is the most recent post crawled by search engines. Newer posts may exist on the platform but have not been indexed yet.'"),
        link: z.string().nullable().describe("Direct URL to the post. You MUST copy the exact 'url' field from the search result JSON. DO NOT GUESS OR MODIFY IT.")
      }))
    });

    let allPosts: FeedPost[] = [];

    if (process.env.TAVILY_API_KEY) {
      const searchTool = new TavilySearch({ 
        maxResults: 15,
        searchDepth: "advanced"
      } as any);
      
      const apifyClient = process.env.APIFY_API_TOKEN ? new ApifyClient({ token: process.env.APIFY_API_TOKEN }) : null;
      const ytApiKey = process.env.YOUTUBE_API_KEY;
      
      const targetCompetitors = memory.competitors;
      const chunkSize = 2; // Grouping by 2 to balance exhaustive extraction with OpenAI rate limit overhead
      
      for (let i = 0; i < targetCompetitors.length; i += chunkSize) {
        const chunk = targetCompetitors.slice(i, i + chunkSize);
        let apiContext = "";
        
        for (const comp of chunk) {
          try {
            logger.info(`Fetching zero-day data for ${comp.name}...`);
            
            // 1. YouTube Data API
            let ytData: any = null;
            if (ytApiKey) {
              try {
                const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(comp.name)}&type=channel&maxResults=1&key=${ytApiKey}`;
                const searchRes = await axios.get(searchUrl);
                if (searchRes.data.items && searchRes.data.items.length > 0) {
                  const channelId = searchRes.data.items[0].id.channelId;
                  const sixtyDaysAgo = new Date();
                  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
                  const videoUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&order=date&type=video&publishedAfter=${sixtyDaysAgo.toISOString()}&maxResults=5&key=${ytApiKey}`;
                  const videoRes = await axios.get(videoUrl);
                  ytData = { source: "YouTube Data API", results: videoRes.data.items };
                }
              } catch (e: any) {
                logger.warn(`YouTube API error for ${comp.name}: ${e.message}`);
              }
            }
            if (!ytData) {
              ytData = await searchTool.invoke({ query: `"${comp.name}" site:youtube.com/watch` });
            }

            // 2. Apify LinkedIn Scraper
            let liData: any = null;
            if (apifyClient) {
              try {
                const liRes = await searchTool.invoke({ query: `"${comp.name}" site:linkedin.com/company/` });
                let companyUrl = null;
                if (liRes && typeof liRes !== 'string' && (liRes as any).results) {
                   const match = (liRes as any).results.find((r: any) => r.url.includes('linkedin.com/company/'));
                   if (match) companyUrl = match.url;
                }
                if (companyUrl) {
                  logger.info(`Triggering Apify LinkedIn Actor for ${companyUrl}... (this may take 60s)`);
                  const run = await apifyClient.actor("quacker/linkedin-company-post-scraper").call({
                      "urls": [companyUrl],
                      "deepScrape": false,
                      "maxPosts": 5
                  });
                  const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
                  liData = { source: "Apify LinkedIn API", results: items };
                }
              } catch (e: any) {
                logger.warn(`Apify error for ${comp.name}: ${e.message}`);
              }
            }
            if (!liData) {
              liData = await searchTool.invoke({ query: `"${comp.name}" site:linkedin.com/posts/` });
            }

            // 3. Tavily Fallback for Twitter/FB/Insta
            const xFbQuery = `"${comp.name}" (site:twitter.com OR site:x.com OR site:facebook.com)`;
            const instaQuery = `"${comp.name}" site:instagram.com`;
            const [xFbRaw, instaRaw] = await Promise.all([
              searchTool.invoke({ query: xFbQuery }),
              searchTool.invoke({ query: instaQuery })
            ]);
            
            const checkQuota = (raw: any) => {
              if (typeof raw === 'string' && raw.includes('HTTP error! status: 432')) throw new Error("Tavily API Quota Exceeded (HTTP 432)");
              if (raw && raw.error) {
                if (raw.error.includes("No search results found")) return { results: [] };
                throw new Error(raw.error);
              }
              const parsedRaw = typeof raw === "string" ? JSON.parse(raw) : raw;
              
              if (parsedRaw && parsedRaw.results) {
                parsedRaw.results = parsedRaw.results.filter((r: any) => {
                  const text = ((r.content || "") + " " + (r.title || "")).toLowerCase();
                  if (text.match(/202[0-5]|years?\s+ago/)) return false;
                  return true;
                }).map((r: any) => {
                  if (r.content) r.content = r.content.substring(0, 600) + (r.content.length > 600 ? '...' : '');
                  delete r.raw_content;
                  return r;
                });
                parsedRaw.results = parsedRaw.results.slice(0, 8);
              }
              return parsedRaw;
            };

            const parsed = {
              linkedin: (liData && liData.source === "Apify LinkedIn API") ? liData : checkQuota(liData),
              youtube: (ytData && ytData.source === "YouTube Data API") ? ytData : checkQuota(ytData),
              twitter_facebook: checkQuota(xFbRaw),
              instagram: checkQuota(instaRaw),
            };
            
            apiContext += `\nCompetitor: ${comp.name}\nRecent Social/Web Footprint: ${JSON.stringify(parsed)}\n`;
          } catch (e: any) {
            if (e.message.includes('432') || e.message.includes('Quota') || e.message.includes('limit')) {
              throw new Error("Tavily Search API monthly limit reached.");
            }
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
4. If a dataset comes from "Apify LinkedIn API" or "YouTube Data API", the timestamps are 100% accurate zero-day data. You MUST NOT apply the search index warning to these posts.
5. If a LinkedIn post's date or 'exact_post_date' is older than 60 days from today, YOU MUST IGNORE IT ENTIRELY! Do not extract it!
6. For other platforms (YouTube, Twitter, Instagram), if a search result explicitly says "2023", "2024", "10 years ago", or is clearly an old post (older than 60 days), YOU MUST IGNORE IT ENTIRELY!
7. DO NOT extract company bio snippets, "About Us" sections, or generic profile text.
8. If there are NO genuine recent posts from the last 30 days, return an empty array []. Do not hallucinate posts.
9. For the 'link' field, you MUST extract the EXACT URL provided. Do not alter or hallucinate URLs.
10. Output the feed as a structured JSON array.`;

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
    }

    try {
      // Save feed to memory (OVERWRITE to flush old/historical posts)
      const updatedFeed = [...allPosts].slice(0, 50);
      
      (memory as any).socialFeed = updatedFeed;
      
      // Update memory store
      knowledgeIndex.add(memory);
      await memoryStore.save(memory);
      
      return updatedFeed;
    } catch (e: any) {
      logger.error(`Cron agent save failed: ${e.message}`);
      throw e;
    }
  }
}
