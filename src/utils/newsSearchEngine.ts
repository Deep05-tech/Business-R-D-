import axios from "axios";
import * as cheerio from "cheerio";
import { createLogger } from "./logger.js";

const logger = createLogger("NewsSearchEngine");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface NewsHit {
  title: string;
  url: string;
  content: string;
  published_date?: string | null;
}

/**
 * Keyless news search engine that aggregates Google News RSS and Bing News RSS.
 * No API keys required — used as a reliable fallback when Tavily quota is exhausted.
 */
export class NewsSearchEngine {
  private maxResults: number;
  private timeoutMs: number;
  private lastRequestAt = 0;
  private readonly minIntervalMs = 1200;

  constructor(config: { maxResults?: number; timeoutMs?: number } = {}) {
    this.maxResults = config.maxResults || 8;
    this.timeoutMs = config.timeoutMs || 20000;
  }

  async search(query: string): Promise<NewsHit[]> {
    const [google, bing] = await Promise.allSettled([
      this.googleNews(query),
      this.bingNews(query),
    ]);

    const hits: NewsHit[] = [];
    if (google.status === "fulfilled") hits.push(...google.value);
    if (bing.status === "fulfilled") hits.push(...bing.value);

    logger.info(`News search "${query}" returned ${hits.length} hits (google=${google.status}, bing=${bing.status}).`);
    return hits.slice(0, this.maxResults * 2);
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();
  }

  private async googleNews(query: string): Promise<NewsHit[]> {
    await this.throttle();
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const { data } = await axios.get(url, {
      timeout: this.timeoutMs,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
    return this.parseRss(data);
  }

  private async bingNews(query: string): Promise<NewsHit[]> {
    await this.throttle();
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
    const { data } = await axios.get(url, {
      timeout: this.timeoutMs,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
    return this.parseRss(data);
  }

  private parseRss(xml: string): NewsHit[] {
    const $ = cheerio.load(xml, { xmlMode: true });
    const hits: NewsHit[] = [];

    $("item").each((_, el) => {
      if (hits.length >= this.maxResults) return;

      let title = $(el).find("title").first().text().trim();
      let url = $(el).find("link").first().text().trim();
      let description = $(el).find("description").first().text().trim();
      const published =
        $(el).find("pubDate").first().text().trim() ||
        $(el).find("publishedDate").first().text().trim() ||
        $(el).find("dc\\:date").first().text().trim();

      if (url.includes("bing.com/news/apiclick") && url.includes("url=")) {
        try {
          const real = decodeURIComponent(url.split("url=")[1].split("&")[0]);
          if (real.startsWith("http")) url = real;
        } catch {
          // keep the bing redirect link as-is
        }
      }

      // Strip any leftover HTML from the description
      description = cheerio.load(description).text().trim() || description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      if (title && url) {
        hits.push({ title, url, content: description || title, published_date: published || null });
      }
    });

    return hits;
  }
}
