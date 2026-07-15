import { createLogger } from "../utils/logger.js";
import axios from "axios";
import * as cheerio from "cheerio";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";
import type { StructuredMemory, CompetitorProfile } from "../types.js";

import { CompetitorQueryAgent } from "./competitorQueryAgent.js";
import { CompetitorSynthesisAgent } from "./competitorSynthesisAgent.js";
import { CompetitorEnrichmentAgent } from "./competitorEnrichmentAgent.js";
import { CompetitorQCAgent } from "./competitorQCAgent.js";

const logger = createLogger("CompetitorOrchestrator");

export class CompetitorAgent {
  readonly name = "competitor-orchestrator-agent";
  readonly version = "4.0.0";

  private queryAgent = new CompetitorQueryAgent();
  private synthesisAgent = new CompetitorSynthesisAgent();
  private enrichmentAgent = new CompetitorEnrichmentAgent();
  private qcAgent = new CompetitorQCAgent();

  async run(memory: StructuredMemory, scope: "local" | "regional" | "global" | "all" = "regional"): Promise<CompetitorProfile[]> {
    logger.info(`Running true competitor research for ${memory.input.websiteUrl} with scope: ${scope}...`);

    let coreProductsDetailed = "";
    if (scope === "all") {
      logger.info(`Scope is 'all'. Bypassing stored database memory and scraping target website (${memory.input.websiteUrl}) fresh...`);
      try {
        const res = await axios.get(memory.input.websiteUrl, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
        const $ = cheerio.load(res.data);
        const rawText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 8000);
        coreProductsDetailed = `[LIVE FRESH WEBSITE SCRAPE DATA FOR TARGET BUSINESS]:\n${rawText}\n\n(INSTRUCTION: Analyze this fresh text to identify their core products, and then generate search queries for competitors based on those products.)`;
      } catch (err: any) {
        logger.warn(`Failed to scrape target website live (${err.message}). Falling back to database memory.`);
      }
    }
    
    if (!coreProductsDetailed || coreProductsDetailed.length < 50) {
      coreProductsDetailed = memory.offerings?.products.slice(0, 4).map(p => {
        const specs = Object.entries(p.technicalSpecs || {}).map(([k, v]) => `${k}: ${v}`).join("; ");
        return `- **${p.name}**: ${p.description}\n  *Specs/Capacity:* ${specs || "Not explicitly specified"}`;
      }).join("\n") || "Industrial products";
    }

    // Phase 1: Query Generation
    const queries = await this.queryAgent.generateQueries(memory, scope, coreProductsDetailed);

    // Phase 2: Web Searching
    let tavilyContext = "";
    const searchTool = new FreeSearchEngine({ maxResults: 12 });
    logger.info(`Executing Phase 2: Running ${queries.length} distinct search queries...`);
    
    for (const query of queries) {
      try {
        logger.debug(`Searching: "${query}"`);
        const searchRes = await searchTool.invoke({ query });
        tavilyContext += `RESULTS FOR QUERY "${query}":\n${searchRes}\n\n`;
      } catch (e: any) {
        logger.warn(`Search failed for query "${query}": ${e.message}`);
      }
    }
    if (tavilyContext.length > 30000) {
      tavilyContext = tavilyContext.substring(0, 30000) + "\n...[TRUNCATED]";
    }

    // Phase 3: Synthesis
    const baseCompetitors = await this.synthesisAgent.synthesizeCompetitors(memory, tavilyContext, scope);

    // Phase 4: Enrichment & Deep Scraping
    const finalCompetitors: CompetitorProfile[] = [];
    logger.info(`Phase 4: Scraping deep product links and socials for ${baseCompetitors.length} synthesized competitors...`);
    
    for (const comp of baseCompetitors) {
      const enrichedComp = await this.enrichmentAgent.enrichCompetitor(comp);
      if (enrichedComp) {
        finalCompetitors.push(enrichedComp);
      } else {
        logger.info(`Discarding ${comp.name} (failed to enrich)`);
      }
    }

    // Phase 5: QC & Ranking
    logger.info(`Phase 5: Running strict LLM QC on extracted competitors and links...`);
    const qcCompetitors = await this.qcAgent.qcCompetitorLinks(
      finalCompetitors, 
      memory.industryClassification?.industry || "target industry", 
      coreProductsDetailed
    );

    return qcCompetitors;
  }

  // Backward compatibility for manual competitor addition in server.ts
  async scrapeCompetitorSocials(comp: any): Promise<CompetitorProfile | null> {
    return this.enrichmentAgent.enrichCompetitor(comp);
  }
}
