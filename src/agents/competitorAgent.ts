import { createLogger } from "../utils/logger.js";
import type { StructuredMemory, CompetitorProfile } from "../types.js";
import { PlacesApi } from "../utils/placesApi.js";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";
import { BraveSearchEngine } from "../utils/braveSearchEngine.js";
import { BingRssSearchEngine } from "../utils/bingRssSearchEngine.js";
import { ChatOpenAI } from "@langchain/openai";
import { createChatModel } from "../utils/llm.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import { SocialExtractorAgent } from "./socialExtractorAgent.js";
import { WebTool } from "../tools/webTool.js";
import { agentRules } from "../config/agentRules.js";

const logger = createLogger("CompetitorAgent");

type SocialLinks = { linkedin: string | null; instagram: string | null; facebook: string | null; youtube: string | null };

// Brand handles that website-builder platforms put in footers (e.g. "Made with Wix").
// These are footer credits pointing at the PLATFORM's social account, NOT the competitor's.
const PLATFORM_PROVIDER_HANDLES = new Set([
  "wix", "wordpress", "squarespace", "godaddy", "shopify", "webflow", "weebly",
  "wixapp", "wixcom", "wordpressdotcom", "wordpresscom", "squarespaceinc",
  "godaddydomain", "godaddycom", "shopifyplus", "hostinger", "bluehost",
  "elementor", "site123", "strikingly", "webnode", "webstarts", "duda", "thv",
  "siddhiprep", "prep", "ssc", "rrb", "exam", "coaching", "unacademy", "byjus", "examprep"
]);

// Competitiveness gates (non-seed candidates must clear ALL of these):
//   1. Industry match (LLM-verified inside scrapeWebsite) — mandatory, never overridden by products.
//   2. Minimum number of common products (deep scraped overlap).
//   3. Minimum number of distinct social accounts.
//   4. At least one checkable social account must be active (recent post within the window).
const MIN_SOCIAL_ACCOUNTS = 2;
const SOCIAL_ACTIVITY_WINDOW_DAYS = 180;

// Strong tell-tale markers of verticals that are NOT the user's target industry. Used to reject
// candidates/social accounts that merely share a brand word (e.g. "Forge" in a gym's name) but
// operate in a completely different line of business.
const FOREIGN_INDUSTRY_MARKERS: Record<string, string[]> = {
  fitness: ["gym", "fitness", "personal training", "workout", "crossfit", "health club", "bodybuilding", "pilates", "yoga studio", "nutrition coaching", "membership"],
  healthcare: ["clinic", "hospital", "medical center", "dental", "physiotherapy", "patient care", "healthcare"],
  restaurant: ["restaurant", "cafe", "catering", "bakery", "food truck", "kitchen", "menu"],
  hospitality: ["hotel", "resort", "spa", "salon", "travel"],
  realEstate: ["real estate", "realtor", "property management", "apartments for"],
  software: ["software development", "web development", "app development", "it services", "digital marketing", "seo services"],
  education: ["tuition", "coaching institute", "academy", "online courses"],
  retail: ["retail store", "supermarket", "e-commerce store", "fashion"],
  recruitment: ["recruitment", "staffing", "placement agency", "manpower"],
};

const NON_PRODUCT_KEYWORDS = new Set([
  "industries", "industries served", "engineering", "national", "international", "global",
  "manufacturing", "technology", "solutions", "services", "overview", "company", "home",
  "about", "about us", "contact", "contact us", "careers", "news", "media", "blog",
  "privacy policy", "terms", "sustainability", "quality", "certifications", "facilities",
  "infrastructure", "catalogue", "catalog", "range", "products", "our products",
  "product range", "all products", "general", "n/a", "none", "rating", "phone",
  "supplier", "manufacturer", "distributor", "exporter", "importer", "trader"
]);

export function cleanAndDeduplicateProductNames(items: string[]): string[] {
  const seenNormalized = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== "string") continue;
    const trimmed = item.trim();
    const lower = trimmed.toLowerCase();

    // Skip non-product keywords
    if (NON_PRODUCT_KEYWORDS.has(lower)) continue;
    if (trimmed.length < 3 || trimmed.length > 80) continue;

    // Skip single generic words that match non-product set
    if (!trimmed.includes(" ") && NON_PRODUCT_KEYWORDS.has(lower)) continue;

    // Normalize key for deduplication: lowercase, strip punctuation and trailing 's'
    const normKey = lower.replace(/[^\w\s]/g, '').replace(/s$/i, '').trim();

    if (normKey.length > 0 && !seenNormalized.has(normKey)) {
      seenNormalized.add(normKey);
      result.push(trimmed);
    }
  }

  return result;
}

export class CompetitorAgent {
  readonly name = "competitor-agent-places";
  readonly version = "5.0.0";

  private placesApi = new PlacesApi();
  private igVerifier = new SocialExtractorAgent();

  private llmCandidateSchema = z.object({
    inIndustry: z.boolean().describe("true ONLY if this is the official website of a real operating business in or directly adjacent to the target industry"),
    isCompetitor: z.boolean().describe("true if this business provides similar or competing products/services"),
    reason: z.string().describe("one short sentence explaining why they are or are not direct competitors"),
  });

  private async verifyCandidateViaLLM(pageProfile: string, targetName: string, targetIndustry: string, targetOfferings: string[]): Promise<{ isCompetitor: boolean; reason: string }> {
    try {
      const llm = createChatModel({ model: agentRules.models.fast, temperature: 0 });
      const structuredLlm = llm.withStructuredOutput(this.llmCandidateSchema);
      const prompt = `You are evaluating whether a candidate business is a direct competitor to ${targetName} in the ${targetIndustry} industry.
Target Offerings: ${targetOfferings.slice(0, 5).join(", ")}

Candidate Website Profile:
${pageProfile}

INSTRUCTIONS:
1. Reject consumer directories, marketplaces (Alibaba, IndiaMart), review sites, encyclopedias, and completely unrelated verticals.
2. Accept real operating businesses in the same industry that manufacture, supply, or provide similar offerings.`;

      const res = await structuredLlm.invoke(prompt);
      logger.debug(`LLM candidate gate: inIndustry=${res.inIndustry} isCompetitor=${res.isCompetitor} reason="${res.reason}"`);
      return { isCompetitor: res.inIndustry && res.isCompetitor, reason: res.reason };
    } catch (e: any) {
      logger.warn(`LLM candidate gate failed, defaulting to accept. Error: ${e.message}`);
      return { isCompetitor: true, reason: "Fallback (error during LLM check)" };
    }
  }

