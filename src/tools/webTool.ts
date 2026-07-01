import * as cheerio from "cheerio";
import { Builder, Browser } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import type { PageSnapshot } from "../types.js";
import { compactText, unique } from "../utils/text.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("Web Crawler");

export interface WebToolOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxPages?: number;
}

/** Priority levels for URL queue — lower number = higher priority */
const enum UrlPriority {
  Homepage = 0,
  AboutAndContact = 1,
  ProductCategory = 2,
  ProductDetail = 3,
  Service = 4,
  Process = 5,
  Sitemap = 6,
  Other = 7,
}

interface QueueEntry {
  url: string;
  priority: UrlPriority;
  depth: number;
}

export class WebTool {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxPages: number;

  constructor(options: WebToolOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxPages = options.maxPages ?? 1000;
  }

  async fetchPage(url: string): Promise<PageSnapshot> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let html = "";
    let status = 0;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": "BusinessRDAgent/2.0 (+https://local.agent)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      status = response.status;
      html = await this.readLimited(response, this.maxBytes);
    } catch {
      // network fetch failed, html remains empty
    } finally {
      clearTimeout(timeout);
    }

    // SPA Heuristic check
    const temp$ = cheerio.load(html);
    const bodyTextLength = compactText(temp$("body").text()).length;
    const hasScripts = temp$("script[src]").length > 0;

    if ((bodyTextLength < 500 && hasScripts) || html.trim() === "") {
      logger.info(`SPA detected at ${url}. Falling back to Headless Browser...`);
      html = await this.fetchWithSelenium(url);
      status = status || 200;
    }

