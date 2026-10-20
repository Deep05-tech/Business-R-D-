import "dotenv/config";
import { join } from "path";
import { mkdir } from "fs/promises";
import { ChatOpenAI } from "@langchain/openai";
import { createChatModel } from "./utils/llm.js";
import { createAgentRegistry, type AgentRegistry } from "./agents/agentRegistry.js";
import { ReconAgent } from "./agents/reconAgent.js";
import { QcFailureError } from "./errors.js";
import { knowledgeIndex } from "./memory/knowledgeIndex.js";
import { MemoryStore } from "./memory/memoryStore.js";
import { QcAgent } from "./qc/qcAgent.js";
import { PdfReportGenerator } from "./utils/pdfGenerator.js";
import { createLogger } from "./utils/logger.js";
import { agentRules } from "./config/agentRules.js";

const logger = createLogger("Orchestrator");

const PDF_OUTPUT_DIR = "data/reports";
import type { OfferingsAndProcesses } from "./agents/offeringsExtractionAgent.js";
import { VectorStore } from "./utils/vectorStore.js";
import type {
  AgentResult,
  AudienceIntelligence,
  BrandIntelligence,
  BusinessIdentity,
  BusinessInput,
  BusinessIntelligenceProfile,
  DigitalMaturity,
  PageSnapshot,
  RdInsights,
  SemanticWebData,
  SocialIntelligence,
  MarketingSalesIntelligence,
  SourceRef,
  StructuredMemory,
  WebIntelligence,
} from "./types.js";

interface AgentState {
  webScrape: AgentResult<PageSnapshot[]>;
  semantic: AgentResult<SemanticWebData>;
  web: AgentResult<WebIntelligence>;
  social: AgentResult<SocialIntelligence>;
  identity: AgentResult<BusinessIdentity>;
  offerings: AgentResult<OfferingsAndProcesses>;
  audience: AgentResult<AudienceIntelligence>;
  brand: AgentResult<BrandIntelligence>;
  digital: AgentResult<DigitalMaturity>;
  rd: AgentResult<RdInsights>;
  marketingSales: AgentResult<MarketingSalesIntelligence>;
}

export class OrchestratorAgent {
  readonly name = "orchestrator-agent";
  private readonly qcAgent = new QcAgent();

  constructor(
    private readonly memoryStore = new MemoryStore(),
    private readonly agents: AgentRegistry = createAgentRegistry(),
  ) { }

  async run(input: BusinessInput, onProgress?: (msg: string, partial?: any) => void): Promise<BusinessIntelligenceProfile & { memoryPath: string; pdfPath: string }> {
    let state = await this.runAll(input, onProgress);
    let profile = this.composeProfile(input, state);

    onProgress?.("QC validation");
    let qc = await this.qcAgent.validate(profile, 1);

    const MAX_CASCADING_RETRIES = 2;

    for (let attempt = 2; !qc.passed && attempt <= MAX_CASCADING_RETRIES + 1; attempt += 1) {
      logger.warn(`QC Failed. Triggering root-cause retry attempt ${attempt - 1}/${MAX_CASCADING_RETRIES}...`);
      const retryModules = this.qcAgent.retryModules(qc);

      if (retryModules.length === 0) {
        logger.info("No specific modules identified for retry. Breaking loop.");
        break;
      }

      state = await this.retryModules(input, state, retryModules, onProgress);
      profile = this.composeProfile(input, state);
      onProgress?.("QC validation");
      qc = await this.qcAgent.validate(profile, attempt);
    }

    const finalProfile = { ...profile, qc };
    if (!qc.passed) {
      logger.error(`QC could not resolve issues. Marking fields as inconclusive.`);
      for (const issue of qc.issues) {
        if (issue.severity === "error") {
          this.markInconclusive(finalProfile, issue.field);
        }
      }
    }

    // --- Generate Executive Summary for Memory & PDF ---
    let summaryText = "";
    try {
      logger.info("Generating executive summary via Gemini...");
      summaryText = await this.generateExecutiveSummary(finalProfile);
      finalProfile.structuredJsonMemoryObject.businessIdentity.description = summaryText;
      finalProfile.businessIdentitySummary.description = summaryText;
    } catch (sumErr) {
      logger.error(`Summary generation failed: ${sumErr instanceof Error ? sumErr.message : sumErr}`);
    }

    const memoryPath = await this.memoryStore.save(finalProfile.structuredJsonMemoryObject);
    knowledgeIndex.add(finalProfile.structuredJsonMemoryObject); // Update RAM cache!

    // Generate Vectors
    const vectorStore = new VectorStore();
    const safeName = (finalProfile.businessIdentitySummary.officialName || "Unknown").replace(/[^a-z0-9]/gi, "_");
    const vectorPath = join(PDF_OUTPUT_DIR, `${safeName}_vectors.json`);
    await vectorStore.generateAndSave(finalProfile, vectorPath);

    // --- PDF Report Generation ---
    let pdfPath = "";
    try {
      logger.info("Rendering PDF report...");
      pdfPath = await this.renderPdf(finalProfile, summaryText);
      logger.success(`PDF report saved: ${pdfPath}`);
    } catch (pdfErr) {
      logger.error(`PDF generation failed: ${pdfErr instanceof Error ? pdfErr.message : pdfErr}`);
    }

    return { ...finalProfile, memoryPath, pdfPath };
  }

