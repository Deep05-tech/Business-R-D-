import { ChatOpenAI } from "@langchain/openai";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";
import { createLogger } from "../utils/logger.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import type { StructuredMemory, CompetitorProfile } from "../types.js";

const logger = createLogger("CompetitorAgent");

export class CompetitorAgent {
  readonly name = "competitor-agent";
  readonly version = "3.0.0";

  async run(memory: StructuredMemory, scope: "local" | "regional" | "global" | "all" = "regional"): Promise<CompetitorProfile[]> {
    logger.info(`Running true competitor research for ${memory.input.websiteUrl} with scope: ${scope}...`);

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.1,
      maxTokens: 8000,
    });

    const businessName = memory.businessIdentity?.officialName || memory.input.websiteUrl;
    
    const coreProductsDetailed = memory.offerings?.products.slice(0, 2).map(p => {
      const specs = Object.entries(p.technicalSpecs || {}).map(([k, v]) => `${k}: ${v}`).join("; ");
      return `- **${p.name}**: ${p.description}\\n  *Specs/Capacity:* ${specs || "Not explicitly specified"}`;
    }).join("\\n") || "Industrial products";

    let memoryContext = JSON.stringify({
      businessIdentity: memory.businessIdentity,
      offerings: memory.offerings,
      industryClassification: memory.industryClassification,
    }, null, 2);
    if (memoryContext.length > 10000) {
        memoryContext = memoryContext.substring(0, 10000) + "\n...[TRUNCATED TO PREVENT RATE LIMITS]";
    }

    let scopeInstruction = "";
    if (scope === "local") {
      const loc = memory.businessIdentity?.location || "the business's local area";
      const parts = loc.split(",").map(p => p.trim());
      const city = parts[0] || loc;
      const state = parts.length > 1 ? parts[1] : loc;
      const country = parts.length > 2 ? parts[parts.length - 1] : loc;
      scopeInstruction = `Generate exactly 10 queries. 7 queries MUST focus strictly on highly LOCAL competitors located in ${city}. 3 queries MUST focus on competitors located in the state of ${state}. DO NOT search for competitors outside of ${state}.
CRITICAL: You should include terms like "manufacturers in ${city}" or "suppliers in ${city}" to pull local directory listings (e.g. IndiaMart, JustDial) because independent websites are rare for local businesses. Also include highly specific Google Dork queries like: site:indiamart.com "${city}" "${businessName} competitors"`;
    } else if (scope === "regional") {
      const loc = memory.businessIdentity?.location || "the business's country";
      const country = loc.split(",").pop()?.trim() || loc;
      scopeInstruction = `ALL 10 queries MUST focus strictly on NATIONAL competitors operating anywhere within ${country}.`;
    } else if (scope === "all") {
      scopeInstruction = "ALL 10 queries MUST actively search for the strongest competitors from ALL OVER THE WORLD (North America, Europe, Asia, etc.), ensuring a truly global and geographically diverse mix of competitors.";
    } else {
      scopeInstruction = "ALL 10 queries MUST focus strictly on massive GLOBAL competitors worldwide.";
    }

    // --- PHASE 1: Query Generation ---
    const queryGenerationPrompt = `You are an elite B2B Market Research Analyst. Your task is to generate 10 highly relevant search queries to find the truest competitors for the following business.
${scopeInstruction}
CRITICAL: To avoid pulling informational blogs or news sites, you MUST include transactional or commercial keywords in your queries, such as "product", "service", "manufacturer", "supplier", or "buy". Do NOT just search the product name blindly.
Output ONLY the 10 queries, separated by a newline. Do not use quotes or numbering.

BUSINESS EXACT CORE PRODUCTS & CAPACITIES:
${coreProductsDetailed}

BUSINESS IDENTITY:
${JSON.stringify(memory.businessIdentity)}
${memory.businessIdentity?.vision ? `\nCORE VISION/MISSION:\n${memory.businessIdentity.vision}\n(Ensure queries target companies with a similar level of ambition or philosophical scale.)` : ""}`;

    let generatedQueries: string[] = [];
    try {
      const queryResponse = await llm.invoke(queryGenerationPrompt);
      const queryText = typeof queryResponse.content === "string" ? queryResponse.content : "";
      generatedQueries = queryText.split("\n").map(q => q.trim().replace(/^\d+\.\s*/, "")).filter(q => q.length > 5).slice(0, 10);
    } catch (e: any) {
      generatedQueries = [`Top manufacturers like ${businessName}`, `${businessName} competitors global`, `${businessName} competitors local`];
    }

    // --- PHASE 2: Tavily Search ---
    let tavilyContext = "";
    const searchTool = new FreeSearchEngine({ maxResults: 12 });
    if (process.env.TAVILY_API_KEY) {
      logger.info(`Executing web search for competitors...`);
      for (const query of generatedQueries) {
        try {
          const resultRaw = await searchTool.invoke({ query });
          const parsed = typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw;
          const searchArray = Array.isArray(parsed) ? parsed : (parsed.results || []);
          const aliveResults = [];
          for (const item of searchArray) {
            if (item.url && !item.url.includes("linkedin.com/in/") && !item.url.includes("facebook.com")) {
              const safeContent = (item.content || "").substring(0, 400);
              aliveResults.push({ url: item.url, title: item.title, content: safeContent });
            }
          }
          tavilyContext += `\nSearch Query: ${query}\nResults: ${JSON.stringify(aliveResults)}\n`;
        } catch (parseErr) {
          tavilyContext += `\nSearch Query: ${query}\nResults: Parse error\n`;
        }
      }
      
      // Aggressively truncate Tavily context to prevent massive TPM usage
      if (tavilyContext.length > 30000) {
          tavilyContext = tavilyContext.substring(0, 30000) + "\n...[SEARCH TRUNCATED TO PREVENT RATE LIMITS]";
      }
    }

    // --- PHASE 3: Base Competitor Identification ---
    const baseCompetitorSchema = z.object({
      competitors: z.array(z.object({
        name: z.string().describe("Official name of the competitor company"),
        url: z.string().describe("Root domain website URL of the competitor (e.g. https://example.com)"),
        type: z.enum(["local", "global"]).describe("Whether this competitor is local/regional or a global player"),
        actual_headquarters: z.string().describe("The exact verified city and state where this company is headquartered based ONLY on the snippets. Do not guess the city. If the city is Rajkot, write Rajkot. DO NOT default to Ahmedabad or other major cities unless explicitly stated."),
        whyCompetitor: z.string().describe("A compelling 1-2 sentence explanation of why this company is a direct competitor to the target business based on the search context (e.g., they manufacture similar forged products, serve the same industries, etc.)."),
        evidence_product_pages: z.array(z.object({
          title: z.string().describe("The name of the product or service on this page (e.g. 'Forged Rings')"),
          url: z.string().describe("The exact URL to this product page")
        })).max(5).describe("List up to 5 specific URLs from the search snippets that point directly to their product or service pages. YOU MUST ONLY USE EXACT URLs THAT APPEAR IN THE SEARCH RESULTS. DO NOT guess or append '/products' to the domain. If a specific product page URL is not in the snippet, just use the homepage."),
        is_strictly_in_target_region: z.boolean().describe("Set to true ONLY if actual_headquarters is physically located inside the requested target geographic boundary. Set to false if they are headquartered elsewhere."),
        is_strictly_same_industry: z.boolean().describe("Set to true ONLY if the company operates in the EXACT same industry as the target business (e.g., Heavy Engineering/Forging). Set to false if they share a name but are in a totally different industry (e.g., Jewellery, Clothing, Software).")
      })).max(25)
    });

    let synthesisScope = "";
    const loc = memory.businessIdentity?.location || "the exact local area";
    const parts = loc.split(",").map(p => p.trim());
    const city = parts[0] || loc;
    const state = parts.length > 1 ? parts[1] : loc;
    const country = parts.length > 2 ? parts[parts.length - 1] : loc;
    
    if (scope === "local") synthesisScope = `AT LEAST 15 (and UP TO 25) competitors physically located EXCLUSIVELY in ${city} or the state of ${state}`;
    else if (scope === "regional") synthesisScope = `AT LEAST 15 (and UP TO 25) NATIONAL competitors operating anywhere within ${country}`;
    else if (scope === "all") synthesisScope = "AT LEAST 15 (and UP TO 25) competitors from ALL OVER THE WORLD (ensuring a diverse geographic mix from North America, Europe, Asia, etc.)";
    else synthesisScope = "AT LEAST 15 (and UP TO 25) GLOBAL competitors";

    const synthesisPrompt = `You are an elite B2B Market Research Analyst. Identify a backup pool of ${synthesisScope} for the given business based on the web search results and your knowledge.

BUSINESS: ${businessName}
${memory.businessIdentity?.vision ? `BUSINESS VISION/MISSION: ${memory.businessIdentity.vision}\n(Prioritize competitors who share a similar operational philosophy, scale, or mission.)\n` : ""}
BUSINESS CONTEXT:
${memoryContext}

LIVE WEB SEARCH RESULTS:
${tavilyContext}

INSTRUCTIONS:
1. Identify ${synthesisScope} based on the search context.
2. If searching for GLOBAL competitors, leverage your vast pre-trained knowledge to fill in major global leaders.
3. EXTRACT TRUE LOCATIONS: For every competitor, output their REAL 'actual_headquarters' based STRICTLY on the snippets. If the snippet says they are in ${city}, write ${city}. If they are in another local town (like Mehsana), write that exact town. DO NOT hallucinate or default to major cities like 'Ahmedabad' just because you are uncertain. If the exact city is completely unknown, just write the State.
4. TARGET REGION FLAG: If searching for 'local', the target region is EXCLUSIVELY ${city} or ${state}. If searching for 'regional', the target region is the ENTIRE country of ${country} (ANY city/state inside ${country} is valid). Set 'is_strictly_in_target_region' to true if their true headquarters falls inside this boundary.
5. STRICTLY INDEPENDENT WEBSITES ONLY: The 'url' MUST be the competitor's actual, independent root domain website (e.g. https://www.companyname.com). You are STRICTLY FORBIDDEN from outputting directory links, marketplace links, or external aggregator websites (DO NOT use IndiaMart, JustDial, TradeIndia, Facebook, or LinkedIn links as the URL). If a company does not have an independent website in the search results, you MUST discard them and not include them in the final JSON.
6. STRICT INDUSTRY MATCH & BLOG REJECTION: If the search snippet indicates the website is just a blog, news article, directory, or informational wiki mentioning the product, YOU MUST REJECT THEM. They must actively manufacture or sell the product. Set 'is_strictly_same_industry' to false if they don't explicitly sell it. Do not assume any company with a similar name is a competitor unless the industry perfectly matches.
7. EVIDENCE URL EXTRACT: You MUST extract up to 5 specific URLs from the search results that point directly to their product or service pages into 'evidence_product_pages'. CRITICAL: YOU ARE FORBIDDEN FROM GUESSING URLs. You cannot just take the root domain and add '/products' to it. You must copy the EXACT URL string as it appears in the search snippet. If the search results do not explicitly show a link to a specific product page, you must ONLY use their homepage. If a snippet URL is a blog post, DO NOT include it. If the product title in the snippet is in a foreign language, YOU MUST TRANSLATE THE TITLE TO ENGLISH.
8. Output EXACTLY valid JSON matching the provided schema.`;

    let baseCompetitors: Array<{name: string, url: string, type: "local"|"global", location: string, whyCompetitor?: string, evidenceUrls?: Array<{title: string, url: string}>}> = [];
    try {
      logger.info(`Synthesizing base competitor list...`);
      const structuredLlm = llm.withStructuredOutput(baseCompetitorSchema);
      const response = await structuredLlm.invoke(synthesisPrompt);
      
      // Programmatically filter out any hallucinated/out-of-region competitors
      const rawCompetitors = response.competitors || [];
      const filtered = rawCompetitors.filter((c: any) => {
        if (c.is_strictly_same_industry === false) return false; // Hard kill for cross-industry hallucinations (e.g. Jewellery vs Forging)
        if (scope === "global" || scope === "all") return true; // Bypass geographic strictness for global and 'all' scopes
        if (scope === "regional") return c.is_strictly_in_target_region !== false; // Be lenient on regional so we don't accidentally drop valid national companies
        return c.is_strictly_in_target_region === true;
      });
      
      baseCompetitors = filtered.map((c: any) => ({
        name: c.name,
        url: c.url,
        type: scope === "global" ? "global" : (scope === "local" ? "local" : c.type),
        location: c.actual_headquarters || "Unknown",
        whyCompetitor: c.whyCompetitor || "No reason extracted.",
        evidenceUrls: c.evidence_product_pages || []
      }));
      
      logger.info(`Filtered from ${rawCompetitors.length} raw competitors to ${baseCompetitors.length} strictly valid local/regional competitors.`);
    } catch (e: any) {
      logger.error(`Competitor synthesis failed: ${e.message}`);
      throw e;
    }

    // --- PHASE 4: Direct Scraping & Dorking for Socials ---
    logger.info(`Phase 4: Filtering for verified social media presence...`);
    const finalCompetitors: CompetitorProfile[] = [];
    
    // Sort so that if both types exist (which shouldn't happen with the new strict scopes), it processes them.
    // In our new scoped model, baseCompetitors is mostly homogeneous based on the scope selected.
    const processQueue = [...baseCompetitors];

    const processCompetitor = async (comp: any) => {
      return await this.scrapeCompetitorSocials(comp);
    };

    let validCount = 0;
    while(processQueue.length > 0 && validCount < 10) {
      const comp = processQueue.shift();
      if (!comp) continue;
      const validated = await processCompetitor(comp);
      if (validated) {
        finalCompetitors.push(validated);
        validCount++;
      } else {
        logger.info(`Discarding ${comp.name} (no social media found)`);
      }
    }

    // --- PHASE 5: Strict LLM QC Validation ---
    logger.info(`Phase 5: Running strict LLM QC on extracted competitors and links...`);
    const qcCompetitors = await this.qcCompetitorLinks(finalCompetitors, memory.industryClassification?.industry || "target industry");

    return qcCompetitors;
  }

  private async qcCompetitorLinks(competitors: CompetitorProfile[], targetIndustry: string): Promise<CompetitorProfile[]> {
    if (competitors.length === 0) return competitors;

    const llm = new ChatOpenAI({ modelName: "gpt-4o", temperature: 0 });
    
    const qcSchema = z.object({
      valid_competitors: z.array(z.object({
        name: z.string(),
        url: z.string(),
        is_strictly_same_industry: z.boolean().describe("Set to true ONLY if the company operates in the EXACT same industry as the target business (e.g., Heavy Engineering/Forging). Set to false if they share a name but are in a totally different industry (e.g., Jewellery, Clothing, Software, Logistics)."),
        why_competitor_improved: z.string().describe("Review their original 'whyCompetitor' reason. If it's weak or vague, rewrite it into a powerful, sharp 1-2 sentence explanation of exactly why they compete with the target business."),
        approved_evidence_urls: z.array(z.object({
          title: z.string(),
          url: z.string()
        })).describe("Select UP TO 5 URLs from the provided pool that most explicitly point to actual products, services, or catalogs. Remove corporate, leadership, news, or blog links.")
      }))
    });

    const prompt = `You are a strict Data Quality Control (QC) Auditor.
Your job is to review a list of scraped competitors and their extracted links to ensure 100% accuracy for a Business Intelligence dashboard.
The target business operates in this exact industry: ${targetIndustry}

Here are the scraped competitors and their extracted product links:
${JSON.stringify(competitors, null, 2)}

INSTRUCTIONS:
1. is_strictly_same_industry: Review each competitor's name and URL. If you know they are NOT in the exact same industry (e.g., if the target is heavy forging, and the competitor is a jewelry brand or a software company), you MUST set this to false.
2. approved_evidence_urls: You have been given a broad pool of raw links for each competitor. You MUST carefully analyze these links and SELECT UP TO 5 of the most specific product, service, solution, or catalog pages.
   - DO NOT include leadership profiles (e.g., "Chairman", "CEO", "CFO")
   - DO NOT include corporate stories, blogs, or news (e.g., "Story", "Our History", "Press")
   - DO NOT include About Us, Careers, or Investor Relations pages
   If ALL of a competitor's links are invalid or if no specific products exist, just return an empty array for their approved_evidence_urls.
3. LANGUAGE TRANSLATION: If any of the selected product page titles are in a foreign language, you MUST translate the title into English before outputting it.
4. Return the exact same competitors, but with the 'is_strictly_same_industry' flag properly evaluated, and the 'evidenceUrls' array containing only the top 5 valid product links you intelligently selected.`;

    try {
      const parsed = await llm.withStructuredOutput(qcSchema).invoke(prompt);
      
      const qcApproved: CompetitorProfile[] = [];
      for (const comp of competitors) {
        const qcData = parsed.valid_competitors.find(c => c.url === comp.url || c.name === comp.name);
        if (qcData) {
          if (qcData.is_strictly_same_industry) {
             let validUrls = qcData.approved_evidence_urls || [];
             
             // Reject if they only have 1 generic page
             if (validUrls.length === 1) {
                 const genericTitles = /^(products?|services?|catalogs?|solutions?|homepage|home|offerings?)$/i;
                 if (genericTitles.test(validUrls[0].title.trim()) || genericTitles.test(validUrls[0].url.split('/').filter(Boolean).pop() || "")) {
                     validUrls = [];
                 }
             }

             if (validUrls.length === 0) {
                 logger.warn(`QC Agent discarded ${comp.name} because it lacked any specific product pages.`);
             } else {
                 comp.evidenceUrls = validUrls;
                 comp.whyCompetitor = qcData.why_competitor_improved || comp.whyCompetitor;
                 qcApproved.push(comp);
             }
          } else {
             logger.warn(`QC Agent discarded ${comp.name} because it is not in the strict target industry.`);
          }
        } else {
           qcApproved.push(comp);
        }
      }
      
      logger.info(`QC Agent approved ${qcApproved.length} competitors out of ${competitors.length}.`);
      return qcApproved;
    } catch (e: any) {
      logger.error(`QC Validation failed: ${e.message}`);
      return competitors;
    }
  }

  public async scrapeCompetitorSocials(comp: {name: string, url: string, type: "local"|"global", location: string, whyCompetitor?: string, evidenceUrls?: Array<{title: string, url: string}>, forceKeep?: boolean}): Promise<CompetitorProfile | null> {
    const socials: CompetitorProfile["socials"] = { linkedin: null, instagram: null, facebook: null, youtube: null };
    
    try {
      logger.debug(`Scraping ${comp.url}...`);
      let res = await axios.get(comp.url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
      let $ = cheerio.load(res.data);
      
      // Handle simple JS redirects (e.g., Amtek Auto returning <script>window.location.href="/lander"</script>)
      if ($('a[href]').length === 0) {
        const match = res.data.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
        if (match && match[1]) {
          const redirectUrl = new URL(match[1], comp.url).toString();
          logger.debug(`Following JS redirect to ${redirectUrl}...`);
          res = await axios.get(redirectUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
          $ = cheerio.load(res.data);
        }
      }
      
      let verifiedProductLinks: Array<{title: string, url: string}> = [];

      $('a[href]').each((_, el) => {
        let rawHref = $(el).attr('href') || "";
        let text = $(el).text().trim().replace(/\\s+/g, ' ');
        if (!rawHref || rawHref.startsWith('javascript') || rawHref.startsWith('tel:') || rawHref.startsWith('mailto:') || rawHref === '#') return;
        
        let href = rawHref;
        try {
          if (!href.startsWith('http')) {
            href = new URL(href, comp.url).toString();
          }
        } catch { return; }
        
        const hrefLower = href.toLowerCase();
        
        if (hrefLower.includes('linkedin.com/')) socials.linkedin = hrefLower;
        if (hrefLower.includes('instagram.com/') && !hrefLower.includes('/explore/')) socials.instagram = hrefLower;
        if (hrefLower.includes('facebook.com/') && !hrefLower.includes('sharer')) socials.facebook = hrefLower;
        if (hrefLower.includes('youtube.com/') && !hrefLower.includes('/watch')) socials.youtube = hrefLower;

        // Auto-extract real, verified product pages directly from the competitor's DOM
        let linkHostname = "";
        try { linkHostname = new URL(href).hostname.replace(/^www\./, ''); } catch { }
        let compHostname = "";
        try { compHostname = new URL(comp.url).hostname.replace(/^www\./, ''); } catch { }
        
        const linkRoot = linkHostname.split('.')[0];
        const compRoot = compHostname.split('.')[0];

        if (text.length > 3 && text.length < 70 && linkRoot === compRoot && linkRoot !== "" && linkRoot !== undefined) {
          const textLower = text.toLowerCase();
          
          let urlPathname = "";
          try { urlPathname = new URL(href).pathname.toLowerCase(); } 
          catch { urlPathname = hrefLower; }
          
          const isRejected = /(blog|news|article|press|event|career|job|about|contact|privacy|terms|login|register|media|investor|\.pdf|\.jpg|\.png)/i.test(urlPathname) || 
                             /^(home|about us|contact us|read more|learn more|click here|view all|more|login|sign in|previous|next)$/i.test(textLower) ||
                             hrefLower.includes('#');
          
          if (!isRejected && urlPathname.length > 1) {
             // Broad collection: If it's internal and not rejected, it's a candidate
             if (!verifiedProductLinks.some(l => l.url === href || l.title.toLowerCase() === textLower)) {
                 verifiedProductLinks.push({ title: text, url: href });
             }
          }
        }
      });
      
      // Pass up to 30 verified links to the QC LLM to let it intelligently select the best 5 product pages
      if (verifiedProductLinks.length > 0) {
        comp.evidenceUrls = verifiedProductLinks.slice(0, 30);
      } else {
        comp.evidenceUrls = [{ title: "Homepage", url: comp.url }];
      }
    } catch (err: any) {
      logger.warn(`Website ${comp.url} could not be reached or returned an error: ${err.message}. Strictly discarding competitor.`);
      return null;
    }

    if (!socials.instagram && !socials.youtube && !socials.linkedin && !socials.facebook) {
      logger.warn(`Website ${comp.url} has NO social media links in its DOM/footer. Strictly discarding competitor as requested.`);
      return null;
    }

    // Return the competitor even if social media scraping failed
    return {
      name: comp.name,
      url: comp.url,
      type: comp.type,
      location: comp.location,
      evidenceUrls: comp.evidenceUrls,
      socials
    };
  }
}
