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
      const searchTool = new TavilySearch({ maxResults: 3 });
      
      const targetCompetitors = memory.competitors;
      const chunkSize = 5;
      
      for (let i = 0; i < targetCompetitors.length; i += chunkSize) {
        const chunk = targetCompetitors.slice(i, i + chunkSize);
        let tavilyContext = "";
        
        for (const comp of chunk) {
          try {
            const query = `(site:linkedin.com OR site:twitter.com OR site:x.com OR site:youtube.com OR site:facebook.com) "${comp.name}" latest posts OR news`;
            const resultRaw = await searchTool.invoke({ query });
            
            // Handle Langchain Tavily 432 quota exceeded responses masquerading as valid returns
            if (typeof resultRaw === 'string' && resultRaw.includes('HTTP error! status: 432')) {
               throw new Error("Tavily API Quota Exceeded (HTTP 432)");
            }
            if (resultRaw && resultRaw.error) {
               throw new Error(resultRaw.error);
            }

            const parsed = typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw;
            
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
2. The current date is ${currentDate}. You MUST ONLY extract posts that were made within the last 14 DAYS.
3. CRITICAL WARNING: Search engines often falsely label 1-year-old LinkedIn/Twitter posts as "2 days ago" because that is when the page was cached. You CANNOT trust the "2 days ago" prefix blindly.
4. You MUST read the actual text snippet. If there is no contextual proof in the text that the event actually happened recently (e.g., words like "This week", "Yesterday", "Just launched", "Today's event", or recent exact dates), YOU MUST REJECT IT.
5. If a search result explicitly mentions older months, past years, or lacks contextual freshness, IGNORE IT ENTIRELY!
6. For the 'date' field, use the contextual time found in the text. Do NOT invent vague terms like "Recent".
7. DO NOT extract company bio snippets, "About Us" sections, or generic profile text.
8. If there are NO genuinely verifiable recent posts, return an empty array []. Do not hallucinate posts.
9. For the 'link' field, you MUST extract the EXACT 'url' property provided in the search result JSON. The url MUST be from a social media domain (linkedin, twitter, youtube, facebook). Do not alter or hallucinate URLs.
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
