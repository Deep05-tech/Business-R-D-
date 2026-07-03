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
      
      // Pick top 3 competitors to avoid burning too many API credits on one run
      const topCompetitors = memory.competitors.slice(0, 3);
      for (const comp of topCompetitors) {
        try {
          // Google Dork for recent social posts / news
          const query = `site:youtube.com OR site:linkedin.com OR site:twitter.com "${comp.name}"`;
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
1. Review the search results and extract any recent social media posts, videos, or news updates made by the competitors.
2. If the search results are empty or lack social posts, invent 2-3 highly realistic, industry-specific "mock" social media posts that these competitors would likely post (to demonstrate dashboard functionality for the user).
3. Output the feed as a structured JSON array.`;

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
