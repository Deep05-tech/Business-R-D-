import { agentRules } from "../config/agentRules.js";
import { WebTool } from "../tools/webTool.js";
import type { AgentResult, PageSnapshot } from "../types.js";

export class WebScraperAgent {
  readonly name = "web-scraper-agent";
  readonly version = agentRules.version;

  constructor(private readonly webTool: WebTool) {}

  async run(websiteUrl: string, limit?: number): Promise<AgentResult<PageSnapshot[]>> {
    const pages = await this.webTool.crawlWebsite(websiteUrl, limit);

    return {
      agent: this.name,
      version: this.version,
      confidence: pages.some((page) => page.contentText) ? "high" : "low",
      data: pages,
      sources: pages
        .slice(0, 8)
        .map((page) => ({
          url: page.url,
          field: "webScraper.page",
          evidence: page.title ?? page.metaDescription ?? page.contentText.slice(0, 160),
          confidence: page.contentText ? ("high" as const) : ("low" as const),
          inferred: false,
        }))
        .filter((source) => source.evidence),
      warnings: pages.every((page) => !page.contentText) ? ["Website could not be read or returned no content text."] : [],
    };
  }
}