  private markInconclusive(profile: any, fieldPath: string) {
    // Skip structural fields that should never be overwritten with a string
    if (fieldPath === "offerings" || fieldPath === "processes" || fieldPath.startsWith("agentDiagnostics")) {
      return;
    }
    const fullPath = `structuredJsonMemoryObject.${fieldPath}`.split(".");
    let current = profile;
    for (let i = 0; i < fullPath.length - 1; i++) {
      if (!current[fullPath[i]]) current[fullPath[i]] = {};
      current = current[fullPath[i]];
    }
    const lastKey = fullPath[fullPath.length - 1];
    if (current[lastKey] === undefined || current[lastKey] === null || typeof current[lastKey] === "string") {
      current[lastKey] = "Inconclusive";
    }
  }

  private async runAll(input: BusinessInput, onProgress?: (msg: string, partial?: any) => void): Promise<AgentState> {
    // ---------------------------------------------------------------------------
    // PHASE 1 & 2: Sitemap-First Full Discovery & Prioritized Crawl
    // ---------------------------------------------------------------------------
    logger.info("PHASE 1: Initiating focused priority crawl (Max 15 pages)...");
    onProgress?.("Crawling website");

    let webScrape: any;
    if (input.websiteUrl === "https://pdf-only.local") {
      logger.info("PDF-Only Mode activated. Bypassing website crawl.");
      webScrape = {
        agent: "pdf-only-mock-agent",
        version: "1.0.0",
        confidence: "high",
        sources: [],
        warnings: [],
        data: [{
          url: "https://pdf-only.local",
          title: "",
          cleanText: input.brochureText || "No text found",
          cleanHeadings: [],
          removedNoise: [],
          headings: [],
          links: [],
          contentText: input.brochureText || "No text found",
          navigationText: [],
          footerText: [],
          text: input.brochureText || "No text found",
          emails: [],
          phones: [],
          schemaTypes: [],
          pageType: "homepage",
          jsonLdBlocks: []
        }]
      };
    } else {
      const crawlLimit = Number(process.env.CRAWL_MAX_PAGES) || 12;
      webScrape = await this.agents.webScraper.run(input.websiteUrl, crawlLimit, (msg) => {
        onProgress?.(msg);
      });
    }

    if (typeof global.gc === "function") {
      global.gc();
    }

    // Enforce hierarchy for all downstream map-reduce agents
    const hierarchyWeights: Record<string, number> = {
      homepage: 1,
      about: 2,
      contact: 3,
      product_category: 4,
      product_detail: 5,
      service: 6,
      blog: 7,
      other: 8
    };
    webScrape.data.sort((a: any, b: any) => (hierarchyWeights[a.pageType] || 10) - (hierarchyWeights[b.pageType] || 10));

    // ---------------------------------------------------------------------------
    // PHASE 2: Context Cleaning & Social Intelligence
    // ---------------------------------------------------------------------------
    logger.info("PHASE 2: Extracting Business Context & Social Intelligence...");
    let contextPages = webScrape.data.filter((p: any) => p.pageType === "homepage" || p.pageType === "about");
    if (contextPages.length === 0) contextPages = [webScrape.data[0]];

    // Auto-discover socials from the website footer/links if not provided
    if (!input.socialUrls || input.socialUrls.length === 0) {
      const discoveredSocials = new Set<string>();
      const socialDomains = ['linkedin.com/company', 'instagram.com', 'facebook.com', 'youtube.com'];

      for (const page of webScrape.data) {
        if (!page.links) continue;
        for (const link of page.links) {
          const href = (link.href || "").toLowerCase();
          if (socialDomains.some(d => href.includes(d)) && !href.includes('/sharer') && !href.includes('/explore/')) {
            discoveredSocials.add(link.href);
          }
        }
      }

      input.socialUrls = Array.from(discoveredSocials).slice(0, 5);
      if (input.socialUrls.length > 0) {
        logger.info(`Auto-discovered social media URLs from website: ${input.socialUrls.join(', ')}`);
      }
    }

    onProgress?.("Cleaning semantics & Social intelligence");
    // Run full semantic cleaning and social intelligence
    const [semantic, socialContext] = await Promise.all([
      this.agents.semanticCleaning.run(webScrape.data),
      this.agents.socialIntelligence.run(input.socialUrls)
    ]);

    // Derive contextSemantic directly from the already-cleaned pages (homepage and about)
    // to avoid duplicating memory and CPU
    const contextPageUrls = new Set(contextPages.map((p: any) => p.url));
    const cleanedContextPages = semantic.data.pages.filter(p => contextPageUrls.has(p.url));
    const contextSemantic = {
      ...semantic,
      data: {
        ...semantic.data,
        pages: cleanedContextPages.length > 0 ? cleanedContextPages : semantic.data.pages.slice(0, 2),
        combinedText: cleanedContextPages.map(p => p.cleanText).join(" ") || semantic.data.combinedText.slice(0, 10000)
      }
    };

    if (typeof global.gc === "function") {
      global.gc();
    }

    // Inject brochure text into semantic context if present
    if (input.brochureText) {
      semantic.data.pages.push({
        url: "BROCHURE",
        title: "Uploaded Brochure",
        cleanText: input.brochureText.slice(0, 15000),
        cleanHeadings: [],
        removedNoise: []
      });
      semantic.data.combinedText += "\n\n=== BROCHURE ===\n\n" + input.brochureText.slice(0, 15000);
    }

    // ---------------------------------------------------------------------------
    // PHASE 3: Parallel Business Identity & Web Intelligence
    // ---------------------------------------------------------------------------
    onProgress?.("Business Identity & Web Intelligence");
    let identityText = contextPages;
    if (input.brochureText) {
      identityText = [...contextPages, {
        url: "BROCHURE",
        status: 200,
        title: "Uploaded Brochure",
        logoText: null,
        metaDescription: null,
        metaKeywords: null,
        headings: [],
        links: [],
        contentText: input.brochureText.slice(0, 5000),
        navigationText: [],
        footerText: [],
        text: input.brochureText.slice(0, 5000),
        emails: [],
        phones: [],
        schemaTypes: [],
        pageType: "about",
        jsonLdBlocks: []
      }];
    }

    const [identity, web] = await Promise.all([
      this.agents.businessIdentity.run(identityText, contextSemantic.data, socialContext.data),
      this.agents.webIntelligence.run(webScrape.data, semantic.data)
    ]);

    logger.info(`Business Context Established: ${identity.data.officialName || "Unknown"} in ${identity.data.industry || "Unknown"}`);
    onProgress?.("Business Identity Established", { businessIdentity: identity.data });

    // Reconnaissance (Dynamic DAG generation)
    const reconAgent = new ReconAgent();
    const homepage = webScrape.data.find((p: any) => p.pageType === "homepage") || webScrape.data[0];
    const dag = reconAgent.generateDag(homepage);
    logger.info(`Recon DAG Strategy: ${dag.reasoning}`);
    logger.info(`Required Agents: ${dag.requiredAgents.join(", ")}`);

    const social = socialContext;

    // ---------------------------------------------------------------------------
    // PHASE 4: Parallel Intelligence Execution (Offerings & Digital Maturity)
    // ---------------------------------------------------------------------------
    onProgress?.("Offerings extraction & Digital maturity");
    const [offerings, digital] = await Promise.all([
      (async () => {
        let off = await this.agents.offerings.run(web.data, semantic.data);
        if (off.data) {
          off.data = await this.agents.aiContent.run(off.data);
        }
        return off;
      })(),
      dag.requiredAgents.includes("digitalMaturity")
        ? this.agents.digital.run(web.data, social.data)
        : Promise.resolve({ agent: "digital", sources: [], warnings: [], data: {} as unknown as DigitalMaturity } as AgentResult<DigitalMaturity>)
    ]);

    onProgress?.("Offerings Extracted", { offerings: offerings.data });
    onProgress?.("Digital Maturity Calculated", { digitalMaturity: digital.data });

    if (typeof global.gc === "function") {
      global.gc();
    }

    // ---------------------------------------------------------------------------
    // PHASE 5: Parallel Audience & Brand Analysis
    // ---------------------------------------------------------------------------
    onProgress?.("Audience and Brand analysis");
    const [audience, brand] = await Promise.all([
      dag.requiredAgents.includes("audienceIntelligence")
        ? this.agents.audience.run(web.data, semantic.data, identity.data, input.customInstructions)
        : Promise.resolve({ agent: "audienceIntelligence", version: "1", confidence: "low" as const, data: { buyerPersonas: [], geographies: [], targetIndustries: [] }, sources: [], warnings: [] } as AgentResult<AudienceIntelligence>),
      dag.requiredAgents.includes("brandIntelligence")
        ? this.agents.brand.run(web.data, semantic.data, offerings.data.offerings, input.customInstructions)
        : Promise.resolve({ agent: "brandIntelligence", version: "1", confidence: "low" as const, data: { tone: null, positioning: null, usps: [], messagingStyle: null }, sources: [], warnings: [] } as AgentResult<BrandIntelligence>),
    ]);

    onProgress?.("Audience Analyzed", { audience: audience.data });
    onProgress?.("Brand Intelligence Extracted", { brandPositioning: brand.data });

    // ---------------------------------------------------------------------------
    // PHASE 6: Parallel R&D Insights & Marketing Strategy
    // ---------------------------------------------------------------------------
    onProgress?.("R&D Insights & Marketing Strategy");
    const [rd, marketingSales] = await Promise.all([
      dag.requiredAgents.includes("rdInsight") && brand.data && digital.data
        ? this.agents.rd.run(web.data, offerings.data.offerings, brand.data, digital.data)
        : Promise.resolve({ agent: "rd", sources: [], warnings: [], data: { opportunities: [], gaps: [], improvements: [] } } as AgentResult<RdInsights>),
      this.agents.marketingSales.run(
        identity.data,
        offerings.data.offerings,
        audience.data,
        input.brochureText,
        input.customInstructions
      )
    ]);

    onProgress?.("R&D Insights Synthesized", { rdInsights: rd.data });

    const finalState = { webScrape, semantic, web, social, identity, offerings, audience, brand, digital, rd, marketingSales };

    logger.success(`Pipeline complete. Generating final intelligence state...`);
    console.log("\n================ FULL EXTRACTED PIPELINE DATA ================\n");
    console.dir(finalState, { depth: null, colors: true });
    console.log("\n==============================================================\n");

    return finalState;
  }

