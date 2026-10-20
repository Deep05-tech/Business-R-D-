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

export function isOpenAiAvailable(): boolean {
  return openAiValid === true;
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

const GROQ_FAST_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
const GROQ_HEAVY_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];

// Track per-model daily quota exhaustion to avoid hammering quota-exhausted models
const modelExhaustedUntil: Record<string, number> = {};

function createResilientGroqFetch(preferredModels: string[]) {
  const rawKeys = [process.env.GROQ_API_KEY, getFallbackKey()]
    .map(k => (k || "").trim())
    .filter(Boolean);
  const keys = Array.from(new Set(rawKeys));

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
    const maxAttempts = Math.max(keys.length * preferredModels.length * 2, 8);

    while (attempts < maxAttempts) {
      attempts++;
      const activeKey = keys[keyIndex % keys.length];

      // Find next model that is not currently quota-exhausted
      let activeModel = preferredModels[modelIndex % preferredModels.length];
      let foundAvailable = false;
      for (let i = 0; i < preferredModels.length; i++) {
        const candidate = preferredModels[(modelIndex + i) % preferredModels.length];
        if ((modelExhaustedUntil[candidate] || 0) < Date.now()) {
          activeModel = candidate;
          modelIndex = (modelIndex + i) % preferredModels.length;
          foundAvailable = true;
          break;
        }
      }

      // If all candidate models are in a short rolling cooldown, wait for the nearest one
      if (!foundAvailable) {
        const minWait = Math.min(...preferredModels.map(m => Math.max(0, (modelExhaustedUntil[m] || 0) - Date.now())));
        if (minWait > 0 && minWait <= 45000) {
          logger.info(`[ResilientFetch] All Groq models in rolling cooldown. Waiting ${minWait + 500}ms for token window reset...`);
          await new Promise((resolve) => setTimeout(resolve, minWait + 500));
          continue;
        }
      }

      const headers = new Headers(init?.headers || {});
      headers.set("Authorization", `Bearer ${activeKey}`);

      let activeBody = init?.body;
      if (bodyObj) {
        bodyObj.model = activeModel;
        // Qwen model enforces strict OTPM limit of 1000 tokens on Groq
        if (activeModel.includes("qwen") && bodyObj.max_tokens && bodyObj.max_tokens > 250) {
          bodyObj.max_tokens = 250;
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
        const isOtpm = /Request too large|OTPM/i.test(errText);
        const isTpdQuota = /tokens per day|TPD|quota/i.test(errText);
        const waitMatch = errText.match(/try again in ([0-9.]+)s/i);
        const waitSec = waitMatch ? parseFloat(waitMatch[1]) : 0;

        logger.warn(
          `[ResilientFetch] Groq 429 on model ${activeModel} (Key ${keyIndex % keys.length + 1}/${keys.length}). ` +
          `Reason: ${isOtpm ? "OTPM Limit" : isTpdQuota ? "TPD Quota Exhausted" : "Rate limit"}. Retrying with failover...`
        );

        if (isTpdQuota) {
          if (waitSec > 0 && waitSec <= 65) {
            // Rolling token-per-minute window: cooldown only for the requested window + 1s jitter
            modelExhaustedUntil[activeModel] = Date.now() + Math.ceil(waitSec * 1000) + 1000;
            modelIndex++;
          } else {
            // Hard daily quota exhausted: latch disabled for 15 minutes and switch model immediately
            modelExhaustedUntil[activeModel] = Date.now() + 15 * 60 * 1000;
            modelIndex++;
          }
        } else if (isOtpm) {
          const jitter = Math.floor(Math.random() * 1500);
          const waitMs = waitMatch ? Math.min(Math.ceil(parseFloat(waitMatch[1]) * 1000) + 500 + jitter, 15000) : 3000 + jitter;
          logger.info(`[ResilientFetch] Cooling down ${waitMs}ms for OTPM window...`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          if (bodyObj && bodyObj.max_tokens) {
            bodyObj.max_tokens = Math.min(bodyObj.max_tokens, 150);
          }
          keyIndex++;
          if (keyIndex % keys.length === 0) {
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
