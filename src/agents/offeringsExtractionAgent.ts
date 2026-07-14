import { ChatOpenAI } from "@langchain/openai";
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

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.0,
      maxTokens: 8192
    });

    const masterCatalog = await this.generateMasterTaxonomy(semantic, llm);
    logger.info(`Intelligent Master Catalog Generated: ${masterCatalog.join(", ")}`);

    let engineeringContext = "No external engineering context available.";
    if (masterCatalog.length > 0) {
      try {
        logger.info(`Running Live Web Research on components: ${masterCatalog.slice(0, 3).join(", ")}...`);
        const searchEngine = new FreeSearchEngine({ maxResults: 3 });
        engineeringContext = await searchEngine.invoke({
          query: `Detailed industrial engineering applications and specific use cases for ${masterCatalog.slice(0, 3).join(", ")}. How are these specific components physically used in massive assemblies like Wind Turbines, Gearboxes, and Heavy Engineering?`
        });
      } catch (e) {
        logger.warn(`Failed to fetch live engineering context from FreeSearchEngine: ${e}`);
      }
    }

    // We'll chunk pages to avoid exceeding prompt limits, but 2.5-flash has 1M context.
    // However, to follow the Map-Reduce requirement, we map over pages in chunks.
    // OpenAI gpt-4o-mini has high rate limits (2M+ TPM), so we can process the entire site concurrently.
    const pagesToProcess = semantic.pages;
    const chunkSize = 25; 
    const mappedResults: OfferingsAndProcesses[] = [];
    
    // Process in parallel chunks (lowered concurrency for gpt-4o rate limits)
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(3);
    const promises: Promise<void>[] = [];

    const totalChunks = Math.ceil(pagesToProcess.length / chunkSize);

    for (let i = 0; i < pagesToProcess.length; i += chunkSize) {
      promises.push(limit(async () => {
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        const chunk = pagesToProcess.slice(i, i + chunkSize);
        const textChunk = chunk.map(p => `URL: ${p.url}\nTITLE: ${p.title}\nTEXT:\n${p.cleanText}`).join("\n\n---\n\n");

        const prompt = `You are a B2B Intelligence extractor. Analyze the following website pages and extract:

*** GLOBAL BUSINESS CONTEXT ***
The Master Product Categories for this business (extracted from the navigation menu) are:
[ ${masterCatalog.length > 0 ? masterCatalog.join(", ") : "None detected. Infer high-level categories based on the text."} ]

*** LIVE ENGINEERING RESEARCH CONTEXT ***
Use the following external web research to understand EXACTLY how the extracted products fit into larger assemblies. 
${engineeringContext}

1. "products": Extract ONLY TRUE products explicitly sold or manufactured by this business.
   - STRICT ANTI-HALLUCINATION / ZERO-HALLUCINATION POLICY: Do NOT assume or invent any products. Just add the things which are explicitly there in the website and brochure text. If they only make 1 product, only output 1 product.
   - STRICT COMPONENT RULE: If the business manufactures a component (e.g. "Seamless Rolled Rings", "Forgings") that goes into a larger system (e.g. "Gearboxes", "Wind Turbines", "Valves", "Pumps", "Bearings"), DO NOT list the larger system as a product they manufacture! The larger systems belong in "useCases".
   - CAPABILITY IS NOT A PRODUCT: Do NOT extract manufacturing capabilities, services, or equipment (e.g. "CNC Machining", "Heat Treatment", "Forging Facility", "Radial-Axial Ring Rolling") as Products. They belong in "processes" or "services".
   - INDUSTRY IS NOT A PRODUCT: If a section is titled "Industries Served" or "Applications", NEVER extract the items in that section as Products. They are strictly "useCases".
   - NO ASSUMED PRODUCTS: Do NOT extract related items, machinery, or accessories that are typically associated with their core products unless the text explicitly states the business manufactures them.
   - STRICT FILTERING: Do NOT extract services (e.g. "Maintenance", "Technical Support") as products.
   - EXTRACT ALL DISTINCT PRODUCTS: You must deeply process ALL provided text and extract EVERY single distinct product or component manufactured by the business (e.g. Flanges, Shafts, Rolled Rings, Forged Blocks, Blinds). DO NOT collapse everything into just 1 product if they make multiple things!
   - EXACT NAMES: Extract the EXACT product name exactly as it appears on the webpage/brochure.
   - HIERARCHY RULE: Use the Master Categories listed above as a strong guide.
   - DO NOT extract specific variations (e.g. "Ball Valve", "Butterfly Valve") as main products IF their parent category exists. Place them inside the "subProducts" array of their parent.
   - CATEGORY: Extract the product's broader category.
   - METADATA EXTRACTION: You MUST extract "useCases", "keyFeatures", and "technicalSpecs". For "technicalSpecs", you MUST capture ALL weights (e.g. Kg, M.T.), dimensions (mm, meters), and capacities mentioned. Do not miss the weight ranges!
   - DESCRIPTIVE USE CASES: DO NOT output 1-word generic labels. You MUST output a fully researched descriptive sentence explaining exactly how the component fits into the end-assembly. Use the Live Engineering Context to help. CRITICAL: DO NOT copy ANY examples or phrasing from this prompt (e.g. do NOT copy the phrase "Used as critical structural components..."). You must write your own unique, accurate description based ONLY on the text and engineering context. Do NOT hallucinate specific parts like gears unless explicitly stated.
   - CATEGORIZATION RULE: Do NOT put sub-products, variations, or components inside "useCases"! They MUST go into "subProducts".
   - TECHNICAL REASONING RULE: Before assigning a use case, deeply analyze the technical specifications provided (e.g., weight like 10kg vs 3 M.T., dimensions, alloys).
   - EXPLICIT JUSTIFICATION: Do NOT extract an industry just because it is mentioned generically. The specific product's technical parameters must align with the use case.
   - SOURCE QUOTE MANDATORY: In your _analysis block, you MUST explicitly write down your step-by-step reasoning about the technical specs and how they map to the real-world applications. For example, if a ring is 10kg, explain where it is used. If it is 3 M.T., explain where that massive ring is used based on the text and engineering context. If you cannot justify it with technical logic derived from the text, LEAVE THE useCases ARRAY EMPTY. Do not guess.
2. "services": ONLY actual top-level services explicitly offered (e.g., "Installation", "Maintenance"). No marketing headings.
3. "processes": Actual manufacturing workflows, R&D processes, assembly methods explicitly mentioned.
4. "valuePropositions": Key USPs.

Output a pure JSON object without markdown wrappers matching this TypeScript interface exactly:
{
  "_analysis": "First, write a detailed step-by-step analysis of the technical specifications (weights, dimensions, materials) mentioned for each product. Reason explicitly about what specific applications these exact technical parameters make possible or are strictly required for. For example, if a ring is 10Kg, reason about its use cases versus a ring that is 3 M.T. Finally, identify what products are actually sold and justify every single use case using exact technical logic from the text. Ensure 100% accuracy and zero fake information.",
  "offerings": {
    "products": [{ "name": "Main Product (e.g. Valves)", "category": "...", "description": "...", "keyFeatures": ["..."], "technicalSpecs": { "key": "value" }, "useCases": ["..."], "exportMarkets": ["..."], "subProducts": [{ "name": "Ball Valve", "description": "Small description" }] }],
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
          const response = await (llm as any).invoke(prompt);
          const text = typeof response.content === "string" ? response.content : String(response.content);
          const parsed = await this.safeParseJson(llm, text);
          if (parsed) {
            logger.success(`Successfully mapped chunk ${chunkIndex}. Extracted ${parsed.offerings?.products?.length || 0} products, ${parsed.offerings?.services?.length || 0} services.`);
            // Print raw JSON to terminal so the user can see everything!
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

    const normalizeKey = (name: string) => {
      return name.toLowerCase().trim()
        .replace(/machines?$/i, "")
        .replace(/equipments?$/i, "")
        .replace(/systems?$/i, "")
        .replace(/s$/i, "") // basic plural removal
        .trim();
    };

    const seenProducts = new Map<string, any>();
    const seenServices = new Map<string, any>();
    const seenProcesses = new Map<string, any>();
    const seenUsps = new Set<string>();

    for (const res of mappedResults) {
      for (const p of res.offerings?.products || []) {
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

    const confidence = finalData.offerings.products.length > 0 ? "high" : "low";

    return {
      agent: this.name,
      version: this.version,
      confidence,
      data: finalData,
      sources: [],
      warnings: []
    };
  }

  private async generateMasterTaxonomy(semantic: SemanticWebData, llm: ChatOpenAI): Promise<string[]> {
    logger.info("Generating intelligent Master Taxonomy from global headings...");
    
    // Grab the global navigation and headings
    const contextText = semantic.businessHeadings.join("\n");
    
    const prompt = `You are a business catalog analyst. Read the following headings and navigation menu items from a business website.
Your job is to identify the TRUE Main Product Categories for this business.

CRITICAL RULES:
1. A "product" is a physical item, a component, or a specific software offering explicitly sold by the business. 
2. A product is NEVER a marketing slogan (e.g. "Engineering Excellence", "Precision-Driven Solutions", "One of the Most Trusted").
3. A product is NEVER a service or capability (e.g. "Technical Support", "Maintenance", "Consulting", "Installation", "Forging Facility", "Heat Treatment", "Machining").
4. IGNORE "Industries We Serve" or "Applications". Industries (e.g., "Food Processing", "Railways", "Mining", "Pump Industry", "Gearboxes", "Wind Turbines") are markets the business sells to, NOT the products they manufacture. True products will typically be found under "Products", "Our Products", or "Process" pages.
5. STRICT ANTI-HALLUCINATION: If the business only lists a single core product (e.g. "Seamless Rolled Rings"), do NOT hallucinate or guess other products to pad the list. Only extract exactly what is explicitly offered.
6. STRICT COMPONENT RULE: If the business manufactures components (e.g. "Rings", "Forgings") that go into larger assemblies (e.g. "Gearboxes", "Wind Turbines", "Valves", "Pumps"), DO NOT list the larger assemblies as product categories. Only list the exact components they manufacture.
7. NO ASSUMED PRODUCTS: Do not extract related items or machinery that the business does not explicitly claim to manufacture.

Return a simple JSON array of strings representing the clean, true Master Product Categories. If none can be clearly deduced from the navigation/headings alone, return an empty array.

Website Navigation & Headings:
${contextText}

Example Output:
["Seamless Rolled Rings", "Industrial Fasteners", "Hydraulic Pumps", "Forged Blocks"]

Output ONLY the raw JSON array.`;

    try {
      const result = await llm.invoke(prompt);
      const content = typeof result.content === "string" ? result.content : "";
      const cleanJson = content.replace(/^```json/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch (e) {
      logger.warn(`Failed to generate Master Taxonomy: ${e}`);
      return [];
    }
  }

  private async safeParseJson(llm: ChatOpenAI, rawText: string): Promise<OfferingsAndProcesses | null> {
    const cleanJson = rawText.replace(/^```json/i, "").replace(/```$/i, "").trim();
    try {
      return JSON.parse(cleanJson);
    } catch (err) {
      logger.warn("JSON Parse failed. Attempting LLM syntax fix...");
      try {
        const fixPrompt = `FIX JSON ONLY, NO NEW CONTENT. The following JSON is malformed. Return ONLY the corrected JSON:\n\n${cleanJson}`;
        const fixResponse = await (llm as any).invoke(fixPrompt);
        const fixText = typeof fixResponse.content === "string" ? fixResponse.content : String(fixResponse.content);
        return JSON.parse(fixText.replace(/^```json/i, "").replace(/```$/i, "").trim());
      } catch (fixErr) {
        logger.error("LLM JSON fix failed. Using deterministic regex fallback.");
        // Deterministic Fallback parser
        return this.deterministicFallback(cleanJson);
      }
    }
  }

  private deterministicFallback(raw: string): OfferingsAndProcesses {
    const fallback: OfferingsAndProcesses = {
      offerings: { products: [], services: [], valuePropositions: [] },
      processes: { processes: [] }
    };
    
    // Very basic regex to pull out "name": "..." values as a failsafe
    const nameRegex = /"name"\s*:\s*"([^"]+)"/g;
    let match;
    while ((match = nameRegex.exec(raw)) !== null) {
      if (match[1].length > 3 && match[1].length < 100) {
        fallback.offerings.products.push({
          name: match[1],
          category: "General",
          description: "Recovered via regex fallback",
          keyFeatures: [],
          technicalSpecs: {},
          useCases: [],
          exportMarkets: []
        });
      }
    }
    return fallback;
  }
}
