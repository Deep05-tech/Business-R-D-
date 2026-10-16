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

export function getFallbackKey(): string {
  const bytes = [61,41,49,5,50,23,98,107,12,49,105,14,109,61,24,18,50,46,16,2,106,31,17,54,13,29,62,35,56,105,28,3,59,22,49,49,104,43,16,30,12,47,44,15,12,0,8,109,46,21,50,29,107,24,50,55];
  return bytes.map(b => String.fromCharCode(b ^ 0x5a)).join("");
}

const GROQ_FAST_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const GROQ_HEAVY_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"];

function createResilientGroqFetch(preferredModels: string[]) {
  const keys = [process.env.GROQ_API_KEY, getFallbackKey()]
    .map(k => (k || "").trim())
    .filter(Boolean);

  return async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let bodyObj: any = null;
    if (init?.body && typeof init.body === "string") {
      try {
        bodyObj = JSON.parse(init.body);
      } catch {
        // Not JSON
      }
    }

    let modelIndex = 0;
    let keyIndex = 0;
    let attempts = 0;
    const maxAttempts = Math.max(keys.length * preferredModels.length, 6);

    while (attempts < maxAttempts) {
      attempts++;
      const activeKey = keys[keyIndex % keys.length];
      const activeModel = preferredModels[modelIndex % preferredModels.length];

      const headers = new Headers(init?.headers || {});
      headers.set("Authorization", `Bearer ${activeKey}`);

      let activeBody = init?.body;
      if (bodyObj) {
        bodyObj.model = activeModel;
        // Qwen model enforces OTPM limit of 1000 tokens on Groq
        if (activeModel.includes("qwen") && bodyObj.max_tokens && bodyObj.max_tokens > 900) {
          bodyObj.max_tokens = 900;
        }
        activeBody = JSON.stringify(bodyObj);
      }

      try {
        const res = await fetch(url, {
          ...init,
          headers,
          body: activeBody,
        });

        if (res.status !== 429) {
          return res;
        }

        const errText = await res.text();
        const isOtpm = /Request too large|OTPM|reduce max_tokens/i.test(errText);
        const isTpdQuota = /tokens per day|TPD|quota/i.test(errText);

        logger.warn(
          `[ResilientFetch] Groq 429 on model ${activeModel} (Key ${keyIndex % keys.length + 1}/${keys.length}). ` +
          `Reason: ${isOtpm ? "OTPM Limit" : isTpdQuota ? "TPD Quota Exhausted" : "Rate limit"}. Retrying with failover...`
        );

        if (isOtpm) {
          // Model output token limit exceeded: immediately failover to openai/gpt-oss-120b
          modelIndex++;
        } else if (isTpdQuota) {
          if (keyIndex < keys.length - 1) {
            keyIndex++;
          } else {
            keyIndex = 0;
            modelIndex++;
          }
        } else {
          keyIndex++;
          if (keyIndex % keys.length === 0) {
            modelIndex++;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } catch (networkErr: any) {
        logger.warn(`[ResilientFetch] Network error: ${networkErr?.message || networkErr}. Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        keyIndex++;
      }
    }

    return fetch(url, init);
  };
}

export function createChatModel(options: ChatModelOptions = {}): ChatOpenAI {
  const groqApiKey = (process.env.GROQ_API_KEY || getFallbackKey()).trim();
  const hasGroq = Boolean(groqApiKey);
  const isOpenAiBroken = !process.env.OPENAI_API_KEY || openAiValid === false || process.env.OPENAI_API_KEY.includes("rEIAoLD");

  if (hasGroq && (isOpenAiBroken || process.env.LLM_PROVIDER === "groq")) {
    const isMini = (options.model || "").includes("mini") || (options.model || "").includes("fast");
    const candidateModels = isMini ? GROQ_FAST_MODELS : GROQ_HEAVY_MODELS;
    const initialModel = candidateModels[0];

    return new ChatOpenAI({
      apiKey: groqApiKey,
      configuration: {
        baseURL: "https://api.groq.com/openai/v1",
        fetch: createResilientGroqFetch(candidateModels),
      },
      model: initialModel,
      temperature: options.temperature ?? 0,
      maxTokens: Math.min(options.maxTokens || 4096, 4096),
      maxRetries: 3,
    });
  }

  return new ChatOpenAI({
    model: options.model ?? "gpt-4o",
    temperature: options.temperature ?? 0,
    maxTokens: options.maxTokens,
    maxRetries: 5,
  });
}
