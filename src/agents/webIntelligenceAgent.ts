import { agentRules } from "../config/agentRules.js";
import type { AgentResult, PageSnapshot, SemanticWebData, SourceRef, WebIntelligence } from "../types.js";
import { firstSentence, keywordHits, unique } from "../utils/text.js";

export class WebIntelligenceAgent {
  readonly name = "web-intelligence-agent";
  readonly version = agentRules.version;

  async run(pages: PageSnapshot[], semantic: SemanticWebData): Promise<AgentResult<WebIntelligence>> {
    const homepage = pages[0];

    const data: WebIntelligence = {
      homepage: this.homepageAnalyzer(homepage, semantic),
      offerings: this.productServiceMapper(semantic),
      seo: this.seoMetadata(homepage),
      contact: semantic.contact,
      crawledUrls: pages.map((page) => page.url),
    };

    return {
      agent: this.name,
      version: this.version,
      confidence: semantic.combinedText ? "high" : "low",
      data,
      sources: this.sources(pages, data),
      warnings: pages.every((page) => !page.text) ? ["Website could not be read or returned no text."] : [],
    };
  }

  private homepageAnalyzer(page: PageSnapshot | undefined, semantic: SemanticWebData): WebIntelligence["homepage"] {
    const headlineMessaging = semantic.businessHeadings.slice(0, 8);
    const valueProposition =
      headlineMessaging.find((heading) => /help|grow|build|manage|automate|create|deliver|solution/i.test(heading)) ??
      page?.metaDescription ??
      null;

    return {
      businessSummary: page ? firstSentence(page.metaDescription ?? semantic.combinedText) : null,
      headlineMessaging,
      valueProposition,
    };
  }

  private productServiceMapper(semantic: SemanticWebData): WebIntelligence["offerings"] {
    const candidates = unique([...semantic.businessHeadings, ...semantic.combinedText.split(/[.;]/)]).filter(
      (value) => value.length > 2 && value.length < 120,
    );

    return {
      products: candidates.filter((value) => keywordHits(value, [...agentRules.offerings.productNouns]).length > 0).slice(0, 12),
      services: candidates.filter((value) => keywordHits(value, [...agentRules.offerings.serviceNouns]).length > 0).slice(0, 12),
      categories: candidates
        .filter((value) => /services|products|solutions|industries|features|what we do/i.test(value))
        .slice(0, 12),
    };
  }

  private seoMetadata(page: PageSnapshot | undefined): WebIntelligence["seo"] {
    return {
      metaTitle: page?.title ?? null,
      metaDescription: page?.metaDescription ?? null,
      keywords: page?.metaKeywords ? unique(page.metaKeywords.split(",")).slice(0, 20) : [],
      schemaSignals: page?.schemaTypes ?? [],
    };
  }

  private sources(pages: PageSnapshot[], data: WebIntelligence): SourceRef[] {
    const homepage = pages[0];
    const sources: SourceRef[] = [];
    if (homepage?.title) {
      sources.push({ url: homepage.url, field: "seo.metaTitle", evidence: homepage.title, confidence: "high", inferred: false });
    }
    if (homepage?.metaDescription) {
      sources.push({
        url: homepage.url,
        field: "homepage.businessSummary",
        evidence: homepage.metaDescription,
        confidence: "high",
        inferred: false,
      });
    }
    for (const heading of data.homepage.headlineMessaging.slice(0, 5)) {
      sources.push({ url: homepage?.url ?? "", field: "homepage.headlineMessaging", evidence: heading, confidence: "high", inferred: false });
    }
    return sources;
  }
}
