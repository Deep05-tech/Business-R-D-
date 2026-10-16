import dotenv from "dotenv";
dotenv.config();
import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "./logger.js";

const logger = createLogger("LLMFactory");

let openAiValid: boolean | null = null;
let lastProbe = 0;

export async function checkOpenAiStatus(): Promise<boolean> {
  const now = Date.now();
  if (openAiValid !== null && now - lastProbe < 300_000) {
    return openAiValid;
  }
  if (!process.env.OPENAI_API_KEY) {
    openAiValid = false;
    return false;
  }
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}` },
      signal: AbortSignal.timeout(3000),
    });
    openAiValid = res.status === 200;
  } catch {
    openAiValid = false;
  }
  lastProbe = now;
  if (!openAiValid && process.env.GROQ_API_KEY) {
    logger.warn("OpenAI API key is invalid or unreachable. Automatically routing LLM calls to Groq (openai/gpt-oss-120b / openai/gpt-oss-20b).");
  }
  return openAiValid;
}

// Initial probe on module load
checkOpenAiStatus().catch(() => {});

export interface ChatModelOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: any;
}

export function createChatModel(options: ChatModelOptions = {}): ChatOpenAI {
  const hasGroq = Boolean(process.env.GROQ_API_KEY);
  const isOpenAiBroken = !process.env.OPENAI_API_KEY || openAiValid === false || process.env.OPENAI_API_KEY.includes("rEIAoLD");

  if (hasGroq && (isOpenAiBroken || process.env.LLM_PROVIDER === "groq")) {
    const isMini = (options.model || "").includes("mini") || (options.model || "").includes("fast");
    const groqModel = isMini ? "openai/gpt-oss-20b" : "openai/gpt-oss-120b";
    return new ChatOpenAI({
      apiKey: process.env.GROQ_API_KEY,
      configuration: { baseURL: "https://api.groq.com/openai/v1" },
      model: groqModel,
      temperature: options.temperature ?? 0,
      maxTokens: options.maxTokens,
      maxRetries: 5,
    });
  }

  return new ChatOpenAI({
    model: options.model ?? "gpt-4o",
    temperature: options.temperature ?? 0,
    maxTokens: options.maxTokens,
    maxRetries: 5,
  });
}