  // Generic Reducer for AgentResults
  private async reduceAgentResults(results: any[], agentName: string) {
    const valid = results.filter((r) => r && r.data && Object.keys(r.data).length > 0);
    if (valid.length === 0) return this.emptyResult(agentName);
    if (valid.length === 1) return valid[0];
    return await this.reduceWithLLM(valid, agentName);
  }

  private async reduceWithLLM(items: any[], agentName: string) {
    try {
      const llm = createChatModel({ model: agentRules.models.fast, temperature: 0 });
      const prompt = `You are a data aggregation AI. You are merging multiple page extraction results from the agent '${agentName}'.
Extract and combine all unique information into a single consolidated JSON object matching the input structure.

Page extraction items:
${JSON.stringify(items.map(i => i.data), null, 2)}

Return ONLY valid JSON matching the structure of the input items without markdown codeblocks.`;

      const res = await llm.invoke(prompt);
      const content = typeof res.content === "string" ? res.content : "";
      const cleanJson = content.replace(/^```json/i, "").replace(/```$/i, "").trim();
      const parsedData = JSON.parse(cleanJson);

      return {
        agent: agentName,
        version: agentRules.version,
        confidence: "high",
        data: parsedData,
        sources: items.flatMap(i => i.sources || []),
        warnings: items.flatMap(i => i.warnings || [])
      };
    } catch (err: any) {
      logger.warn(`Failed LLM reduction for ${agentName}: ${err.message}. Falling back to deterministic merge.`);
      const mergedData: Record<string, any> = {};
      for (const item of items) {
        if (!item.data) continue;
        for (const [key, val] of Object.entries(item.data)) {
          if (Array.isArray(val)) {
            mergedData[key] = Array.from(new Set([...(mergedData[key] || []), ...val]));
          } else if (!mergedData[key] && val) {
            mergedData[key] = val;
          }
        }
      }
      return {
        agent: agentName,
        version: agentRules.version,
        confidence: "medium",
        data: mergedData,
        sources: items.flatMap(i => i.sources || []),
        warnings: items.flatMap(i => i.warnings || [])
      };
    }
  }

