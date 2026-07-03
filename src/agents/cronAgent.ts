import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
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
        content: z.string().describe("The caption, transcript, or summary of the post"),
        link: z.string().nullable().describe("Direct URL to the post. You MUST copy the exact 'url' field from the search result JSON. DO NOT GUESS OR MODIFY IT.")
      }))
    });

    let allPosts: FeedPost[] = [];

    if (process.env.TAVILY_API_KEY) {
      const searchTool = new TavilySearch({ maxResults: 15 });
      
      const targetCompetitors = memory.competitors;
      const chunkSize = 5;
      
      for (let i = 0; i < targetCompetitors.length; i += chunkSize) {
        const chunk = targetCompetitors.slice(i, i + chunkSize);
        let tavilyContext = "";
        for (const comp of chunk) {
          try {
            // Split search to guarantee deep channel coverage across all major platforms equally
            const liQuery = `"${comp.name}" site:linkedin.com/posts/`;
            const xFbQuery = `"${comp.name}" (site:twitter.com OR site:x.com OR site:facebook.com)`;
            const instaQuery = `"${comp.name}" site:instagram.com`;
            const ytQuery = `"${comp.name}" site:youtube.com/watch`;
            
            const [liRaw, xFbRaw, instaRaw, ytRaw] = await Promise.all([
              searchTool.invoke({ query: liQuery }),
              searchTool.invoke({ query: xFbQuery }),
              searchTool.invoke({ query: instaQuery }),
              searchTool.invoke({ query: ytQuery })
            ]);
            
            const checkQuota = (raw: any) => {
              if (typeof raw === 'string' && raw.includes('HTTP error! status: 432')) throw new Error("Tavily API Quota Exceeded (HTTP 432)");
              if (raw && raw.error) throw new Error(raw.error);
              return typeof raw === "string" ? JSON.parse(raw) : raw;
            };

            const parsedLi = checkQuota(liRaw);
            
            // MATH HACK: Decode LinkedIn Snowflake IDs to extract the exact millisecond timestamp of the post.
            // This completely bypasses Google's inaccurate "2 days ago" cache dates.
            if (parsedLi && parsedLi.results) {
              parsedLi.results = parsedLi.results.map((r: any) => {
                const match = r.url.match(/activity-(\d+)-/);
                if (match && match[1]) {
                  try {
                    const id = BigInt(match[1]);
                    const binary = id.toString(2);
                    const timestampBinary = binary.slice(0, 41);
                    const timestamp = parseInt(timestampBinary, 2);
                    r.exact_post_date = new Date(timestamp).toISOString().split('T')[0];
                  } catch (e) {
                    // Ignore math errors on weird URLs
                  }
                }
                return r;
              });
            }
            
            const parsed = {
              linkedin: parsedLi,
              twitter_facebook: checkQuota(xFbRaw),
              instagram: checkQuota(instaRaw),
              youtube: checkQuota(ytRaw)
            };
            
            tavilyContext += `\nCompetitor: ${comp.name}\nRecent Social/Web Footprint: ${JSON.stringify(parsed)}\n`;
          } catch (e: any) {
            if (e.message.includes('432') || e.message.includes('Quota') || e.message.includes('limit')) {
              throw new Error("Tavily Search API monthly limit reached. Please upgrade your Tavily plan or use a new API key.");
            }
            logger.warn(`Failed to fetch social footprint for ${comp.name}: ${e.message}`);
          }
        }
        
        if (!tavilyContext) continue;

        const currentDate = new Date().toISOString().split('T')[0];
        const prompt = `You are an automated Social Media Tracking AI. You have just crawled the web for the latest social media footprint of the competitors for this business.
        
SEARCH CONTEXT:
${tavilyContext}

INSTRUCTIONS:
1. Review the search results and meticulously extract ONLY genuine social media posts, videos, or news updates made by the competitors.
2. The current date is ${currentDate}. You MUST ONLY extract posts that are genuinely recent (from the last 30 days).
3. We have mathematically calculated the 'exact_post_date' for LinkedIn posts and injected it into the JSON. YOU MUST USE THIS 'exact_post_date' as the ultimate source of truth!
4. If a LinkedIn post's 'exact_post_date' is older than 30 days from today, YOU MUST IGNORE IT ENTIRELY! Do not extract it!
5. For other platforms (YouTube, Twitter), if a search result explicitly says "2023", "2024", "2025", "10 years ago", or is clearly an old post (older than 30 days), YOU MUST IGNORE IT ENTIRELY!
6. If a post is verified as recent, set the 'date' field to its 'exact_post_date' (if available), otherwise use "Recent Update".
7. DO NOT extract company bio snippets, "About Us" sections, or generic profile text.
8. If there are NO genuine recent posts from the last 30 days, return an empty array []. Do not hallucinate posts.
9. For the 'link' field, you MUST extract the EXACT 'url' property provided in the search result JSON. Do not alter or hallucinate URLs.
10. Output the feed as a structured JSON array.`;

        try {
          const structuredLlm = llm.withStructuredOutput(feedSchema);
          const response = await structuredLlm.invoke(prompt);
          allPosts = allPosts.concat(response.posts as FeedPost[]);
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