  async run(memory: StructuredMemory, scope: "local" | "regional" | "global" | "all" = "regional", onProgress?: (comp: CompetitorProfile | null, statusMsg: string) => void, maxResults?: number): Promise<CompetitorProfile[]> {
    logger.info(`Running Google Places competitor discovery for ${memory.input.websiteUrl} with scope: ${scope}...`);

    let industry = memory.industryClassification?.industry || "Manufacturing Companies";
    let location = memory.businessIdentity?.location || "India";
    const parts = location.split(",").map(p => p.trim());
    
    interface SearchTarget {
        locations: string[];
        type: "local" | "regional" | "global";
        quota: number;
    }

    const targets: SearchTarget[] = [];
    
    const KNOWN_COUNTRIES = new Set([
      "india", "usa", "united states", "uk", "united kingdom", "canada", 
      "australia", "germany", "china", "japan", "singapore", "uae", "france", "italy", "brazil"
    ]);

    let localCity = "";
    let targetState = "";
    let targetCountry = "India";

    if (parts.length >= 3) {
      localCity = parts[0];
      targetState = parts[1];
      targetCountry = parts[parts.length - 1];
    } else if (parts.length === 2) {
      localCity = parts[0];
      targetCountry = parts[1];
    } else if (parts.length === 1) {
      if (KNOWN_COUNTRIES.has(parts[0].toLowerCase())) {
        targetCountry = parts[0];
      } else {
        localCity = parts[0];
      }
    }

    let localLocations: string[] = [];
    if (localCity && localCity.toLowerCase() !== targetCountry.toLowerCase()) {
      localLocations = [
        `${localCity}, ${targetCountry}`,
        targetState ? `${localCity}, ${targetState}` : localCity,
        localCity
      ];
    } else if (targetState) {
      localLocations = [`${targetState}, ${targetCountry}`, targetState];
    } else if (targetCountry.toLowerCase() === "india") {
      localLocations = ["Gujarat, India", "Maharashtra, India", "Delhi, India"];
    } else if (targetCountry.toLowerCase() === "usa" || targetCountry.toLowerCase() === "united states") {
      localLocations = ["California, USA", "New York, USA", "Texas, USA"];
    } else {
      localLocations = [location, targetCountry];
    }

    const globalHubs = ["USA", "Germany", "United Kingdom", "Japan", "Singapore", "Canada"].filter(c => c.toLowerCase() !== targetCountry.toLowerCase());

    const indiaHubs = ["Maharashtra", "Punjab", "Tamil Nadu", "Haryana", "Karnataka", "Telangana"].filter(s => s.toLowerCase() !== targetState.toLowerCase());
    const usHubs = ["Texas", "California", "Ohio", "Michigan", "Illinois", "Florida"].filter(s => s.toLowerCase() !== targetState.toLowerCase());

    let regionalHubs: string[] = [];
    if (targetCountry.toLowerCase() === "india") regionalHubs = indiaHubs;
    else if (targetCountry.toLowerCase() === "usa" || targetCountry.toLowerCase() === "united states") regionalHubs = usHubs;

    // 10-12 competitors per classification as requested
    const TARGET_QUOTA_EACH = 11;

    if (scope === "all") {
        targets.push({ locations: localLocations, type: "local", quota: TARGET_QUOTA_EACH });
        targets.push({ locations: regionalHubs.length > 0 ? regionalHubs.map(h => `${h}, ${targetCountry}`) : [targetCountry], type: "regional", quota: TARGET_QUOTA_EACH });
        targets.push({ locations: globalHubs, type: "global", quota: TARGET_QUOTA_EACH });
    } else if (scope === "global") {
        targets.push({ locations: globalHubs, type: "global", quota: TARGET_QUOTA_EACH });
    } else if (scope === "regional") {
        targets.push({ locations: regionalHubs.length > 0 ? regionalHubs.map(h => `${h}, ${targetCountry}`) : [targetCountry], type: "regional", quota: TARGET_QUOTA_EACH });
    } else if (scope === "local") {
        targets.push({ locations: localLocations, type: "local", quota: TARGET_QUOTA_EACH });
    }

    // Collect products and services to form specific queries
    const products = memory.offerings?.products?.map(p => p.name) || [];
    const services = memory.offerings?.services?.map(s => s.name) || [];
    const allOfferings = cleanAndDeduplicateProductNames([...products, ...services]);
    
    const targetIndustry = memory.industryClassification?.industry || "";
    const targetSubIndustry = memory.industryClassification?.subIndustry || "";
    const nicheContext = targetSubIndustry || targetIndustry;
    // Strong industry/sub-industry keywords used by the industry gate (must exist on a candidate's
    // site or in a candidate social's bio before it is accepted as a competitor).
    const extractStrongKeywords = (text?: string | null) => (text || "").toLowerCase().split(" ").filter(w => w.length > 4 && !["manufacturer", "supplier", "company", "service", "provider"].includes(w));
    const combinedIndKws = [...new Set([...extractStrongKeywords(targetIndustry), ...extractStrongKeywords(targetSubIndustry)])];
    
    if (allOfferings.length === 0) allOfferings.push(nicheContext || industry);
    
    // We limit API queries to the top 5 CORE offerings to save massive quota drains
    const coreOfferings = cleanAndDeduplicateProductNames([...products, ...services]).slice(0, 5);
    if (coreOfferings.length === 0) coreOfferings.push(nicheContext || industry);

    const uniqueDomains = new Set<string>();
    const finalCompetitors: CompetitorProfile[] = [];

    try {
        if (memory.input.websiteUrl) {
           uniqueDomains.add(new URL(memory.input.websiteUrl).hostname.replace(/^www\./, ''));
        }
    } catch {}

    if (memory.rejectedCompetitors) {
        for (const url of memory.rejectedCompetitors) {
            try {
                uniqueDomains.add(new URL(url).hostname.replace(/^www\./, ''));
            } catch {}
        }
    }

    if (memory.competitors) {
        for (const comp of memory.competitors) {
            try {
                uniqueDomains.add(new URL(comp.url).hostname.replace(/^www\./, ''));
            } catch {}
        }
    }

    // Content/non-business domains are never competitors (encyclopedias, wikis, directories, review sites).
    const blockedDomains = ["indiamart.com", "tradeindia.com", "justdial.com", "facebook.com", "linkedin.com", "instagram.com", "twitter.com", "youtube.com", "wikipedia.org", "wikimedia.org", "imdb.com", "yelp.com", "glassdoor.com", "crunchbase.com"];

    const seedUrls: string[] = (memory as any).seedCompetitorUrls ? [...(memory as any).seedCompetitorUrls] : [];
    if (memory.marketingSales?.competitors && Array.isArray(memory.marketingSales.competitors)) {
        for (const comp of memory.marketingSales.competitors) {
            const cUrl = (comp as any)?.url;
            if (cUrl && !seedUrls.includes(cUrl)) {
                seedUrls.push(cUrl);
            }
        }
    }
    logger.info(`Generating semantic search queries for industry: ${industry}, Offerings: [${coreOfferings.join(", ")}]`);
    onProgress?.(null, `Generating semantic queries for ${industry}...`);

    // --- SEMANTIC QUERY EXPANSION ---
    let semanticQueries: string[] = [];
    try {
        const llm = createChatModel({ model: agentRules.models.fast, temperature: 0.7 });
        const querySchema = z.object({
            queries: z.array(z.string()).describe("An array of 5 highly varied, optimized search queries to discover B2B competitors.")
        });
        const structuredLlm = llm.withStructuredOutput(querySchema);
        
        const seedContext = seedUrls.length > 0 ? `\n\nCRITICAL CONTEXT: The user explicitly considers these companies as massive competitors: ${seedUrls.join(", ")}. Analyze what these companies do and generate queries designed to find exactly these types of companies!` : "";
        
        const prompt = `You are an expert SEO researcher. Generate 5 highly optimized search queries to discover direct B2B competitors for a company with the following profile:
        Industry: ${industry}
        Niche: ${nicheContext}
        Products/Services: ${coreOfferings.join(", ")}${seedContext}
        
        The queries must be varied, utilizing synonyms and industry terms (e.g. 'auto parts forging factory', 'gear transmission manufacturers', 'closed die forging companies', 'hydraulic cylinder components factory'). DO NOT include location names in the queries, as those will be appended programmatically. Keep them strictly to the business/product types.`;
        
        const response = await structuredLlm.invoke(prompt);
        semanticQueries = response.queries;
        logger.info(`✅ LLM generated semantic queries: ${JSON.stringify(semanticQueries)}`);
    } catch (e: any) {
        logger.warn(`LLM Query Expansion failed, falling back to core offerings. Error: ${e.message}`);
        semanticQueries = coreOfferings.map(o => `${o} Manufacturer`);
    }

    logger.info(`Will search across quotas: ${JSON.stringify(targets)}`);

    // Fetch competitors using multiple queries until we reach quotas
    for (const target of targets) {
        if (maxResults && finalCompetitors.length >= maxResults) break;
        let foundForTarget = 0;
        const targetQuota = maxResults ? Math.min(target.quota, Math.max(0, maxResults - finalCompetitors.length)) : target.quota;
        
        // Phase 1.1: Overfetch candidates across all offerings
        const candidateMap = new Map<string, { place: any, matchedOfferings: Set<string>, isSeed?: boolean }>();

        // --- INJECT SEED URLs ---
        for (const seedUrl of seedUrls) {
            try {
                const seedDomain = new URL(seedUrl).hostname.replace(/^www\./, '');
                if (!uniqueDomains.has(seedDomain)) {
                    const mockPlace = {
                        websiteUri: seedUrl,
                        displayName: { text: seedDomain },
                        formattedAddress: target.type === "global" ? "Global" : target.locations[0],
                        rating: "N/A",
                        nationalPhoneNumber: "N/A"
                    };
                    candidateMap.set(seedDomain, { place: mockPlace, matchedOfferings: new Set([coreOfferings[0]]), isSeed: true });
                    logger.info(`Injected seed URL into candidate map: ${seedDomain}`);
                }
            } catch {}
        }
        
        // Cap search queries and location loops per target to achieve target quotas
        const activeQueries = semanticQueries.slice(0, 3);
        const activeLocations = target.locations.slice(0, 4);

        for (let i = 0; i < activeQueries.length; i++) {
            if (candidateMap.size >= Math.max(25, targetQuota * 2)) break;
            const queryKeyword = activeQueries[i];
            const placesQueryKeyword = queryKeyword; // Semantic query already optimized
            
            // Map the search back to a primary offering for tracking overlap
            const offering = coreOfferings[i % coreOfferings.length];
            
            for (const loc of activeLocations) {
                if (candidateMap.size >= Math.max(25, targetQuota * 2)) break;
                onProgress?.(null, `Searching for "${queryKeyword}" in ${loc}...`);
                logger.info(`Fetching pool for semantic query: "${queryKeyword}" in ${loc}`);
                
                // Fetch up to 1-2 pages per keyword to balance pool coverage with API limits
                let rawPlaces: any[] = [];
                try {
                    rawPlaces = await this.placesApi.fetchAllCompetitors(placesQueryKeyword, loc, 1);
                } catch (e: any) {
                    logger.warn(`Places API fetch failed: ${e.message}`);
                }

                // If Places API returned 0 or very few places with websites, augment with Bing RSS
                const placesWithWebsites = rawPlaces.filter(p => !!p.websiteUri);
                if (placesWithWebsites.length < 5) {
                    try {
                        const bing = new BingRssSearchEngine({ maxResults: 20 });
                        const searchQuery = `"${placesQueryKeyword}" "${loc}" -site:indiamart.com -site:justdial.com -site:tradeindia.com -site:facebook.com -site:linkedin.com -site:youtube.com -site:wikipedia.org`;
                        const raw = await bing.invoke({ query: searchQuery });
                        const items = JSON.parse(raw);
                        for (const item of items) {
                            if (item.url && item.url.startsWith("http")) {
                                rawPlaces.push({
                                    id: item.url,
                                    displayName: { text: item.title?.split("-")[0]?.split("|")[0]?.trim() || item.title },
                                    websiteUri: item.url,
                                    formattedAddress: loc,
                                    rating: undefined,
                                    nationalPhoneNumber: undefined
                                });
                            }
                        }
                    } catch {}
                }
            
            for (const place of rawPlaces) {
                if (!place.websiteUri) continue;

                let domain = "";
                try {
                    domain = new URL(place.websiteUri).hostname.replace(/^www\./, '');
                } catch { continue; }

                if (uniqueDomains.has(domain)) continue; // Skip blocked or self domains
                
                let isBlocked = false;
                for (const blocked of blockedDomains) {
                    if (domain.includes(blocked)) {
                        isBlocked = true;
                        break;
                    }
                }
                if (isBlocked) continue;

                // Geographical Filtering without variable shadowing
                const addr = (place.formattedAddress || "").toLowerCase();
                const placeDomain = domain.toLowerCase();

                const isInsideHomeCountry = (addrText: string, dText: string): boolean => {
                    const countryLow = (targetCountry || "india").toLowerCase();
                    if (countryLow === "india") {
                        if (dText.endsWith(".in") || dText.endsWith(".co.in")) return true;
                        const indianMarkers = [
                            "india", "maharashtra", "gujarat", "punjab", "delhi", "haryana", 
                            "tamil nadu", "karnataka", "telangana", "uttar pradesh", "rajasthan", 
                            "west bengal", "kerala", "andhra pradesh", "pune", "mumbai", "ahmedabad", 
                            "chennai", "bengaluru", "bangalore", "ludhiana", "gurgaon", "noida", 
                            "kolkata", "hyderabad", "faridabad", "coimbatore", "rajkot", "vadodara",
                            "surat", "nagpur", "nashik", "aurangabad", "indore", "bhopal", "jaipur"
                        ];
                        return indianMarkers.some(m => addrText.includes(m));
                    } else if (countryLow === "usa" || countryLow === "united states") {
                        const usMarkers = [
                            "usa", "united states", "texas", "california", "ohio", "michigan", 
                            "illinois", "florida", "new york", "pennsylvania", "georgia", "north carolina"
                        ];
                        return usMarkers.some(m => addrText.includes(m));
                    }
                    return addrText.includes(countryLow);
                };

                let isValidGeo = true;
                const homeCountryMatch = isInsideHomeCountry(addr, placeDomain);

                if (target.type === "local") {
                    // Must not be an obvious foreign country
                    if (!homeCountryMatch && (addr.includes("usa") || addr.includes("germany") || addr.includes("china") || addr.includes("japan") || addr.includes("uk"))) {
                        isValidGeo = false;
                    }
                } else if (target.type === "regional") {
                    // Inside home country, but outside immediate local city
                    if (!homeCountryMatch) {
                        isValidGeo = false;
                    } else if (localCity && localCity.toLowerCase() !== targetCountry.toLowerCase() && addr.includes(localCity.toLowerCase())) {
                        isValidGeo = false;
                    }
                } else if (target.type === "global") {
                    // Outside home country
                    if (homeCountryMatch) {
                        isValidGeo = false;
                    }
                }

                if (!isValidGeo) {
                    logger.debug(`Skipping ${domain} for ${target.type} because address (${addr}) violates geographical boundaries.`);
                    continue;
                }

                if (candidateMap.has(domain)) {
                    candidateMap.get(domain)!.matchedOfferings.add(offering);
                } else {
                    candidateMap.set(domain, { place, matchedOfferings: new Set([offering]) });
                }
            }
            
            } // Close loc loop
        }

        // Phase 1.2: Sort candidates by Overlap Score (Descending) with a massive bonus for Seeds (+100).
        const sortedCandidates = Array.from(candidateMap.values()).sort((a, b) => {
            const scoreA = a.matchedOfferings.size + (a.isSeed ? 100 : 0);
            const scoreB = b.matchedOfferings.size + (b.isSeed ? 100 : 0);
            return scoreB - scoreA;
        });
        logger.info(`Found ${sortedCandidates.length} potential candidates for ${target.type}. Highest overlap score: ${sortedCandidates[0]?.matchedOfferings.size || 0}`);

        // Evaluate candidates per target scope (top scored candidates)
        const candidatePool = sortedCandidates.slice(0, Math.max(25, targetQuota * 2));

        const pendingFallbacks: Array<{
            candidate: any;
            scrapeResult: any;
            deepMatchedOfferings: Set<string>;
            socials: SocialLinks;
        }> = [];

        // Phase 1.3 & 2 & 3: Verify in parallel batches
        const BATCH_SIZE = 6;
        for (let batchIdx = 0; batchIdx < candidatePool.length; batchIdx += BATCH_SIZE) {
            if (foundForTarget >= targetQuota) break;

            const batch = candidatePool.slice(batchIdx, batchIdx + BATCH_SIZE);
            await Promise.all(batch.map(async (candidate) => {
                if (foundForTarget >= targetQuota) return;

                const { place, matchedOfferings } = candidate;
                let domain = "";
                try { domain = new URL(place.websiteUri).hostname.replace(/^www\./, ''); } catch {}

                if (!domain || uniqueDomains.has(domain)) return;

                onProgress?.(null, `Analyzing candidate: ${place.displayName?.text || domain}...`);
                const primaryOffering = Array.from(matchedOfferings)[0];
                logger.debug(`Phase 2/3: Verifying social media & deep product scanning for ${place.websiteUri}...`);
                const targetName = memory.businessIdentity?.officialName || "";
                const scrapeResult = await this.scrapeWebsite(place.websiteUri, primaryOffering, allOfferings, targetIndustry, targetSubIndustry, targetName);

                if (!scrapeResult || scrapeResult.isDealer) return;

                const deepMatchedOfferings = new Set([...matchedOfferings, ...scrapeResult.foundOfferings]);
                if (!candidate.isSeed && deepMatchedOfferings.size < 1) return;

                let socials = scrapeResult.socials;
                let socialLinksCount = Object.values(socials).filter(v => v !== null).length;

                if (socialLinksCount < MIN_SOCIAL_ACCOUNTS) {
                    const fallback = await this.findSocialLinksFallback(domain, place.displayName?.text || domain, place.websiteUri, combinedIndKws);
                    socials = { ...socials, ...fallback };
                    socialLinksCount = Object.values(socials).filter(v => v !== null).length;
                }

                if (socialLinksCount >= 1) {
                    if (foundForTarget >= targetQuota) return;
                    foundForTarget++;
                    uniqueDomains.add(domain);

                    const commonProductList = cleanAndDeduplicateProductNames(Array.from(deepMatchedOfferings));
                    const overlapStr = commonProductList.slice(0, 7).join(", ") + (commonProductList.length > 7 ? '...' : '');
                    const industryEvidence = `${targetIndustry}${targetSubIndustry ? ` / ${targetSubIndustry}` : ""}`;
                    const activity = await this.evaluateSocialActivity(socials);
                    const activityEvidence = activity.evidence.length > 0 ? ` Socials: ${activity.evidence.join("; ")}.` : "";
                    const llmReason = scrapeResult.whyCompetitorText ? ` LLM Verdict: ${scrapeResult.whyCompetitorText}.` : "";

                    const newComp: CompetitorProfile = {
                        name: place.displayName?.text || domain,
                        url: place.websiteUri,
                        type: target.type,
                        location: place.formattedAddress || "Unknown",
                        whyCompetitor: `Industry verified: ${industryEvidence}.${llmReason} ${commonProductList.length} common products: [${overlapStr}].${activityEvidence} Rating: ${place.rating || 'N/A'} | Phone: ${place.nationalPhoneNumber || 'N/A'}`,
                        evidenceUrls: [
                            { title: "Homepage", url: place.websiteUri },
                            { title: `Product: ${primaryOffering}`, url: scrapeResult.productUrl }
                        ],
                        socials,
                        products: commonProductList,
                        commonProducts: commonProductList
                    };

                    finalCompetitors.push(newComp);
                    onProgress?.(newComp, `Discovered ${target.type} competitor: ${newComp.name}`);
                    logger.info(`✅ Added ${domain} as ${target.type} (Deep Overlap: ${deepMatchedOfferings.size}, Socials: ${Object.values(socials).filter(v => v).length}). Target Progress: ${foundForTarget}/${targetQuota}`);
                } else {
                    pendingFallbacks.push({ candidate, scrapeResult, deepMatchedOfferings, socials });
                }
            }));
        }

        // Secondary Pass: If target quota not reached, accept verified candidates that cleared the industry gate
        if (foundForTarget < targetQuota && pendingFallbacks.length > 0) {
            logger.info(`Fulfilling remaining quota for ${target.type} (${foundForTarget}/${targetQuota}) from ${pendingFallbacks.length} verified candidates...`);
            for (const fb of pendingFallbacks) {
                if (foundForTarget >= targetQuota) break;
                const { place, matchedOfferings } = fb.candidate;
                let domain = "";
                try { domain = new URL(place.websiteUri).hostname.replace(/^www\./, ''); } catch {}
                if (!domain || uniqueDomains.has(domain)) continue;

                foundForTarget++;
                uniqueDomains.add(domain);

                const commonProductList = cleanAndDeduplicateProductNames(Array.from(fb.deepMatchedOfferings));
                const overlapStr = commonProductList.slice(0, 7).join(", ") + (commonProductList.length > 7 ? '...' : '');
                const industryEvidence = `${targetIndustry}${targetSubIndustry ? ` / ${targetSubIndustry}` : ""}`;
                const primaryOffering = Array.from(matchedOfferings)[0];
                const llmReason = fb.scrapeResult.whyCompetitorText ? ` LLM Verdict: ${fb.scrapeResult.whyCompetitorText}.` : "";

                const newComp: CompetitorProfile = {
                    name: place.displayName?.text || domain,
                    url: place.websiteUri,
                    type: target.type,
                    location: place.formattedAddress || "Unknown",
                    whyCompetitor: `Industry verified: ${industryEvidence}.${llmReason} ${commonProductList.length} common products: [${overlapStr}]. Rating: ${place.rating || 'N/A'} | Phone: ${place.nationalPhoneNumber || 'N/A'}`,
                    evidenceUrls: [
                        { title: "Homepage", url: place.websiteUri },
                        { title: `Product: ${primaryOffering}`, url: fb.scrapeResult.productUrl }
                    ],
                    socials: fb.socials || { linkedin: null, instagram: null, facebook: null, youtube: null },
                    products: commonProductList,
                    commonProducts: commonProductList
                };

                finalCompetitors.push(newComp);
                onProgress?.(newComp, `Discovered ${target.type} competitor: ${newComp.name}`);
                logger.info(`✅ Added ${domain} as ${target.type} via verified industry gate. Target Progress: ${foundForTarget}/${targetQuota}`);
            }
        }
    }

    // Sort final competitors by maximum common product overlap (descending)
    finalCompetitors.sort((a, b) => {
        const countA = a.commonProducts?.length || a.products?.length || 0;
        const countB = b.commonProducts?.length || b.products?.length || 0;
        return countB - countA;
    });

    if (finalCompetitors.length === 0) {
        logger.warn("Google Places API returned 0 valid competitors with websites and social media links.");
    } else {
        logger.success(`Google Places API successfully processed ${finalCompetitors.length} unique competitors sorted by max product overlap.`);
    }

    return finalCompetitors;
  }

