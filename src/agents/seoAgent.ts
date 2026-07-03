import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory } from "../types.js";

const logger = createLogger("SeoAgent");

export class SeoAgent {
  readonly name = "seo-agent";
  readonly version = "1.0.0";

  async run(memory: StructuredMemory): Promise<string> {
    logger.info(`Running SEO & Google Presence analysis for ${memory.input.websiteUrl}...`);

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.2,
      maxTokens: 8000,
    });

    const memoryContext = JSON.stringify({
      businessIdentity: memory.businessIdentity,
      offerings: memory.offerings,
      industryClassification: memory.industryClassification,
      competitors: memory.competitors || []
    }, null, 2);

    const prompt = `You are an elite SEO Strategist and Growth Hacker. 
Your task is to analyze the following business memory and its identified top competitors, and generate a strategic, actionable SEO & Google Presence Improvement Plan.

BUSINESS & COMPETITOR CONTEXT:
${memoryContext}

INSTRUCTIONS:
1. Identify the high-value "money keywords" (commercial intent) that the competitors are likely dominating based on their product profiles.
2. Formulate a 3-step actionable SEO strategy (Content, Technical, Backlink/Local) to outrank these competitors.
3. Keep the tone professional, highly technical, and direct. Output in clean Markdown format with bold headings.
4. Focus heavily on how the business can exploit gaps in the competitors' apparent strategies.

Format:
### 1. High-Value Competitor Keyword Targets
[List 5-8 exact match keywords with high commercial intent]

### 2. Website & Content Strategy
[Actionable plan based on products]

### 3. Google Presence & Authority Building
[Actionable plan for backlinks and local/global SEO]
`;

    try {
      const response = await llm.invoke(prompt);
      return typeof response.content === "string" ? response.content : "Error generating SEO strategy.";
    } catch (e: any) {
      logger.error(`SEO Agent failed: ${e.message}`);
      throw e;
    }
  }
}
