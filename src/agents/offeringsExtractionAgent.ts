import { ChatOpenAI } from "@langchain/openai";
import { createChatModel } from "../utils/llm.js";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";
import type { AgentResult, OfferingsIntelligence, ProcessIntelligence, SemanticWebData, WebIntelligence } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { unique } from "../utils/text.js";

const logger = createLogger("OfferingsExtractionAgent");

export interface OfferingsAndProcesses {
  offerings: OfferingsIntelligence;
  processes: ProcessIntelligence;
}

export class OfferingsExtractionAgent {
  readonly name = "offerings-extraction-agent";
  readonly version = "3.0.0";

  async run(web: WebIntelligence, semantic: SemanticWebData): Promise<AgentResult<OfferingsAndProcesses>> {
    logger.info(`Starting Map-Reduce across ${semantic.pages.length} pages...`);

    const llm = createChatModel({
      model: "gpt-4o",
      temperature: 0.0,
      maxTokens: 2048
    });

    const taxonomy = await this.generateMasterTaxonomy(semantic, llm);
    const masterCatalog = [...taxonomy.products, ...taxonomy.services];
    logger.info(`Intelligent Master Catalog Generated: Products: [${taxonomy.products.join(", ")}], Services: [${taxonomy.services.join(", ")}]`);

    let engineeringContext = "No external engineering context available.";
    const isIndustrial = taxonomy.products.some(c =>
      /ring|forg|valve|machin|bearing|flange|shaft|gear|fastener|casting|steel|alloy|pipe|pump|metal/i.test(c)
    );
    if (isIndustrial && taxonomy.products.length > 0) {
      try {
        logger.info(`Running Live Web Research on components: ${taxonomy.products.slice(0, 3).join(", ")}...`);
        const searchEngine = new FreeSearchEngine({ maxResults: 3 });
        engineeringContext = await searchEngine.invoke({
          query: `Detailed industrial engineering applications and specific use cases for ${taxonomy.products.slice(0, 3).join(", ")}. How are these specific components physically used in massive assemblies like Wind Turbines, Gearboxes, and Heavy Engineering?`
        });
      } catch (e) {
        logger.warn(`Failed to fetch live engineering context from FreeSearchEngine: ${e}`);
      }
    }

    const pagesToProcess = semantic.pages;
    const chunkSize = 3; 
    const mappedResults: OfferingsAndProcesses[] = [];
    
    // Process in sequential chunks to stay smoothly under token limits
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(1);
    const promises: Promise<void>[] = [];

    const totalChunks = Math.ceil(pagesToProcess.length / chunkSize);

    for (let i = 0; i < pagesToProcess.length; i += chunkSize) {
      promises.push(limit(async () => {
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        const chunk = pagesToProcess.slice(i, i + chunkSize);
        const textChunk = chunk.map(p => `URL: ${p.url}\nTITLE: ${p.title}\nTEXT:\n${p.cleanText.slice(0, 1800)}`).join("\n\n---\n\n");

        const prompt = `You are a B2B Intelligence extractor. Analyze the following website pages and extract:

*** GLOBAL BUSINESS CONTEXT ***
Detected Master Offerings for this business:
- Products: [ ${taxonomy.products.length > 0 ? taxonomy.products.join(", ") : "None detected"} ]
- Services: [ ${taxonomy.services.length > 0 ? taxonomy.services.join(", ") : "None detected"} ]

${isIndustrial ? `*** LIVE ENGINEERING RESEARCH CONTEXT ***\n${engineeringContext}\n` : ""}

1. "products": Extract ONLY TRUE products explicitly sold or manufactured by this business (physical items, hardware, or standalone software products).
   - STRICT ANTI-HALLUCINATION POLICY: Do NOT assume or invent any products. If the business is a service provider, agency, or consultancy with no physical goods, leave "products" as an empty array [].
   - If they manufacture components, capture weight ranges, dimensions, technical specs, useCases, and subProducts.
   
2. "services": Extract ALL true services explicitly offered by the business (e.g., "SEO Services", "Web Development", "Google Ads / PPC", "Branding & Creative", "Social Media Marketing", "CNC Machining", "Consulting", "Maintenance", etc.).
   - Extract service name, a clear description of what they deliver, target applications/use-cases, and their processes/workflows.
   - For marketing, digital, IT, SaaS, or professional agencies, their core services are their primary offerings! Ensure all distinct service offerings are captured.

3. "processes": Actual technical workflows, R&D processes, delivery frameworks, or manufacturing methods explicitly mentioned.
4. "valuePropositions": Key USPs or reasons to choose them.

Output a pure JSON object without markdown wrappers matching this TypeScript interface exactly:
{
  "offerings": {
    "products": [{ "name": "...", "category": "...", "description": "...", "keyFeatures": ["..."], "technicalSpecs": {}, "useCases": ["..."], "exportMarkets": ["..."], "subProducts": [] }],
    "services": [{ "name": "...", "description": "...", "applications": ["..."], "processes": ["..."] }],
    "valuePropositions": ["..."]
  },
  "processes": {
    "processes": [{ "name": "...", "description": "...", "workflow": ["..."], "capacity": "...", "machineryUsed": ["..."] }]
  }
}

PAGES:
${textChunk}
`;

        try {
          logger.info(`Mapping chunk ${chunkIndex}/${totalChunks}...`);
          let response: any = null;
          let retries = 3;
          while (retries > 0) {
            try {
              response = await (llm as any).invoke(prompt);
              break;
            } catch (invokeErr: any) {
              const errMsg = String(invokeErr?.message || invokeErr);
              if (errMsg.includes("429") || errMsg.includes("RateLimit") || invokeErr?.status === 429) {
                retries--;
                if (retries > 0) {
                  logger.warn(`Rate limit 429 hit on chunk ${chunkIndex}. Waiting 15s for token bucket replenishment...`);
                  await new Promise((r) => setTimeout(r, 15000));
                  continue;
                }
              }
              throw invokeErr;
            }
          }

          const text = typeof response?.content === "string" ? response.content : String(response?.content || "");
          const parsed = await this.safeParseJson(llm, text);
          if (parsed) {
            logger.success(`Successfully mapped chunk ${chunkIndex}. Extracted ${parsed.offerings?.products?.length || 0} products, ${parsed.offerings?.services?.length || 0} services.`);
            console.dir(parsed, { depth: null, colors: true });
            mappedResults.push(parsed);
          }
        } catch (err) {
          logger.error(`Error mapping chunk ${chunkIndex}: ${err}`);
        }
      }));
    }

    await Promise.all(promises);

    // REDUCE phase (Object Merging, No LLM JSON merging)
    logger.info("Reducing mapped extractions via structured object merge...");
    let finalData: OfferingsAndProcesses = {
      offerings: { products: [], services: [], valuePropositions: [] },
      processes: { processes: [] }
    };

    const NON_PRODUCT_KEYWORDS = new Set([
      "industries", "industries served", "engineering", "national", "international", "global",
      "manufacturing", "technology", "solutions", "services", "overview", "company", "home",
      "about", "about us", "contact", "contact us", "careers", "news", "media", "blog",
      "privacy policy", "terms", "sustainability", "quality", "certifications", "facilities",
      "infrastructure", "catalogue", "catalog", "range", "products", "our products",
      "product range", "all products", "general", "n/a", "none", "rating", "phone"
    ]);

    const isTrueProduct = (name: string): boolean => {
      if (!name || typeof name !== "string") return false;
      const trimmed = name.trim();
      const lower = trimmed.toLowerCase();
      if (NON_PRODUCT_KEYWORDS.has(lower)) return false;
      if (trimmed.length < 3 || trimmed.length > 80) return false;
      return true;
    };

    const normalizeKey = (name: string) => {
      return name.toLowerCase().trim()
        .replace(/[^\w\s]/g, "")
        .replace(/machines?$/i, "")
        .replace(/equipments?$/i, "")
        .replace(/systems?$/i, "")
        .replace(/s$/i, "")
        .trim();
    };

    const seenProducts = new Map<string, any>();
    const seenServices = new Map<string, any>();
    const seenProcesses = new Map<string, any>();
    const seenUsps = new Set<string>();

    for (const res of mappedResults) {
      for (const p of res.offerings?.products || []) {
        if (!p.name || !isTrueProduct(p.name)) continue;
        const key = normalizeKey(p.name);
        if (!seenProducts.has(key)) {
          seenProducts.set(key, p);
          finalData.offerings.products.push({ ...p, category: p.category || "General" });
        } else {
          // Deep merge: category pages might have empty specs, while detail pages have full specs!
          // We find the existing product by the normalized key, but wait, the existing product in finalData.offerings.products might have the un-normalized name.
          // It's safer to just search by normalizeKey
          const existing = finalData.offerings.products.find(x => normalizeKey(x.name) === key);
          if (existing) {
            if (p.category && p.category !== "General" && (!existing.category || existing.category === "General")) {
              existing.category = p.category;
            }
            if (!existing.description || existing.description.length < (p.description?.length || 0)) {
              existing.description = p.description || existing.description;
            }
            if (p.keyFeatures && p.keyFeatures.length > 0) {
              existing.keyFeatures = [...new Set([...(existing.keyFeatures || []), ...p.keyFeatures])];
            }
            if (p.useCases && p.useCases.length > 0) {
              existing.useCases = [...new Set([...(existing.useCases || []), ...p.useCases])];
            }
            if (p.exportMarkets && p.exportMarkets.length > 0) {
              existing.exportMarkets = [...new Set([...(existing.exportMarkets || []), ...p.exportMarkets])];
            }
            if (p.technicalSpecs && Object.keys(p.technicalSpecs).length > 0) {
              existing.technicalSpecs = { ...(existing.technicalSpecs || {}), ...p.technicalSpecs };
            }
            if (p.subProducts && p.subProducts.length > 0) {
              existing.subProducts = existing.subProducts || [];
              for (const sub of p.subProducts) {
                if (!existing.subProducts.find(x => x.name.toLowerCase().trim() === sub.name.toLowerCase().trim())) {
                  existing.subProducts.push(sub);
                }
              }
            }
          }
        }
      }
      for (const s of res.offerings?.services || []) {
        const key = normalizeKey(s.name);
        if (!seenServices.has(key)) {
          seenServices.set(key, s);
          finalData.offerings.services.push({ ...s });
        } else {
          const existing = finalData.offerings.services.find(x => normalizeKey(x.name) === key);
          if (existing) {
            if (!existing.description || existing.description.length < (s.description?.length || 0)) existing.description = s.description || existing.description;
            if (s.applications) existing.applications = [...new Set([...(existing.applications || []), ...s.applications])];
            if (s.processes) existing.processes = [...new Set([...(existing.processes || []), ...s.processes])];
          }
        }
      }
      for (const usp of res.offerings?.valuePropositions || []) {
        const key = usp.toLowerCase().trim();
        if (!seenUsps.has(key)) {
          seenUsps.add(key);
          finalData.offerings.valuePropositions.push(usp);
        }
      }
      for (const p of res.processes?.processes || []) {
        const key = normalizeKey(p.name);
        if (!seenProcesses.has(key)) {
          seenProcesses.set(key, p);
          finalData.processes.processes.push({ ...p });
        } else {
          const existing = finalData.processes.processes.find(x => normalizeKey(x.name) === key);
          if (existing) {
            if (!existing.description || existing.description.length < (p.description?.length || 0)) existing.description = p.description || existing.description;
            if (p.capacity && p.capacity !== "N/A") existing.capacity = p.capacity;
            if (p.workflow) existing.workflow = [...new Set([...(existing.workflow || []), ...p.workflow])];
            if (p.machineryUsed) existing.machineryUsed = [...new Set([...(existing.machineryUsed || []), ...p.machineryUsed])];
          }
        }
      }
    }

    // Fallback: If fewer than 5 services extracted, supplement from businessHeadings and taxonomy
    if (finalData.offerings.services.length < 5 && finalData.offerings.products.length === 0) {
      const candidates = unique([
        ...(taxonomy.services || []),
        ...(taxonomy.products || []),
        ...(semantic?.businessHeadings || [])
      ]);

      const SERVICE_INDICATORS = /service|marketing|seo|development|management|design|advertising|production|branding|consulting|strategy|analytics|optimization|software|engineering|hosting|repair|maintenance|installation|solutions/i;
      const NON_SERVICE_WORDS = /^(home|about|contact|blog|careers|our blog|quick links|follow us|reach us|say hello|skip to content|get ready|award winning|warning|got questions|let.*talk|what we do|who we are)$/i;

      for (const item of candidates) {
        const trimmed = item.trim();
        if (trimmed.length < 3 || trimmed.length > 60) continue;
        if (NON_SERVICE_WORDS.test(trimmed)) continue;

        if (SERVICE_INDICATORS.test(trimmed) || taxonomy.services.includes(trimmed)) {
          const key = normalizeKey(trimmed);
          if (!seenServices.has(key)) {
            seenServices.set(key, true);
            finalData.offerings.services.push({
              name: trimmed,
              description: `${trimmed} solutions and professional services offered by the company.`,
              applications: [],
              processes: []
            });
          }
        }
      }
    }

    const confidence = (finalData.offerings.products.length > 0 || finalData.offerings.services.length > 0) ? "high" : "low";

    return {
      agent: this.name,
      version: this.version,
      confidence,
      data: finalData,
      sources: [],
      warnings: []
    };
  }

