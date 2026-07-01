import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import type { QueryResult } from "../memory/memoryStore.js";

const logger = createLogger("Query Memory Agent");

export class QueryMemoryAgent {
  async run(question: string, queryResult: QueryResult): Promise<QueryResult> {
    logger.info(`Synthesizing AI answer for question: "${question}"`);

    if (!queryResult.found || queryResult.evidence.length === 0) {
      return {
        ...queryResult,
        answer: "I couldn't find any relevant facts in the business memory to answer that question.",
      };
    }

    try {
      const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.2 });
      
      const prompt = `You are an intelligent business analyst assistant querying an internal database.
Answer the user's question accurately using ONLY the provided semantic facts extracted from the business's website.
Do not invent information. If the facts do not contain the answer, state that clearly.

User Question: "${question}"

Extracted Facts:
${queryResult.evidence.join("\n---\n")}
`;

      const response = await (llm as any).invoke(prompt);
      const answer = typeof response.content === "string" ? response.content : String(response.content);

      return {
        ...queryResult,
        answer: answer,
      };
    } catch (e) {
      logger.error("LLM Synthesis failed. Falling back to raw facts.", e);
      return {
        ...queryResult,
        answer: `(AI synthesis failed. Raw facts below)\n\n${queryResult.evidence.join("\n")}`,
      };
    }
  }
}
