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
        date: z.string().describe("Estimated date (e.g., 'Today', '2 days ago', or exact date)"),
        content: z.string().describe("The caption, transcript, or summary of the post"),
        link: z.string().nullable().describe("Direct URL to the post. You MUST copy the exact 'url' field from the search result JSON. DO NOT GUESS OR MODIFY IT.")
      }))
    });

    let allPosts: FeedPost[] = [];

    if (process.env.TAVILY_API_KEY) {
      const searchTool = new TavilySearch({ maxResults: 3 });
      
      const targetCompetitors = memory.competitors;
      const chunkSize = 5;
      
      for (let i = 0; i < targetCompetitors.length; i += chunkSize) {
        const chunk = targetCompetitors.slice(i, i + chunkSize);
        let tavilyContext = "";
        
        for (const comp of chunk) {
          try {
            const query = `Latest news, updates, or social media posts from "${comp.name}" within the last 6 months`;
            const resultRaw = await searchTool.invoke({ query });
            const parsed = typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw;
            
            tavilyContext += `\nCompetitor: ${comp.name}\nRecent Social/Web Footprint: ${JSON.stringify(parsed)}\n`;
          } catch (e: any) {
            logger.warn(`Failed to fetch social footprint for ${comp.name}: ${e.message}`);
          }
        }
        
        if (!tavilyContext) continue;

        const prompt = `You are an automated Social Media Tracking AI. You have just crawled the web for the latest social media footprint of the competitors for this business.
        
SEARCH CONTEXT:
${tavilyContext}

INSTRUCTIONS:
1. Review the search results and meticulously extract ONLY genuine, recent social media posts, videos, or news updates made by the competitors.
2. DO NOT extract company bio snippets, "About Us" sections, or generic profile text (e.g. "Join us for a virtual tour...", "Proud to be recognized as a leader..."). These are NOT posts! 
3. If a search result does not explicitly look like a time-stamped social media post or news article, IGNORE IT.
4. If there are NO genuine posts in the context, return an empty array []. Do not invent or hallucinate posts under any circumstances.
5. For the 'link' field, you MUST extract the EXACT 'url' property provided in the search result JSON. Do not alter, shorten, or hallucinate URLs.
6. Output the feed as a structured JSON array.`;

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
      // Save feed to memory (OVERWRITE to flush old hallucinations)
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