  private async generateMasterTaxonomy(semantic: SemanticWebData, llm: ChatOpenAI): Promise<{ products: string[]; services: string[] }> {
    logger.info("Generating intelligent Master Taxonomy from global headings...");
    
    // Grab the global navigation and headings
    const contextText = semantic.businessHeadings.join("\n");
    
    const prompt = `You are a business catalog analyst. Read the following headings and navigation menu items from a business website.
Your job is to identify the TRUE Main Offerings of this business:
1. "products": Physical goods, manufactured components, hardware, or software platforms explicitly sold by the business.
2. "services": Professional services, digital services, marketing services, agency services, engineering services, or solutions explicitly provided by the business (e.g. "Digital Marketing", "SEO Services", "Web Development", "Google Ads", "Branding", "Custom Forging", "CNC Machining", "Consulting").

CRITICAL RULES:
- Never extract generic marketing slogans (e.g., "Turning Ordinary into Buzz", "Award Winning", "Why Choose Us").
- Never extract customer industries (e.g., "Automotive", "Aerospace") as offerings; they belong to markets served.
- Extract only what is explicitly offered.

Return a JSON object:
{
  "products": ["Product Category 1", "..."],
  "services": ["Service Category 1", "..."]
}

Website Navigation & Headings:
${contextText}

Output ONLY the raw JSON object.`;

    try {
      const result = await llm.invoke(prompt);
      const content = typeof result.content === "string" ? result.content : "";
      const cleanJson = content.replace(/^```json/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleanJson);
      return {
        products: Array.isArray(parsed?.products) ? parsed.products : [],
        services: Array.isArray(parsed?.services) ? parsed.services : [],
      };
    } catch (e) {
      logger.warn(`Failed to generate Master Taxonomy: ${e}`);
      return { products: [], services: [] };
    }
  }

  private async safeParseJson(llm: ChatOpenAI, rawText: string): Promise<OfferingsAndProcesses | null> {
    let cleanJson = rawText.replace(/^```json/i, "").replace(/```$/i, "").trim();
    const firstBrace = cleanJson.indexOf("{");
    const lastBrace = cleanJson.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(cleanJson);
    } catch (err) {
      logger.warn("JSON Parse failed. Attempting LLM syntax fix...");
      try {
        const fixPrompt = `FIX JSON ONLY, NO NEW CONTENT. The following JSON is malformed. Return ONLY the corrected JSON:\n\n${cleanJson}`;
        const fixResponse = await (llm as any).invoke(fixPrompt);
        const fixText = typeof fixResponse.content === "string" ? fixResponse.content : String(fixResponse.content);
        let correctedJson = fixText.replace(/^```json/i, "").replace(/```$/i, "").trim();
        const fBrace = correctedJson.indexOf("{");
        const lBrace = correctedJson.lastIndexOf("}");
        if (fBrace !== -1 && lBrace !== -1 && lBrace > fBrace) {
          correctedJson = correctedJson.slice(fBrace, lBrace + 1);
        }
        return JSON.parse(correctedJson);
      } catch (fixErr) {
        logger.error("LLM JSON fix failed. Using deterministic regex fallback.");
        return this.deterministicFallback(cleanJson);
      }
    }
  }

  private deterministicFallback(raw: string): OfferingsAndProcesses {
    const fallback: OfferingsAndProcesses = {
      offerings: { products: [], services: [], valuePropositions: [] },
      processes: { processes: [] }
    };
    
    // Fallback: extract services or products mentioned
    const nameRegex = /"name"\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = nameRegex.exec(raw)) !== null) {
      const val = match[1]?.trim();
      if (val && val.length > 2 && val.length < 100) {
        fallback.offerings.services.push({
          name: val,
          description: "Identified service offering",
          applications: [],
          processes: []
        });
      }
    }
    return fallback;
  }
}
