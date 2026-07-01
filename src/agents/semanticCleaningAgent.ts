import { agentRules } from "../config/agentRules.js";
import type { AgentResult, PageSnapshot, SemanticWebData, SourceRef } from "../types.js";
import { HeuristicsDb } from "../utils/heuristicsDb.js";
import { compactText, unique } from "../utils/text.js";

export class SemanticCleaningAgent {
  readonly name = "semantic-cleaning-agent";
  readonly version = agentRules.version;

  async run(pages: PageSnapshot[]): Promise<AgentResult<SemanticWebData>> {
    const persistentNoise = await HeuristicsDb.getBlacklist();
    const cleanedPages = pages.map((page) => this.cleanPage(page, persistentNoise));
    const data: SemanticWebData = {
      pages: cleanedPages,
      combinedText: compactText(cleanedPages.map((page) => page.cleanText).join(" ")).slice(0, 60_000),
      businessHeadings: unique(cleanedPages.flatMap((page) => page.cleanHeadings)).slice(0, 40),
      metadata: {
        titles: unique(pages.flatMap((page) => [page.logoText ?? "", page.title ?? ""])),
        descriptions: unique(pages.map((page) => page.metaDescription ?? "")),
        keywords: unique(pages.flatMap((page) => (page.metaKeywords ? page.metaKeywords.split(",") : []))),
        schemaTypes: unique(pages.flatMap((page) => page.schemaTypes)),
      },
      contact: {
        locations: this.extractLocations(pages),
        emails: unique(pages.flatMap((page) => page.emails)),
        phones: unique(pages.flatMap((page) => page.phones)),
        legitimacySignals: this.extractLegitimacySignals(pages),
      },
    };

    return {
      agent: this.name,
      version: this.version,
      confidence: data.combinedText ? "high" : "low",
      data,
      sources: this.sources(data),
      warnings: data.combinedText ? [] : ["No clean semantic website text survived cleaning."],
    };
  }

  private cleanPage(page: PageSnapshot, persistentNoise: string[] = []): SemanticWebData["pages"][number] {
    const noiseSet = new Set(
      [...page.navigationText, ...page.footerText, ...page.links.map((link) => link.text), ...agentRules.cleaning.noisyLabels, ...persistentNoise]
        .map((value) => compactText(value).toLowerCase())
        .filter(Boolean),
    );
    const lineCounts = new Map<string, number>();
    const removedNoise: string[] = [];
    const lines = page.contentText
      .split(/(?<=[.!?])\s+|\n+/)
      .map(compactText)
      .filter(Boolean);
    const cleanLines = lines.filter((line) => {
      const lowerLine = line.toLowerCase();
      const nextCount = (lineCounts.get(lowerLine) ?? 0) + 1;
      lineCounts.set(lowerLine, nextCount);

      const isNoise =
        line.length < agentRules.cleaning.minBusinessLineLength ||
        noiseSet.has(lowerLine) ||
        [...noiseSet].some((noise) => noise.length > 12 && lowerLine === noise) ||
        nextCount > agentRules.cleaning.maxRepeatedLineCount;

      if (isNoise) removedNoise.push(line);
      return !isNoise;
    });

    return {
      url: page.url,
      title: page.title,
      cleanText: compactText(cleanLines.join(" ")).slice(0, 30_000),
      cleanHeadings: page.headings.filter((heading) => this.isBusinessHeading(heading, noiseSet)),
      removedNoise: unique(removedNoise).slice(0, 40),
    };
  }

  private isBusinessHeading(heading: string, noiseSet: Set<string>): boolean {
    const value = compactText(heading);
    if (value.length < 3) return false;
    if (noiseSet.has(value.toLowerCase())) return false;
    return !agentRules.cleaning.noisyLabels.some((label) => label.toLowerCase() === value.toLowerCase());
  }

  private extractLocations(pages: PageSnapshot[]): string[] {
    const text = pages.map((page) => page.text).join(" ");
    return unique(agentRules.locations.filter((location) => new RegExp(`\\b${location}\\b`, "i").test(text)));
  }

  private extractLegitimacySignals(pages: PageSnapshot[]): string[] {
    return unique([
      ...pages.flatMap((page) => page.schemaTypes.filter((type) => /Organization|LocalBusiness|Corporation/i.test(type))),
      ...pages.flatMap((page) => page.links.map((link) => link.text).filter((text) => /about|contact|privacy|terms/i.test(text))),
    ]).slice(0, 12);
  }

  private sources(data: SemanticWebData): SourceRef[] {
    return data.pages
      .filter((page) => page.cleanText)
      .slice(0, 5)
      .map((page) => ({
        url: page.url,
        field: "semantic.cleanText",
        evidence: page.cleanText.slice(0, 220),
        confidence: "high",
        inferred: false,
      }));
  }
}