    if (!html) return this.emptySnapshot(url, status);
    return this.snapshot(url, status, html);
  }

  private async fetchWithSelenium(url: string): Promise<string> {
    const options = new chrome.Options();
    options.addArguments("--headless=new");
    options.addArguments("--disable-gpu");
    options.addArguments("--no-sandbox");
    options.addArguments("--disable-dev-shm-usage");
    // Block images/media via preferences for speed
    options.setUserPreferences({
      "profile.managed_default_content_settings.images": 2,
      "profile.managed_default_content_settings.media_stream": 2,
      "profile.managed_default_content_settings.stylesheets": 2
    });

    let driver;
    try {
      driver = await new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(options)
        .build();

      await driver.manage().setTimeouts({ pageLoad: 15_000 });
      await driver.get(url);
      
      const content = await driver.getPageSource();
      return content;
    } catch (err) {
      logger.error(`Failed to load ${url} with Selenium`, err);
      return "";
    } finally {
      if (driver) {
        await driver.quit().catch(() => {});
      }
    }
  }

  async crawlWebsite(rootUrl: string, limit?: number): Promise<PageSnapshot[]> {
    const root = new URL(rootUrl);
    const visited = new Set<string>();
    const snapshots: PageSnapshot[] = [];
    const max = limit ?? this.maxPages;

    // --- Seed queue with sitemap URLs (high priority) ---
    const queue: QueueEntry[] = [];
    const sitemapUrls = await this.fetchSitemapUrls(root);

    // Always start with the homepage
    queue.push({ url: root.toString(), priority: UrlPriority.Homepage, depth: 0 });

    // Add sitemap URLs (filtered to same domain, deduplicated)
    for (const sitemapUrl of sitemapUrls) {
      const normalized = this.normalizeInternalLink(sitemapUrl, root);
      if (normalized && normalized !== root.toString()) {
        queue.push({ url: normalized, priority: this.urlPriority(normalized), depth: this.urlDepth(normalized) });
      }
    }

    // Sort by priority (stable)
    this.sortQueue(queue);

    await new Promise<void>((resolve) => {
      let active = 0;
      const pump = () => {
        if (active === 0 && queue.length === 0) return resolve();
        if (snapshots.length >= max && active === 0) return resolve();
        
        while (active < 3 && queue.length > 0 && snapshots.length + active < max) {
          const entry = queue.shift()!;
          if (visited.has(entry.url)) continue;
          visited.add(entry.url);
          
          active++;
          (async () => {
            // Delay jitter (500ms - 1500ms) to evade WAFs
            await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
            
            logger.info(`[Crawler] Fetching (Priority ${entry.priority}, Depth ${entry.depth}): ${entry.url}`);
            
            const snapshot = await this.fetchPage(entry.url);
            snapshots.push(snapshot);
            
            for (const link of snapshot.links) {
              const normalized = this.normalizeInternalLink(link.href, root);
              if (normalized && !visited.has(normalized) && !queue.some((q) => q.url === normalized)) {
                queue.push({ url: normalized, priority: this.urlPriority(normalized), depth: this.urlDepth(normalized) });
              }
            }
            this.sortQueue(queue);
          })().finally(() => {
            active--;
            pump();
          });
        }
      };
      pump();
    });

    return snapshots;
  }

  // ---------------------------------------------------------------------------
  // Sitemap fetching
  // ---------------------------------------------------------------------------

  private async fetchSitemapUrls(root: URL): Promise<string[]> {
    const candidates = [
      `${root.origin}/sitemap.xml`,
      `${root.origin}/sitemap_index.xml`,
      `${root.origin}/sitemap/`,
    ];

    const urls: string[] = [];

    for (const sitemapUrl of candidates) {
      try {
        const result = await this.fetchSitemap(sitemapUrl);
        if (result.length > 0) {
          urls.push(...result);
          break; // found one — stop
        }
      } catch {
        // try next candidate
      }
    }

    return unique(urls).slice(0, this.maxPages * 2);
  }

  private async fetchSitemap(sitemapUrl: string): Promise<string[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const response = await fetch(sitemapUrl, {
        signal: controller.signal,
        headers: { "user-agent": "BusinessRDAgent/2.0 (+https://local.agent)" },
      });

      if (!response.ok) return [];

      const text = await response.text();
      const urls: string[] = [];

      // Parse <loc> tags (both sitemap and sitemap index)
      const locPattern = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
      let match: RegExpExecArray | null;
      while ((match = locPattern.exec(text)) !== null) {
        const loc = match[1]?.trim();
        if (!loc) continue;
        // If it's a nested sitemap, recurse (one level only)
        if (loc.endsWith(".xml")) {
          try {
            const nested = await this.fetchSitemap(loc);
            urls.push(...nested);
          } catch {
            // ignore nested failures
          }
        } else {
          urls.push(loc);
        }
      }

      return urls;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------------------------------------------------------
  // HTML parsing
  // ---------------------------------------------------------------------------

  private async readLimited(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return response.text();

    const chunks: Uint8Array[] = [];
    let total = 0;

    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }

    return new TextDecoder().decode(Buffer.concat(chunks, Math.min(total, maxBytes)));
  }

  private snapshot(url: string, status: number, html: string): PageSnapshot {
    const $ = cheerio.load(html);

    // Extract raw JSON-LD blocks BEFORE removing scripts
    const jsonLdBlocks: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).text().trim();
      if (raw) jsonLdBlocks.push(raw);
    });

    $("script,style,noscript,svg").remove();

    const title = compactText($("title").first().text()) || null;
    const logoText =
      compactText(
        $('[aria-label*="logo" i], [class*="logo" i], [id*="logo" i]')
          .first()
          .text() ||
          $('img[alt*="logo" i]').first().attr("alt") ||
          "",
      ) || null;
    const metaDescription = this.meta($, "description");
    const metaKeywords = this.meta($, "keywords");
    const headings = unique($("h1,h2,h3").map((_, el) => $(el).text()).get()).slice(0, 30);
    const navigationText = unique($("nav,header,[role='navigation']").map((_, el) => $(el).text()).get()).slice(0, 40);
    const footerText = unique($("footer").map((_, el) => $(el).text()).get()).slice(0, 20);
    const contentText = compactText(
      $("main,article,section")
        .map((_, el) => $(el).text())
        .get()
        .join(" ") || $("body").text(),
    ).slice(0, 40_000);
    const text = compactText($("body").text()).slice(0, 40_000);
    const links = unique(
      $("a[href]")
        .map((_, el) => {
          const href = String($(el).attr("href") ?? "");
          const label = compactText($(el).text()).slice(0, 120);
          return `${href}|||${label}`;
        })
        .get(),
    )
      .map((entry) => {
        const [href = "", label = ""] = entry.split("|||");
        return { href, text: label };
      })
      .filter((link) => link.href);

    return {
      url,
      status,
      title,
      logoText,
      metaDescription,
      metaKeywords,
      headings,
      links,
      contentText,
      navigationText,
      footerText,
      text,
      emails: unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
      phones: unique(text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) ?? []).slice(0, 10),
      schemaTypes: this.schemaTypes($, jsonLdBlocks),
      pageType: this.inferPageType(url, headings, title),
      jsonLdBlocks,
    };
  }

  private emptySnapshot(url: string, status: number): PageSnapshot {
    return {
      url,
      status,
      title: null,
      logoText: null,
      metaDescription: null,
      metaKeywords: null,
      headings: [],
      links: [],
      contentText: "",
      navigationText: [],
      footerText: [],
      text: "",
      emails: [],
      phones: [],
      schemaTypes: [],
      pageType: "other",
      jsonLdBlocks: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private meta($: cheerio.CheerioAPI, name: string): string | null {
    const value =
      $(`meta[name="${name}"]`).attr("content") ??
      $(`meta[property="og:${name}"]`).attr("content") ??
      null;
    return value ? compactText(value) : null;
  }

  private schemaTypes($: cheerio.CheerioAPI, jsonLdBlocks: string[]): string[] {
    const types: string[] = [];
    for (const raw of jsonLdBlocks) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        this.collectSchemaTypes(parsed, types);
      } catch {
        if (raw.includes("@type")) types.push("Unparsed JSON-LD");
      }
    }
    $("[itemscope][itemtype]").each((_, el) => {
      const itemType = $( el).attr("itemtype");
      if (itemType) types.push(itemType.split("/").pop() ?? itemType);
    });
    return unique(types).slice(0, 20);
  }

  private collectSchemaTypes(value: unknown, output: string[]): void {
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectSchemaTypes(item, output));
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const type = record["@type"];
    if (typeof type === "string") output.push(type);
    if (Array.isArray(type)) output.push(...type.filter((item): item is string => typeof item === "string"));
    Object.values(record).forEach((item) => this.collectSchemaTypes(item, output));
  }

  private inferPageType(url: string, headings: string[], title: string | null): string {
    const path = new URL(url).pathname.toLowerCase();
    const titleLower = (title ?? "").toLowerCase();
    const h1 = (headings[0] ?? "").toLowerCase();

    const depth = this.urlDepth(url);

    if (path === "/" || path === "" || path === "/index" || path === "/home") return "homepage";
    if (/\/about|\/company|\/who-we-are|\/our-story/.test(path)) return "about";
    if (/\/contact|\/reach-us|\/get-in-touch/.test(path)) return "contact";
    
    if (/\/category|\/categories|\/all-products|\/collections/.test(path) || (/\/product|\/products|\/catalogue|\/catalog/.test(path) && depth <= 1)) {
      return "product_category";
    }
    if (/\/product|\/products|\/catalogue|\/catalog|\/equipment|\/item/.test(path) || depth >= 2) {
      return "product_detail";
    }
    if (/\/service|\/services|\/solutions|\/offering/.test(path)) return "service";
    if (/\/contact|\/reach-us|\/get-in-touch/.test(path)) return "contact";
    if (/\/blog|\/news|\/insights|\/press|\/articles/.test(path)) return "blog";
    if (/\/pricing|\/plans|\/packages/.test(path)) return "pricing";
    if (/\/career|\/jobs|\/hiring/.test(path)) return "careers";

    // Fallback: infer from heading / title text
    if (/about|company|who we are/i.test(h1 + titleLower)) return "about";
    if (/product|machine|equipment|device/i.test(h1 + titleLower)) return "product_detail";
    if (/service|solution|consulting/i.test(h1 + titleLower)) return "service";
    if (/contact|reach|location/i.test(h1 + titleLower)) return "contact";

    return "other";
  }

  private urlDepth(url: string): number {
    try {
      return new URL(url).pathname.split("/").filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  private urlPriority(url: string): UrlPriority {
    const path = new URL(url).pathname.toLowerCase();
    const depth = this.urlDepth(url);
    
    // Homepage
    if (path === "/" || path === "" || path === "/home") return UrlPriority.Homepage;
    
    // About and Contact (Context pages)
    if (/\/about|\/company|\/who-we-are|\/history|\/contact|\/reach-us/.test(path)) return UrlPriority.AboutAndContact;
    
    // Process / Workflow
    if (/\/process|\/workflow|\/manufacturing|\/facility|\/technology/.test(path)) return UrlPriority.Process;
    
    // Products (Categorized by depth to enforce Hierarchy)
    // Depth 1: usually categories (e.g., /valves)
    // Depth > 1: usually subproducts/details (e.g., /valves/ball-valve)
    if (/\/category|\/categories|\/all-products|\/collections/.test(path) || (/\/product|\/catalogue|\/catalog/.test(path) && depth <= 1)) {
        return UrlPriority.ProductCategory;
    }
    
    if (/\/product-variant|\/model|\/parts/.test(path) || (/\/product|\/catalogue|\/catalog|\/equipment|\/item/.test(path) && depth > 1) || depth >= 2) {
        return UrlPriority.ProductDetail;
    }
    
    // Services
    if (/\/service|\/solution|\/offering/.test(path)) return UrlPriority.Service;
    
    return UrlPriority.Other;
  }

  private sortQueue(queue: QueueEntry[]): void {
    queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.depth - b.depth; // Tie breaker: shallower depths first
    });
  }

  private normalizeInternalLink(href: string, root: URL): string | null {
    try {
      const url = new URL(href, root);
      if (url.hostname !== root.hostname) return null;
      url.hash = "";
      if (!["http:", "https:"].includes(url.protocol)) return null;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|zip|mp4|mp3|svg|css|js|woff|woff2)$/i.test(url.pathname)) return null;
      return url.toString();
    } catch {
      return null;
    }
  }
}
