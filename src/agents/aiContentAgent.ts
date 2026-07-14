import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import type { OfferingsAndProcesses } from "./offeringsExtractionAgent.js";

const logger = createLogger("AiContentAgent");

export class AiContentAgent {
  readonly name = "ai-content-agent";
  readonly version = "1.0.0";

  async run(data: OfferingsAndProcesses): Promise<OfferingsAndProcesses> {
    logger.info("Generating AI content (Layman & Social) for all offerings and processes...");

    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.7, // Higher temp for creative writing
    });

    const result = { ...data };

    // Helper to generate content
    const generateContent = async (itemType: string, itemData: any) => {
      const prompt = `You are a professional B2B copywriter and technical translator.
I will give you raw data about a business ${itemType}.
Your task is to generate ONE thing:
A 'laymanSummary': A summary explaining what this is, how it works, and its benefits in simple terms (2-3 paragraphs with bullet points).

Respond with ONLY the raw summary text. DO NOT wrap it in a JSON object. Just provide the text directly.

RAW DATA:
${JSON.stringify(itemData, null, 2)}
`;
      try {
        const response = await (llm as any).invoke(prompt);
        const text = typeof response.content === "string" ? response.content : String(response.content);
        return {
          aiLaymanSummary: text.trim(),
        };
      } catch (err) {
        logger.error(`Failed to generate AI content for ${itemData.name}: ${err}`);
        return { aiLaymanSummary: "Content generation failed." };
      }
    };

    const processInBatches = async (items: any[], type: string, batchSize = 5) => {
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (item) => {
            logger.info(`Generating content for ${type}: ${item.name}`);
            const aiContent = await generateContent(type, item);
            item.aiLaymanSummary = aiContent.aiLaymanSummary;
          })
        );
      }
    };

    await processInBatches(result.offerings.products, "Product");
    await processInBatches(result.offerings.services, "Service");
    await processInBatches(result.processes.processes, "Process");

    return result;
  }
}
