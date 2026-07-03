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

    let tavilyContext = "";
    if (process.env.TAVILY_API_KEY) {
      const searchTool = new TavilySearch({ maxResults: 3 });
      
      // Iterate through all competitors for a complete feed update
      const targetCompetitors = memory.competitors;
      for (const comp of targetCompetitors) {
        try {
          // Google Dork tailored for actual posts and news
          const query = `(site:linkedin.com/posts OR site:twitter.com OR site:youtube.com) "${comp.name}" ("days ago" OR "hours ago" OR "months ago")`;
          const resultRaw = await searchTool.invoke({ query });
          const parsed = typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw;
          
          tavilyContext += `\nCompetitor: ${comp.name}\nRecent Social/Web Footprint: ${JSON.stringify(parsed)}\n`;
        } catch (e: any) {
          logger.warn(`Failed to fetch social footprint for ${comp.name}: ${e.message}`);
        }
      }
    }

    const feedSchema = z.object({
      posts: z.array(z.object({
        platform: z.string().describe("Platform name, e.g. LinkedIn, YouTube, Twitter"),
        platformIcon: z.string().describe("Emoji icon for platform, e.g. 🟦, ▶️, 𝕏"),
        competitorName: z.string().describe("Name of the competitor who posted"),
        date: z.string().describe("Estimated date (e.g., 'Today', '2 days ago', or exact date)"),
        content: z.string().describe("The caption, transcript, or summary of the post"),
        link: z.string().nullable().describe("Direct URL to the post if available")
      }))
    });

    const prompt = `You are an automated Social Media Tracking AI. You have just crawled the web for the latest social media footprint of the top competitors for this business.
    
SEARCH CONTEXT:
${tavilyContext}

INSTRUCTIONS:
1. Review the search results and meticulously extract ONLY genuine, recent social media posts, videos, or news updates made by the competitors.
2. DO NOT extract company bio snippets, "About Us" sections, or generic profile text (e.g. "Join us for a virtual tour...", "Proud to be recognized as a leader..."). These are NOT posts! 
3. If a search result does not explicitly look like a time-stamped social media post or news article, IGNORE IT.
4. If there are NO genuine posts in the context, return an empty array []. Do not invent or hallucinate posts under any circumstances.
5. Output the feed as a structured JSON array.`;

    try {
      const structuredLlm = llm.withStructuredOutput(feedSchema);
      const response = await structuredLlm.invoke(prompt);
      
      const posts = response.posts as FeedPost[];
      
      // Save feed to memory
      // We will append to existing feed to create a timeline, keeping max 50 items
      const existingFeed = (memory as any).socialFeed || [];
      const updatedFeed = [...posts, ...existingFeed].slice(0, 50);
      
      (memory as any).socialFeed = updatedFeed;
      
      // Update memory store
      knowledgeIndex.add(memory);
      await memoryStore.save(memory);
      
      return updatedFeed;
    } catch (e: any) {
      logger.error(`Cron agent failed: ${e.message}`);
      throw e;
    }
  }
}