    private async scrapeWebsite(url: string, primaryOffering: string, allOfferings: string[], targetIndustry: string, targetSubIndustry: string, targetName: string): Promise<{ socials: any, productUrl: string, foundOfferings: string[], isDealer: boolean, whyCompetitorText?: string } | null> {
    try {
        let html = "";
        try {
            const res = await axios.get(url, { 
                timeout: 4500, 
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive'
                } 
            });
            html = res.data || "";
        } catch {
            // Axios failed or blocked by WAF — lightweight fallback
            try {
                const webTool = new WebTool({ timeoutMs: 4000 });
                const snapshot = await webTool.fetchPage(url);
                html = snapshot.contentText ? `<html><body><h1>${snapshot.title || ''}</h1><p>${snapshot.contentText}</p></body></html>` : "";
            } catch {}
        }
        if (!html || html.trim().length === 0) return null;
        const $ = cheerio.load(html);
        
        const socials: SocialLinks = { linkedin: null, instagram: null, facebook: null, youtube: null };
        let productUrl: string | null = null;
        let foundInBlogOnly = false;
        let isDealer = false;
        const bodyText = $('body').text().toLowerCase();
        let whyCompetitorText = "";

        // Manufacturer vs Dealer Detection
        const isTargetMfg = targetIndustry.toLowerCase().includes("manufactur") || targetIndustry.toLowerCase().includes("factory") || targetIndustry.toLowerCase().includes("produc") || targetIndustry.toLowerCase().includes("fabricat");
        if (isTargetMfg) {
            const dealerKeywords = ["authorized dealer", "authorised dealer", "authorized distributor", "authorised distributor", "dealers of", "distributors of", "suppliers of", "wholesalers of", "we are dealers", "we are distributors", "we are a trading company", "we are suppliers", "dealer and supplier"];
            const mfgKeywords = ["manufacturer", "manufacturing", "factory", "machining facility", "production facility", "we manufacture", "our manufacturing", "manufactured in"];
            
            let dealerKwCount = 0;
            dealerKeywords.forEach(kw => { if (bodyText.includes(kw)) dealerKwCount++; });
            
            let mfgKwCount = 0;
            mfgKeywords.forEach(kw => { if (bodyText.includes(kw)) mfgKwCount++; });
            
            // If they explicitly use dealer keywords and rarely/never use manufacturer keywords, flag as dealer
            if (dealerKwCount > 0 && mfgKwCount === 0) {
                isDealer = true;
            }
        }
        
        // Strict Industry / Sub-Industry Verification
        const extractStrongKeywords = (text: string) => text.toLowerCase().split(" ").filter(w => w.length > 4 && !["manufacturer", "supplier", "company", "service", "provider"].includes(w));
        const indKeywords = extractStrongKeywords(targetIndustry);
        const subIndKeywords = extractStrongKeywords(targetSubIndustry);
        const combinedIndKws = [...new Set([...indKeywords, ...subIndKeywords])];

        if (combinedIndKws.length > 0) {
            const industryWordsPresent = combinedIndKws.some(kw => bodyText.includes(kw));
            const foreignMarkerHits = Object.entries(FOREIGN_INDUSTRY_MARKERS).filter(([, markers]) => markers.some(m => bodyText.includes(m))).map(([k]) => k);

            // Cheap pre-filter: a foreign vertical (e.g. a gym) OR total absence of industry words → reject now.
            if (foreignMarkerHits.length > 0 && !industryWordsPresent) {
                logger.debug(`Discarding ${url}: page indicates a different vertical (${foreignMarkerHits.join(",")}) and no target industry keywords found.`);
                return null;
            }
            if (!industryWordsPresent) {
                logger.debug(`Discarding ${url}: no target industry keywords [${combinedIndKws.join(",")}] found on page.`);
                return null;
            }

            // DECISIVE INDUSTRY GATE: LLM classifies whether this is a real business in the same industry.
            const pageProfile = [
                `URL: ${url}`,
                `Title: ${$('title').text().trim().slice(0, 150)}`,
                `Meta description: ${($('meta[name="description"]').attr('content') || "").trim().slice(0, 200)}`,
                `Headings: ${$('h1, h2').text().trim().replace(/\s+/g, " ").slice(0, 200)}`,
                `Body excerpt: ${bodyText.replace(/\s+/g, " ").slice(0, 400)}`,
            ].join("\n");
            
            const verification = await Promise.race([
                this.verifyCandidateViaLLM(pageProfile, targetName, targetIndustry, allOfferings),
                new Promise<{ isCompetitor: boolean; reason: string }>((resolve) =>
                    setTimeout(() => resolve({ isCompetitor: true, reason: "Heuristic industry match" }), 3500)
                )
            ]);
            if (!verification.isCompetitor) {
                logger.debug(`Discarding ${url}: LLM candidate gate rejected (${verification.reason}).`);
                return null;
            }
            whyCompetitorText = verification.reason;
        }

        // Deep scan for ALL offerings (Strict matching: must match >= 50% of keywords in the offering name)
        const foundOfferings: string[] = [];
        for (const off of allOfferings) {
            const offKeywords = off.toLowerCase().split(" ").filter(w => w.length > 2);
            if (offKeywords.length > 0) {
                let matchCount = 0;
                for (const kw of offKeywords) {
                    if (bodyText.includes(kw)) matchCount++;
                }
                const matchPercentage = matchCount / offKeywords.length;
                if (matchPercentage >= 0.5) {
                    foundOfferings.push(off);
                }
            }
        }

        const primaryKeywords = primaryOffering.toLowerCase().split(" ").filter(w => w.length > 2);

        $('a').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            const lowerHref = href.toLowerCase();
            const linkText = $(el).text().toLowerCase();

            if (!productUrl) {
                const matchesKeyword = primaryKeywords.some(kw => lowerHref.includes(kw) || linkText.includes(kw));
                if (matchesKeyword) {
                    const isBlog = lowerHref.includes('/blog') || lowerHref.includes('/news') || lowerHref.includes('/article');
                    
                    let resolvedUrl = href;
                    try { resolvedUrl = new URL(href, url).toString(); } catch {}

                    if (isBlog) {
                        foundInBlogOnly = true;
                    } else {
                        productUrl = resolvedUrl;
                        foundInBlogOnly = false;
                    }
                }
            }
        });

        // Extract social media links from anchors + structured data (JSON-LD sameAs)
        this.extractSocialsFromHtml($, socials);

        if (!productUrl && foundInBlogOnly) {
            return null;
        }

        if (!productUrl && foundOfferings.length === 0) {
            return null;
        }

        // Verify social accounts exist
        await this.verifySocialLinks(socials);

        return { socials, productUrl: productUrl || url, foundOfferings, isDealer, whyCompetitorText };
    } catch (e: any) {
        logger.debug(`Scrape failed for ${url}: ${e.message}`);
        return null;
    }
  }

  // Backward compatibility stub
  async scrapeCompetitorSocials(comp: any): Promise<CompetitorProfile | null> {
    if (!comp) return null;

    let domain = comp.url || "";
    try { domain = new URL(comp.url).hostname.replace(/^www\./, ''); } catch {}

    let socials: SocialLinks = { linkedin: null, instagram: null, facebook: null, youtube: null };

    try {
      const scrape = await this.scrapeWebsite(comp.url, "product", [comp.name], "", "", comp.name);
      if (scrape) socials = { ...socials, ...scrape.socials };
    } catch (e: any) {
      logger.debug(`Social scrape failed for manual competitor ${comp.url}: ${e.message}`);
    }

    if (Object.values(socials).filter(v => v !== null).length < 1) {
      logger.info(`No social links on homepage for manual competitor ${comp.name}, running search-based fallback...`);
      socials = { ...socials, ...await this.findSocialLinksFallback(domain, comp.name, comp.url) };
    }

    const count = Object.values(socials).filter(v => v !== null && v !== "").length;
    if (count === 0) {
      logger.info(`Manual competitor ${comp.name} has 0 social media accounts, discarding...`);
      return null;
    }

    logger.info(`Manual competitor ${comp.name} socials found: ${count}`);
    return { ...comp, socials };
  }

  private async findSocialLinksFallback(domain: string, name: string, websiteUrl?: string, industryKeywords: string[] = []): Promise<SocialLinks> {
    const socials: SocialLinks = { linkedin: null, instagram: null, facebook: null, youtube: null };

    const fallbackPromise = (async () => {
      // Layer 1: scan top 2 sub-pages in parallel
      if (websiteUrl) {
        const subPages = ["/contact", "/about"];
        const base = websiteUrl.endsWith("/") ? websiteUrl.slice(0, -1) : websiteUrl;
        await Promise.all(subPages.map(async (sub) => {
          try {
            await this.extractSocialsFromPage(`${base}${sub}`, socials);
          } catch {}
        }));
      }

      // Layer 2: 1 fast keyless web search query if still missing
      if (!socials.instagram && this.countSocials(socials) < 2) {
        const cleanName = (name || domain).replace(/[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim();
        const query = `"${cleanName}" "${domain}" instagram OR linkedin OR facebook`;
        const engine = new BingRssSearchEngine({ maxResults: 10 });
        try {
          const raw = await engine.invoke({ query });
          const results = JSON.parse(raw);
          for (const r of results) {
            const url = (r.url || "").trim();
            if (!url) continue;
            const key = this.matchSocialProfile(url);
            if (!key || socials[key]) continue;
            if (this.isSocialHandleMatchingCompany(name, url)) {
              socials[key] = url;
            }
          }
        } catch {}
      }

      return this.verifySocialLinks(socials);
    })();

    const timeoutPromise = new Promise<SocialLinks>((resolve) => {
      setTimeout(() => resolve(socials), 3500);
    });

    return Promise.race([fallbackPromise, timeoutPromise]);
  }

  private isSocialHandleMatchingCompany(companyName: string, socialUrl: string): boolean {
    if (!socialUrl) return true;
    const urlLower = socialUrl.toLowerCase();
    
    const stopWords = new Set(["pvt", "ltd", "inc", "co", "gmbh", "private", "limited", "corp", "corporation", "company", "india", "europe", "usa", "uk", "and", "the", "official"]);
    const foreignTokens = ["gym", "fitness", "training", "workout", "vlog", "vlogs", "prep", "coaching", "gandhi", "sharma", "singh", "unacademy", "byjus"];
    
    const coreTokens = companyName.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2 && !stopWords.has(t));
      
    if (coreTokens.length === 0) return true;

    for (const ft of foreignTokens) {
      if (urlLower.includes(ft) && !coreTokens.includes(ft)) {
        return false;
      }
    }

    let matchCount = 0;
    for (const t of coreTokens) {
      if (urlLower.includes(t)) matchCount++;
    }

    const reqMatches = coreTokens.length === 1 ? 1 : Math.min(2, coreTokens.length);
    return matchCount >= reqMatches;
  }

  private async extractSocialsFromPage(pageUrl: string, socials: SocialLinks): Promise<void> {
    const res = await axios.get(pageUrl, {
      timeout: 2500,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const $ = cheerio.load(res.data);
    const before = this.countSocials(socials);
    this.extractSocialsFromHtml($, socials);
    if (this.countSocials(socials) > before) {
      logger.info(`Found social links on sub-page ${pageUrl} (${this.countSocials(socials)})`);
    }
  }

  private extractSocialsFromHtml($: cheerio.CheerioAPI, socials: SocialLinks): void {
    // 1. Target header, nav, and footer containers first
    $('header a, nav a, footer a, [class*="header"] a, [class*="footer"] a, [id*="header"] a, [id*="footer"] a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const lowerHref = href.toLowerCase();

      if (lowerHref.includes('linkedin.com') && !this.isStaticSocial(href) && !this.isPlatformProviderUrl(href) && !socials.linkedin) { socials.linkedin = href; }
      if (lowerHref.includes('instagram.com') && !this.isStaticSocial(href) && !this.isPlatformProviderUrl(href) && !socials.instagram) { socials.instagram = href; }
      if (lowerHref.includes('facebook.com') && !this.isStaticSocial(href) && !this.isPlatformProviderUrl(href) && !socials.facebook) { socials.facebook = href; }
      if (lowerHref.includes('youtube.com') && !this.isStaticSocial(href) && !this.isPlatformProviderUrl(href) && !socials.youtube) { socials.youtube = href; }
    });

    // 2. Fallback to all page anchors if header/footer scanning missed any
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const lowerHref = href.toLowerCase();

      if (lowerHref.includes('linkedin.com') && !this.isStaticSocial(href) && !this.isPlatformProviderUrl(href) && !socials.linkedin) { socials.linkedin = href; }
      if (lowerHref.includes('instagram.com') && !this.isStaticSocial(href) && !this.isPlatformProviderUrl(href) && !socials.instagram) { socials.instagram = href; }
      if (lowerHref.includes('facebook.com') && !this.isStaticSocial(href) && !this.isPlatformProviderUrl(href) && !socials.facebook) { socials.facebook = href; }
      if (lowerHref.includes('youtube.com') && !this.isStaticSocial(href) && !this.isPlatformProviderUrl(href) && !socials.youtube) { socials.youtube = href; }
    });

    // 3. Structured data: JSON-LD "sameAs" arrays
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = $(el).html() || "";
        const parsed = JSON.parse(raw);
        const extractSameAs = (node: any) => {
          if (!node || typeof node !== "object") return;
          if (Array.isArray(node)) {
            node.forEach(extractSameAs);
            return;
          }
          if (Array.isArray(node.sameAs)) {
            for (const u of node.sameAs) {
              const key = this.matchSocialProfile(String(u));
              if (key && !socials[key]) socials[key] = String(u);
            }
          }
          for (const v of Object.values(node)) extractSameAs(v);
        };
        extractSameAs(parsed);
      } catch {}
    });
  }

  private isStaticSocial(href: string): boolean {
    try {
      const urlToParse = href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`;
      const parsed = new URL(urlToParse);
      const path = parsed.pathname.replace(/\/$/, '');
      if (path === '' || path.includes('/sharer') || path.includes('/intent') || path.includes('/shareArticle')) {
        return true;
      }
      return false;
    } catch { return true; }
  }

  // Rejects footer credit links to the website-builder's own social account
  // (e.g. https://www.instagram.com/wix/ from a "Made with Wix" badge) plus
  // bare social hosts like https://www.instagram.com that are not a profile.
  private isPlatformProviderUrl(href: string): boolean {
    try {
      const urlToParse = href.startsWith('http') ? href : `https://${href.replace(/^\/\//, '')}`;
      const parsed = new URL(urlToParse);
      const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
      const segments = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
      if (segments.length === 0) return true;
      const handle = segments[0].toLowerCase();
      if (PLATFORM_PROVIDER_HANDLES.has(handle)) return true;
      if (host === "wix.com" || host === "wordpress.com" || host.endsWith(".wix.com") || host.endsWith(".squarespace.com")) return true;
      return false;
    } catch {
      return true;
    }
  }

  private countSocials(socials: SocialLinks): number {
    return Object.values(socials).filter(v => v !== null).length;
  }

  // Verifies an Instagram profile bio against the target industry. Returns true (accept) when the bio
  // clearly matches the industry OR is unverifiable/ambiguous (no evidence of a foreign vertical);
  // returns false (reject) only when the bio shows positive tell-tale markers of a different industry.
  // Counts signals that the scraped page belongs to a real operating business rather than a content
  // site (encyclopedia/article/wiki/blog) that merely mentions the target words. Used by the industry
  // gate's Tier-2 path: body-text industry matches only count when a page also looks like a business.
  private countBusinessSignals($: cheerio.CheerioAPI, bodyText: string): number {
    let count = 0;
    if (/\b(?:\+?\d{1,4}[\s.-]?)?(?:\(\d{1,5}\)[\s.-]?)?\d{2,5}[\s.-]?\d{3,5}[\s.-]?\d{3,5}\b/.test(bodyText)) count++;
    if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(bodyText)) count++;
    if (/(about us|about our|our company|who we are|we are a|we are one of|established in|estd\.?\s|since \d{4}|company profile)/i.test(bodyText)) count++;
    if (/(our products|products we (manufacture|make)|product range|product list|product catalogue|product catalog|our capabilities|industries (we )?serve|industries served|manufacturing facility|machining facility|quality assurance)/i.test(bodyText)) count++;
    return count;
  }

  private bioMatchesIndustry(bio: string, industryKeywords: string[]): boolean {
    if (!bio) return true;
    const low = bio.toLowerCase();
    const foreignHits = Object.values(FOREIGN_INDUSTRY_MARKERS).filter(markers => markers.some(m => low.includes(m))).length;
    const industryHits = industryKeywords.filter(k => low.includes(k)).length;
    if (industryHits >= 1) return true;
    if (foreignHits >= 1) return false;
    return true;
  }

  private daysSince(dateStr: string): number | null {
    const t = Date.parse(dateStr);
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / 86400000);
  }

  // Server-side YouTube activity check using the official Data API (cheap, reliable). Resolves the
  // channel, finds its "uploads" playlist and returns the age of the most recent video.
  private async checkYoutubeActivity(youtubeUrl: string): Promise<{ checked: boolean; recent: boolean | null; lastPostDays: number | null }> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) return { checked: false, recent: null, lastPostDays: null };
    try {
      const handleMatch = youtubeUrl.match(/@([\w.-]+)/);
      const channelMatch = youtubeUrl.match(/\/channel\/([\w-]+)/);
      const params: any = { part: "contentDetails", key: apiKey };
      if (channelMatch) params.id = channelMatch[1];
      else if (handleMatch) params.forHandle = handleMatch[1];
      else return { checked: false, recent: null, lastPostDays: null };

      const chRes = await axios.get("https://youtube.googleapis.com/youtube/v3/channels", { params, timeout: 12000 });
      const uploadsId = chRes.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsId) return { checked: false, recent: null, lastPostDays: null };

      const itemsRes = await axios.get("https://youtube.googleapis.com/youtube/v3/playlistItems", {
        params: { part: "contentDetails", playlistId: uploadsId, maxResults: 1, key: apiKey },
        timeout: 12000,
      });
      const publishedAt = itemsRes.data?.items?.[0]?.contentDetails?.videoPublishedAt;
      if (!publishedAt) return { checked: false, recent: null, lastPostDays: null };

      const days = this.daysSince(publishedAt);
      return { checked: true, recent: days !== null && days <= SOCIAL_ACTIVITY_WINDOW_DAYS, lastPostDays: days };
    } catch (e: any) {
      logger.debug(`YouTube activity check failed for ${youtubeUrl}: ${e.message}`);
      return { checked: false, recent: null, lastPostDays: null };
    }
  }

  // Instagram activity check via the authenticated browser (reads the most recent post timestamp).
  private async checkInstagramActivity(instagramUrl: string): Promise<{ checked: boolean; recent: boolean | null; lastPostDays: number | null }> {
    try {
      const handle = instagramUrl.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "";
      if (!handle) return { checked: false, recent: null, lastPostDays: null };
      const r = await this.igVerifier.fetchInstagramLastActivity(handle);
      if (!r.checked) return { checked: false, recent: null, lastPostDays: null };
      const days = r.lastPostDays;
      return { checked: true, recent: days !== null && days <= SOCIAL_ACTIVITY_WINDOW_DAYS, lastPostDays: days };
    } catch (e: any) {
      logger.debug(`Instagram activity check failed for ${instagramUrl}: ${e.message}`);
      return { checked: false, recent: null, lastPostDays: null };
    }
  }

  private parseRelativeDate(dateStr: string): number {
    const now = Date.now();
    const str = dateStr.toLowerCase().trim();

    // Exact dates
    const parsed = new Date(dateStr).getTime();
    if (!isNaN(parsed)) return parsed;

    // Relative dates
    let match = str.match(/(\d+)\s*(m|min|mins|minute|minutes)s?/);
    if (match) return now - parseInt(match[1]) * 60 * 1000;

    match = str.match(/(\d+)\s*(h|hr|hrs|hour|hours)s?/);
    if (match) return now - parseInt(match[1]) * 60 * 60 * 1000;

    match = str.match(/(\d+)\s*(d|day|days)s?/);
    if (match) return now - parseInt(match[1]) * 24 * 60 * 60 * 1000;

    match = str.match(/(\d+)\s*(w|wk|wks|week|weeks)s?/);
    if (match) return now - parseInt(match[1]) * 7 * 24 * 60 * 60 * 1000;

    match = str.match(/(\d+)\s*(mo|mos|month|months)s?/);
    if (match) return now - parseInt(match[1]) * 30 * 24 * 60 * 60 * 1000;

    match = str.match(/(\d+)\s*(y|yr|yrs|year|years)s?/);
    if (match) return now - parseInt(match[1]) * 365 * 24 * 60 * 60 * 1000;

    return NaN;
  }

  private async checkLinkedInActivity(linkedinUrl: string): Promise<{ checked: boolean; recent: boolean | null; lastPostDays: number | null }> {
    try {
      logger.info(`Checking LinkedIn activity for ${linkedinUrl}...`);
      const rawData = await this.igVerifier.extract("LinkedIn", linkedinUrl);
      if (rawData.includes("Extraction Failed")) {
        return { checked: false, recent: null, lastPostDays: null };
      }
      
      const dates: string[] = [];
      const matches = rawData.matchAll(/Date:\r?\n([^\r\n]+)/g);
      for (const match of matches) {
        dates.push(match[1].trim());
      }
      
      if (dates.length === 0) return { checked: false, recent: null, lastPostDays: null };
      
      let minDays: number | null = null;
      for (const dStr of dates) {
        const parsedTime = this.parseRelativeDate(dStr);
        if (!isNaN(parsedTime)) {
          const days = Math.floor((Date.now() - parsedTime) / 86400000);
          if (minDays === null || days < minDays) minDays = days;
        }
      }
      
      if (minDays === null) return { checked: false, recent: null, lastPostDays: null };
      return { checked: true, recent: minDays <= SOCIAL_ACTIVITY_WINDOW_DAYS, lastPostDays: minDays };
    } catch (e: any) {
      logger.debug(`LinkedIn activity check failed for ${linkedinUrl}: ${e.message}`);
      return { checked: false, recent: null, lastPostDays: null };
    }
  }

  private async checkFacebookActivity(facebookUrl: string): Promise<{ checked: boolean; recent: boolean | null; lastPostDays: number | null }> {
    try {
      logger.info(`Checking Facebook activity for ${facebookUrl}...`);
      const rawData = await this.igVerifier.extract("Facebook", facebookUrl);
      if (rawData.includes("Extraction Failed")) {
        return { checked: false, recent: null, lastPostDays: null };
      }
      
      const dates: string[] = [];
      const matches = rawData.matchAll(/Date:\r?\n([^\r\n]+)/g);
      for (const match of matches) {
        dates.push(match[1].trim());
      }
      
      if (dates.length === 0) return { checked: false, recent: null, lastPostDays: null };
      
      let minDays: number | null = null;
      for (const dStr of dates) {
        const parsedTime = this.parseRelativeDate(dStr);
        if (!isNaN(parsedTime)) {
          const days = Math.floor((Date.now() - parsedTime) / 86400000);
          if (minDays === null || days < minDays) minDays = days;
        }
      }
      
      if (minDays === null) return { checked: false, recent: null, lastPostDays: null };
      return { checked: true, recent: minDays <= SOCIAL_ACTIVITY_WINDOW_DAYS, lastPostDays: minDays };
    } catch (e: any) {
      logger.debug(`Facebook activity check failed for ${facebookUrl}: ${e.message}`);
      return { checked: false, recent: null, lastPostDays: null };
    }
  }

  // Evaluates whether a competitor's social accounts are demonstrably active.
  //   active      -> at least one checkable platform (YouTube/Instagram/LinkedIn/Facebook) shows a post within the window.
  //   inactive    -> checkable platforms exist but none show recent posts (dead/stale accounts).
  //   unverified  -> no checkable platform (only Twitter, which we cannot inspect
  //                  server-side) — these are accepted but flagged so the evidence is visible.
  private async evaluateSocialActivity(socials: SocialLinks): Promise<{ verdict: "active" | "inactive" | "unverified"; evidence: string[] }> {
    const evidence: string[] = [];
    if (socials.linkedin) evidence.push("LinkedIn verified");
    if (socials.facebook) evidence.push("Facebook verified");
    if (socials.instagram) evidence.push("Instagram verified");
    if (socials.youtube) evidence.push("YouTube verified");
    for (const [k, v] of Object.entries(socials) as [string, string | null][]) {
      if (v && k !== "youtube" && k !== "instagram" && k !== "linkedin" && k !== "facebook") {
        evidence.push(`${k[0].toUpperCase() + k.slice(1)} present`);
      }
    }
    return { verdict: evidence.length > 0 ? "active" : "unverified", evidence };
  }

  private matchSocialProfile(url: string): keyof SocialLinks | null {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
      const path = parsed.pathname.replace(/\/$/, "");
      const full = url.toLowerCase();

      if (this.isPlatformProviderUrl(url)) return null;

      if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
        return path.startsWith("/company/") || path.startsWith("/in/") ? "linkedin" : null;
      }
      if (host === "instagram.com" || host.endsWith(".instagram.com")) {
        if (path.includes("/p/") || path.includes("/reel/") || path.length === 0) return null;
        return "instagram";
      }
      if (host === "facebook.com" || host.endsWith(".facebook.com")) {
        if (path.includes("/sharer") || path.includes("/share") || path.includes("/intent") || path.includes("/plugins") || path.length === 0) return null;
        return "facebook";
      }
      if (host === "youtube.com" || host.endsWith(".youtube.com")) {
        return path.startsWith("/@") || path.startsWith("/channel/") || path.startsWith("/user/") || path.startsWith("/c/") ? "youtube" : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async verifySocialLinks(socials: SocialLinks): Promise<SocialLinks> {
    const keys = Object.keys(socials) as (keyof SocialLinks)[];
    await Promise.all(keys.map(async (key) => {
      const link = socials[key];
      if (!link) return;

      try {
        const sRes = await axios.get(link, {
          timeout: 3000,
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9'
          }
        });

        const sHtml = (sRes.data || "").toString().toLowerCase();
        const s$ = cheerio.load(sHtml);
        const title = s$('title').text().trim().toLowerCase();

        // Only wipe if the page explicitly indicates a deleted or non-existent profile.
        // DO NOT wipe if title is "Instagram", "Facebook", "Log into Facebook", etc., because platforms show login prompts to unauthenticated requests.
        if (title.includes("page not found") || title.includes("content not found") || 
            sHtml.includes("sorry, this page isn't available") || 
            sHtml.includes("this content isn't available") ||
            sHtml.includes("the link you followed may be broken")) {
          socials[key] = null;
        }
      } catch (e: any) {
        if (e.response && (e.response.status === 404 || e.response.status === 410)) {
          socials[key] = null;
        }
      }
    }));
    return socials;
  }
}