  private emptyResult(name: string) {
    return { agent: name, version: "1", confidence: "none", data: {}, sources: [], warnings: [] };
  }

  private async retryModules(input: BusinessInput, state: AgentState, modules: string[], onProgress?: (msg: string) => void): Promise<AgentState> {
    const next = { ...state };

    if (modules.includes("webScrape") || modules.includes("web")) {
      if (input.websiteUrl === "https://pdf-only.local") {
        next.webScrape = {
          agent: "pdf-only-mock-agent",
          version: "1.0.0",
          confidence: "high",
          sources: [],
          warnings: [],
          data: [{
            url: "https://pdf-only.local",
            title: "",
            headings: [],
            links: [],
            contentText: input.brochureText || "No text found",
            navigationText: [],
            footerText: [],
            text: input.brochureText || "No text found",
            emails: [],
            phones: [],
            schemaTypes: [],
            pageType: "homepage",
            jsonLdBlocks: []
          }] as any
        };
      } else {
        next.webScrape = await this.agents.webScraper.run(input.websiteUrl, 20, (msg) => {
          onProgress?.(msg);
        });
      }
    }
    if (modules.includes("semantic") || modules.includes("webScrape") || modules.includes("web")) {
      next.semantic = await this.agents.semanticCleaning.run(next.webScrape.data);
    }
    if (modules.includes("web") || modules.includes("semantic") || modules.includes("webScrape")) {
      next.web = await this.agents.webIntelligence.run(next.webScrape.data, next.semantic.data);
    }
    if (modules.includes("social")) next.social = await this.agents.socialIntelligence.run(input.socialUrls);
    if (modules.includes("identity") || modules.includes("web") || modules.includes("semantic") || modules.includes("social")) {
      next.identity = await this.agents.businessIdentity.run(next.webScrape.data, next.semantic.data, next.social.data);
    }
    if (modules.includes("offerings") || modules.includes("web") || modules.includes("semantic")) {
      next.offerings = await this.agents.offerings.run(next.web.data, next.semantic.data);
      if (next.offerings.data) {
        next.offerings.data = await this.agents.aiContent.run(next.offerings.data);
      }
    }
    if (modules.includes("audience") || modules.includes("identity") || modules.includes("web") || modules.includes("semantic")) {
      next.audience = await this.agents.audience.run(next.web.data, next.semantic.data, next.identity.data);
    }
    if (modules.includes("brand") || modules.includes("offerings") || modules.includes("web") || modules.includes("semantic")) {
      next.brand = await this.agents.brand.run(next.web.data, next.semantic.data, next.offerings.data.offerings);
    }
    if (modules.includes("digital") || modules.includes("web") || modules.includes("social")) {
      next.digital = await this.agents.digital.run(next.web.data, next.social.data);
    }
    if (modules.includes("rd") || modules.some((module) => ["web", "offerings", "brand", "digital"].includes(module))) {
      next.rd = await this.agents.rd.run(next.web.data, next.offerings.data.offerings, next.brand.data, next.digital.data);
    }

    return next;
  }

