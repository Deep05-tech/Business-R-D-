import * as https from "node:https";
import { createLogger } from "./logger.js";

const logger = createLogger("BingRssSearchEngine");

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Keyless web search via Bing's RSS output (https://www.bing.com/search?format=rss).
 * Lightweight and accessible from IPs that Brave/DuckDuckGo bot-check, making it a
 * useful secondary engine for social-profile discovery.
 */
export class BingRssSearchEngine {
  private maxResults: number;

  constructor(config: { maxResults?: number } = {}) {
    this.maxResults = config.maxResults || 20;
  }

  async invoke({ query }: { query: string }): Promise<string> {
    try {
      const path = `/search?${new URLSearchParams({ q: query, format: "rss", count: String(this.maxResults) })}`;
      const xml = await this.httpGet(path);
      const results: SearchResult[] = [];

      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, this.maxResults)) {
        const title = (item.match(/<title>([^<]*)<\/title>/) || [])[1]?.trim() || "";
        const url = (item.match(/<link>([^<]*)<\/link>/) || [])[1]?.trim() || "";
        const description = (item.match(/<description>([^<]*)<\/description>/) || [])[1]
          ?.replace(/<!\[CDATA\[|\]\]>/g, "")
          .replace(/\s+/g, " ")
          .trim() || "";
        if (!title || !url || url.includes("bing.com/search?q=")) continue;
        results.push({ title, url, content: description });
      }

      return JSON.stringify(results);
    } catch (e: any) {
      logger.warn(`Bing RSS search failed for "${query}": ${e.message}`);
      return JSON.stringify([]);
    }
  }

  private httpGet(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname: "www.bing.com",
        path,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "*/*",
        },
        timeout: 20000,
      };

      const req = https.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Bing RSS returned HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      });

      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Bing RSS request timed out")));
      req.end();
    });
  }
}
