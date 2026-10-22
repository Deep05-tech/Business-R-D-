import { execFile } from "node:child_process";
import axios from "axios";
import * as cheerio from "cheerio";
import { createLogger } from "./logger.js";

const logger = createLogger("BraveSearchEngine");

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Keyless web search against the public Brave Search HTML endpoint.
 * Fetches via a minimal `curl` request (bare browser headers) because Brave's
 * bot-check flags Node's TLS/HTTP client fingerprint. Used as a fallback when
 * paid search APIs (Tavily) are quota-exhausted or DuckDuckGo blocks requests.
 */
export class BraveSearchEngine {
  private maxResults: number;

  constructor(config: { maxResults?: number } = {}) {
    this.maxResults = config.maxResults || 10;
  }

  async invoke({ query }: { query: string }): Promise<string> {
    try {
      const url = `https://search.brave.com/search?${new URLSearchParams({ q: query, source: "web" })}`;
      const html = await this.fetchHtml(url);

      const $ = cheerio.load(html);
      const results: SearchResult[] = [];

      $(".snippet").each((_, el) => {
        if (results.length >= this.maxResults) return;
        const link = $(el).find('a[href^="http"]').first();
        const urlRaw = (link.attr("href") || "").trim();
        if (!urlRaw || urlRaw.includes("brave.com")) return;

        const title = link.text().trim();
        if (!title) return;

        const content = $(el)
          .find(".snippet-description, .snippet-content")
          .first()
          .text()
          .replace(/\s+/g, " ")
          .trim();

        results.push({ title, url: urlRaw, content });
      });

      return JSON.stringify(results);
    } catch (e: any) {
      logger.warn(`Brave search failed for "${query}": ${e.message}`);
      return JSON.stringify([]);
    }
  }

  private async fetchHtml(url: string): Promise<string> {
    try {
      return await new Promise<string>((resolve, reject) => {
        execFile(
          "curl",
          [
            "-s",
            "--max-time", "15",
            "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            url,
          ],
          { timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
          (error, stdout) => {
            if (error) {
              return reject(error);
            }
            if (!stdout || stdout.length < 200) {
              return reject(new Error("Empty or challenge response from Brave"));
            }
            resolve(stdout);
          }
        );
      });
    } catch (curlErr: any) {
      // If curl is unavailable (ENOENT) or fails, fallback to direct HTTP request
      const res = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 10000
      });
      if (res.data && typeof res.data === "string" && res.data.length >= 200) {
        return res.data;
      }
      throw new Error(`Fallback HTTP request failed: ${curlErr.message}`);
    }
  }
}