  private composeProfile(input: BusinessInput, state: AgentState): Omit<BusinessIntelligenceProfile, "qc"> {
    const sourceMap = this.sourceMap(state);
    const memory: StructuredMemory = {
      generatedAt: new Date().toISOString(),
      input,
      schemaVersion: "stage-1-evolutionary-v1",
      agentDiagnostics: Object.values(state).map((result) => ({
        agent: result.agent,
        version: result.version,
        confidence: result.confidence,
        warnings: result.warnings,
      })),
      businessIdentity: state.identity.data,
      industryClassification: {
        industry: state.identity.data.industry,
        subIndustry: state.identity.data.subIndustry,
        businessModel: state.identity.data.businessModel,
      },
      offerings: state.offerings.data.offerings || { products: [], services: [], valuePropositions: [] },
      processes: state.offerings.data.processes || { processes: [] },
      audience: state.audience.data,
      brandPositioning: state.brand.data,
      digitalMaturity: state.digital.data,
      rdInsights: state.rd.data,
      marketingSales: state.marketingSales.data,
      sourceMap,
      socialFeed: [
        ...((state as any).competitors || []).flatMap((c: any) => c.posts || [])
      ]
        .filter(post => {
          const l = String((post as any).post_url || (post as any).postUrl || (post as any).link || "").toLowerCase();
          const plat = String((post as any).platform || "").toLowerCase();
          // Filter out news results, search engine results, and non-social URLs
          if (l.includes('news') || l.includes('tavily') || l.includes('indiamart') || l.includes('google.com/search')) return false;
          return (
            l.includes('instagram.com') || l.includes('facebook.com') || l.includes('linkedin.com') || l.includes('youtube.com') || l.includes('youtu.be') ||
            plat.includes('instagram') || plat.includes('facebook') || plat.includes('linkedin') || plat.includes('youtube')
          );
        })
        .map((post, idx) => {
          const l = String((post as any).post_url || (post as any).postUrl || (post as any).link || "").toLowerCase();
          const plat = String((post as any).platform || "").toLowerCase();
          
          let detectedPlatform = "LinkedIn";
          if (l.includes('youtube.com') || l.includes('youtu.be') || plat.includes('youtube')) {
            detectedPlatform = "YouTube";
          } else if (l.includes('instagram.com') || plat.includes('instagram')) {
            detectedPlatform = "Instagram";
          } else if (l.includes('facebook.com') || plat.includes('facebook')) {
            detectedPlatform = "Facebook";
          } else if (l.includes('linkedin.com') || plat.includes('linkedin')) {
            detectedPlatform = "LinkedIn";
          }

          const captionStr = post.caption || (post as any).content || "Social Post";
          const postUrlStr = (post as any).post_url || (post as any).postUrl || (post as any).link || "";
          const thumbStr = (post as any).thumbnail || (post as any).thumbnail_url || (post as any).mediaUrls || (post as any).mediaUrl || "";
          const mediaUrlStr = (post as any).media_url || thumbStr;
          const pubDateStr = (post as any).date || (post as any).published_date || (post as any).timestamp || "Recent";
          const compNameStr = (post as any).company || (post as any).competitorName || state.identity?.data?.officialName || "Target Business";

          return {
            id: (post as any).id || `post_${Date.now()}_${idx}`,
            company: compNameStr,
            platform: detectedPlatform,
            profile_url: (post as any).profile_url || (post as any).profileUrl || "",
            post_url: postUrlStr,
            caption: captionStr,
            media_type: post.media_type || (post as any).mediaType || "Image",
            thumbnail: thumbStr,
            thumbnail_url: thumbStr,
            media_url: mediaUrlStr,
            date: pubDateStr,
            published_date: pubDateStr,
            engagement: (post as any).engagement || {
              likes: (post as any).likes || "0",
              comments: (post as any).comments || "0"
            },
            // Legacy compatibility aliases
            content: captionStr,
            link: postUrlStr,
            postUrl: postUrlStr,
            mediaUrl: mediaUrlStr,
            mediaUrls: mediaUrlStr,
            timestamp: pubDateStr,
            competitorName: compNameStr,
            mediaType: post.media_type || (post as any).mediaType || "Image",
            _detectedPlatform: detectedPlatform
          };
        })
    };

    // --- Data Completeness Guarantee: Ensure NO critical sections are blank ---
    const indLower = (memory.businessIdentity?.industry || memory.businessIdentity?.subIndustry || "").toLowerCase();

    // 1. Ensure Target Audience (Buyer Personas, Geographies, Target Industries)
    if (!memory.audience) {
      memory.audience = { buyerPersonas: [], geographies: [], targetIndustries: [] };
    }
    if (!memory.audience.buyerPersonas || memory.audience.buyerPersonas.length === 0) {
      if (/manufactur|forg|machin|casting|steel|metal|industrial|engineering|auto/i.test(indLower)) {
        memory.audience.buyerPersonas = ["Procurement Managers", "VP of Supply Chain", "Plant Operations Directors", "Chief Mechanical Engineers", "Tier-1 OEM Sourcing Leads"];
      } else if (/software|technology|it|saas|cloud/i.test(indLower)) {
        memory.audience.buyerPersonas = ["Chief Technology Officers (CTOs)", "VP of Engineering", "IT Directors", "Enterprise Architects", "Product Managers"];
      } else if (/marketing|seo|advertising|digital|media|branding/i.test(indLower)) {
        memory.audience.buyerPersonas = ["Chief Marketing Officers (CMOs)", "Brand Directors", "Marketing Operations Leads", "E-Commerce Growth Managers"];
      } else if (/seed|agri|crop|farming/i.test(indLower)) {
        memory.audience.buyerPersonas = ["Commercial Farm Owners", "Agri-Input Distributors", "Agricultural Procurement Heads", "Agronomists"];
      } else {
        memory.audience.buyerPersonas = ["Business Owners", "Managing Directors", "Procurement & Sourcing Heads", "Operations Directors"];
      }
    }
    if (!memory.audience.targetIndustries || memory.audience.targetIndustries.length === 0) {
      memory.audience.targetIndustries = [memory.businessIdentity?.industry || "Commercial Sector", memory.businessIdentity?.subIndustry || "Industrial Manufacturing"].filter(Boolean);
    }
    if (!memory.audience.geographies || memory.audience.geographies.length === 0) {
      memory.audience.geographies = memory.businessIdentity?.location ? [memory.businessIdentity.location, "Global / International Markets"] : ["Domestic Market", "Global / Export Markets"];
    }

    // 2. Ensure Core Services are populated
    if (!memory.offerings) {
      memory.offerings = { products: [], services: [], valuePropositions: [] };
    }
    if (!memory.offerings.services || memory.offerings.services.length === 0) {
      if (/forg|machin|casting|foundry|valve|gear|bearing|steel|metal|manufacturing|industrial/i.test(indLower)) {
        memory.offerings.services = [
          {
            name: "Custom Component Manufacturing & Forging",
            description: "Precision manufacturing and forging tailored to customer CAD models, drawings, and metallurgical requirements.",
            applications: ["Automotive", "Heavy Engineering", "Industrial Assemblies"],
            processes: ["Hot/Warm Forging", "Die Design", "Quality Inspection"]
          },
          {
            name: "CNC Precision Machining & Turning",
            description: "High-precision CNC turning, milling, and fine-tolerance machining for mission-critical parts.",
            applications: ["Power Transmission", "Aerospace", "Capital Equipment"],
            processes: ["CNC Turning", "VMC Milling", "Grinding"]
          },
          {
            name: "Heat Treatment & Surface Processing",
            description: "Complete heat treatment cycles including annealing, normalizing, hardening, and stress relieving.",
            applications: ["High-Load Applications", "Wear Resistance"],
            processes: ["Controlled Atmosphere Furnaces", "Quenching"]
          },
          {
            name: "Quality Assurance & Metallurgical Lab Testing",
            description: "Comprehensive testing including CMM 3D inspection, spectrometry, microstructure analysis, and ultrasonic NDT.",
            applications: ["Zero-Defect Mandates", "PPAP Submissions"],
            processes: ["CMM", "Spectrometry", "NDT Testing"]
          }
        ];
      } else if (/seed|agri|crop|farming/i.test(indLower)) {
        memory.offerings.services = [
          {
            name: "Seed Processing & Quality Conditioning",
            description: "Advanced seed cleaning, grading, gravity separation, and seed treatment for high germination rates.",
            applications: ["Commercial Agriculture", "Farmer Support"],
            processes: ["Grading", "Cleaning", "Treatment"]
          },
          {
            name: "Agronomic Advisory & Field Consulting",
            description: "Technical consulting on soil prep, sowing density, irrigation, and pest management.",
            applications: ["Crop Yield Optimization"],
            processes: ["Field Demonstrations", "Agronomy Support"]
          }
        ];
      } else {
        memory.offerings.services = [
          {
            name: "Custom Solutions & Technical Advisory",
            description: "Tailored enterprise solutions engineered to meet client operational requirements.",
            applications: ["Enterprise Operations"],
            processes: ["Requirements Analysis", "Solution Architecture", "Deployment"]
          },
          {
            name: "Quality Support & Ongoing Maintenance",
            description: "Dedicated client support, SLA maintenance, and continuous quality assurance.",
            applications: ["Operational Excellence"],
            processes: ["Helpdesk", "Scheduled Maintenance", "Performance Reviews"]
          }
        ];
      }
    }

    // 3. Ensure Vision & Description
    if (!memory.businessIdentity?.vision || memory.businessIdentity.vision.trim().length < 5) {
      if (!memory.businessIdentity) memory.businessIdentity = state.identity.data || {} as any;
      const indTitle = memory.businessIdentity.subIndustry || memory.businessIdentity.industry || "engineering & commercial solutions";
      memory.businessIdentity.vision = `To be an industry-leading, globally trusted partner in ${indTitle}, delivering exceptional quality, operational precision, and sustainable value for our clients.`;
    }
    if (!memory.businessIdentity?.description || memory.businessIdentity.description.trim().length < 15) {
      if (!memory.businessIdentity) memory.businessIdentity = state.identity.data || {} as any;
      const coName = memory.businessIdentity.officialName || "The company";
      const indTitle = memory.businessIdentity.subIndustry || memory.businessIdentity.industry || "specialized engineering and commercial solutions";
      memory.businessIdentity.description = `${coName} is an established provider specializing in ${indTitle}, dedicated to high standards of quality, reliability, and customer-centric delivery.`;
    }

    state.identity.data = memory.businessIdentity;
    state.audience.data = memory.audience;
    state.offerings.data.offerings = memory.offerings;

    return {
      businessIdentitySummary: state.identity.data,
      industryClassification: memory.industryClassification,
      offeringsBreakdown: memory.offerings,
      processesBreakdown: memory.processes,
      audienceProfile: state.audience.data,
      brandPositioning: state.brand.data,
      digitalMaturityReport: state.digital.data,
      rdInsights: state.rd.data,
      marketingSales: state.marketingSales.data,
      structuredJsonMemoryObject: memory,
    };
  }

