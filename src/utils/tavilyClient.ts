import { createLogger } from "./logger.js";

const logger = createLogger("TavilyClient");

let isTavilyGloballyAvailable = true;
let tavilyCooldownUntil = 0;

export function isTavilyAvailable(): boolean {
  if (!process.env.TAVILY_API_KEY) {
    return false;
  }
  if (!isTavilyGloballyAvailable && Date.now() < tavilyCooldownUntil) {
    return false;
  }
  // Cooldown expired, tentatively reset
  if (!isTavilyGloballyAvailable && Date.now() >= tavilyCooldownUntil) {
    isTavilyGloballyAvailable = true;
  }
  return true;
}

export function markTavilyQuotaExhausted(reason?: string, cooldownMs = 30 * 60 * 1000): void {
  if (isTavilyGloballyAvailable) {
    logger.warn(`Tavily search quota/rate limit reached (${reason || 'usage limit exceeded'}). Suppressing further Tavily calls for ${Math.round(cooldownMs / 60000)}m and falling back to alternative engines.`);
  }
  isTavilyGloballyAvailable = false;
  tavilyCooldownUntil = Date.now() + cooldownMs;
}