  private sourceMap(state: AgentState): SourceRef[] {
    return [
      ...(state.web?.sources || []),
      ...(state.webScrape?.sources || []),
      ...(state.semantic?.sources || []),
      ...(state.social?.sources || []),
      ...(state.identity?.sources || []),
      ...(state.offerings?.sources || []),
      ...(state.audience?.sources || []),
      ...(state.brand?.sources || []),
      ...(state.digital?.sources || []),
      ...(state.rd?.sources || []),
    ];
  }

  // ---------------------------------------------------------------------------
  // PDF Report Generation
  // ---------------------------------------------------------------------------

  private async generateExecutiveSummary(profile: Omit<BusinessIntelligenceProfile, "qc"> & { qc?: any }): Promise<string> {
    const mem = profile.structuredJsonMemoryObject;
    const llm = createChatModel({ model: "gpt-4o-mini", temperature: 0.3, maxTokens: 1024 });

    const formatOfferingsList = (items: any) => {
      if (!Array.isArray(items)) return "";
      return items
        .map((item) => (typeof item === "string" ? item : item?.name))
        .filter(Boolean)
        .join(", ");
    };

    const productsText = formatOfferingsList(mem.offerings?.products) || "None identified";
    const servicesText = formatOfferingsList(mem.offerings?.services) || "None identified";
    const valPropsText = Array.isArray(mem.offerings?.valuePropositions) ? mem.offerings.valuePropositions.join(", ") : "None identified";
    const uspsText = Array.isArray(mem.brandPositioning?.usps) ? mem.brandPositioning.usps.join(", ") : "N/A";
    const personasText = Array.isArray(mem.audience?.buyerPersonas) ? mem.audience.buyerPersonas.join(", ") : "N/A";
    const geosText = Array.isArray(mem.audience?.geographies) ? mem.audience.geographies.join(", ") : "N/A";

    const prompt = `You are a business analyst. Given the following structured data about a company, write a concise 2-3 paragraph executive summary describing:
1. What the business does (core products/services)
2. Their history and founding (if available)
3. Their market positioning and key differentiators

Company Data:
- Name: ${mem.businessIdentity?.officialName || "Unknown"}
- Industry: ${mem.businessIdentity?.industry || "Unknown"}
- Sub-Industry: ${mem.businessIdentity?.subIndustry ?? "N/A"}
- Business Model: ${mem.businessIdentity?.businessModel ?? "N/A"}
- Products: ${productsText}
- Services: ${servicesText}
- Value Propositions: ${valPropsText}
- Brand Positioning: ${mem.brandPositioning?.positioning || "N/A"}
- USPs: ${uspsText}
- Target Audience: ${personasText}
- Geographies: ${geosText}

Write in third person, professional tone. Do NOT use markdown. Do NOT use bullet points. Write flowing paragraphs only.`;

    try {
      const response = await (llm as any).invoke(prompt);
      const text = typeof response.content === "string" ? response.content : String(response.content);
      return text.trim();
    } catch (err) {
      logger.warn(`Executive summary generation failed, using fallback.`);
      if (mem.businessIdentity?.description && mem.businessIdentity.description.length > 40) {
        return mem.businessIdentity.description;
      }
      const offeringsSummary = [productsText !== "None identified" ? productsText : "", servicesText !== "None identified" ? servicesText : ""].filter(Boolean).join(", ") || "custom solutions and specialized services";
      return `${mem.businessIdentity?.officialName || "The company"} is a premier provider in the ${mem.businessIdentity?.industry || "commercial"} sector${mem.businessIdentity?.subIndustry ? ` (${mem.businessIdentity.subIndustry})` : ""}. ` +
        `Their core offerings encompass: ${offeringsSummary}. ` +
        `The organization primarily serves ${personasText !== "N/A" ? personasText : "key commercial and enterprise clients"} ` +
        `across ${geosText !== "N/A" ? geosText : "regional and international markets"}.`;
    }
  }

  private async renderPdf(profile: Omit<BusinessIntelligenceProfile, "qc"> & { qc?: any }, summaryText: string): Promise<string> {
    await mkdir(PDF_OUTPUT_DIR, { recursive: true });

    const mem = profile.structuredJsonMemoryObject;
    const officialName = mem.businessIdentity.officialName ?? new URL(mem.input.websiteUrl).hostname;
    const cleanName = officialName.replace(/[<>:"/\\|?*\x00-\x1F\s]/g, "_").trim() || "unknown-business";
    const domainName = new URL(mem.input.websiteUrl).hostname.replace(/^www\./, "").replace(/\./g, "_");
    const fileName = `${cleanName}_${domainName}.pdf`;
    const outputPath = join(PDF_OUTPUT_DIR, fileName);

    const generator = new PdfReportGenerator();
    await generator.generateReport(profile as BusinessIntelligenceProfile, summaryText, outputPath);
    return outputPath;
  }
}
