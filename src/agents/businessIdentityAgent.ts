import { agentRules } from "../config/agentRules.js";
import type { AgentResult, BusinessIdentity, PageSnapshot, SemanticWebData, SocialIntelligence, SourceRef } from "../types.js";
import { compactText, unique } from "../utils/text.js";
import { ChatOpenAI } from "@langchain/openai";
import { TavilySearch } from "@langchain/tavily";
import { z } from "zod";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";

/** Names that are never valid business names (nav labels / generic page names) */
const NAME_BLACKLIST = /^(home|products?|services?|solutions?|features?|welcome|menu|about|contact|login|sign\s*in|get\s*started|learn\s*more|read\s*more|skip\s*to\s*content)$/i;

// ---------------------------------------------------------------------------
// JSON-LD Name Extractor (HIGHEST PRIORITY per specification)
// ---------------------------------------------------------------------------
class JsonLdNameExtractor {
  extract(jsonLdBlocks: string[]): string | null {
    for (const raw of jsonLdBlocks) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const name = this.findName(parsed);
        if (name) return name;
      } catch {
        // malformed JSON-LD — skip
      }
    }
    return null;
  }

  private findName(value: unknown): string | null {
    if (!value || typeof value !== "object") return null;

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findName(item);
        if (found) return found;
      }
      return null;
    }

    const record = value as Record<string, unknown>;
    const type = record["@type"];
    const types = Array.isArray(type) ? type : [type];

    // Target organization / business entities
    const isOrgType = types.some(
      (t) =>
        typeof t === "string" &&
        /^(Organization|LocalBusiness|Corporation|Store|Restaurant|Hotel|MedicalOrganization|ProfessionalService|EntertainmentBusiness|HealthAndBeautyBusiness|SportsActivityLocation|LodgingBusiness|FoodEstablishment)$/i.test(t),
    );

    if (isOrgType && typeof record["name"] === "string") {
      const name = compactText(record["name"]);
      if (name && !NAME_BLACKLIST.test(name) && name.length >= 2 && name.length <= 80) {
        return name;
      }
    }

    // Recurse into nested objects
    for (const val of Object.values(record)) {
      if (val && typeof val === "object") {
        const found = this.findName(val);
        if (found) return found;
      }
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Name Resolution Agent — strict priority cascade
// ---------------------------------------------------------------------------
class NameResolutionAgent {
  readonly name = "name-resolution-agent";
  private readonly jsonLdExtractor = new JsonLdNameExtractor();

  run(pages: PageSnapshot[], semantic: SemanticWebData, social: SocialIntelligence): { value: string | null; source: SourceRef | null } {
    const homepage = pages[0];

    // Priority 1: JSON-LD structured data (most reliable)
    const allJsonLd = pages.flatMap((page) => page.jsonLdBlocks);
    const jsonLdName = this.jsonLdExtractor.extract(allJsonLd);
    if (jsonLdName) {
      return {
        value: jsonLdName,
        source: {
          url: homepage?.url ?? "",
          field: "businessIdentity.officialName",
          evidence: `JSON-LD: ${jsonLdName}`,
          confidence: "high",
          inferred: false,
        },
      };
    }

    // Priority 2: Logo text (alt or aria-label)
    const logoName = this.cleanName(homepage?.logoText);
    if (logoName) {
      return {
        value: logoName,
        source: {
          url: homepage?.url ?? "",
          field: "businessIdentity.officialName",
          evidence: `Logo: ${logoName}`,
          confidence: "high",
          inferred: false,
        },
      };
    }

    // Priority 3: H1 from an "About" page (more reliable than homepage H1)
    const aboutPage = pages.find((page) => page.pageType === "about");
    const aboutH1 = this.cleanName(aboutPage?.headings[0]);
    if (aboutH1) {
      return {
        value: aboutH1,
        source: {
          url: aboutPage!.url,
          field: "businessIdentity.officialName",
          evidence: `About page H1: ${aboutH1}`,
          confidence: "high",
          inferred: false,
        },
      };
    }

    // Priority 4: Homepage H1 (if it's not a generic marketing headline)
    const homepageH1 = this.cleanName(homepage?.headings[0]);
    if (homepageH1 && this.looksLikeBusinessName(homepageH1)) {
      return {
        value: homepageH1,
        source: {
          url: homepage?.url ?? "",
          field: "businessIdentity.officialName",
          evidence: `Homepage H1: ${homepageH1}`,
          confidence: "medium",
          inferred: false,
        },
      };
    }

    // Priority 5: Meta title (strip separators)
    const titleName = this.cleanName(homepage?.title);
    if (titleName) {
      return {
        value: titleName,
        source: {
          url: homepage?.url ?? "",
          field: "businessIdentity.officialName",
          evidence: `Meta title: ${titleName}`,
          confidence: "medium",
          inferred: false,
        },
      };
    }

    // Priority 6: Social identity signals
    const socialName = social.profiles.find((p) => p.identitySignals[0])?.identitySignals[0];
    const cleanSocial = this.cleanName(socialName);
    if (cleanSocial) {
      return {
        value: cleanSocial,
        source: {
          url: social.profiles[0]?.url ?? "",
          field: "businessIdentity.officialName",
          evidence: `Social: ${cleanSocial}`,
          confidence: "medium",
          inferred: true,
        },
      };
    }

    // Priority 7: Domain fallback (lowest confidence)
    const domainName = this.nameFromDomain(homepage?.url);
    if (domainName) {
      return {
        value: domainName,
        source: {
          url: homepage?.url ?? "",
          field: "businessIdentity.officialName",
          evidence: `Domain: ${domainName}`,
          confidence: "low",
          inferred: true,
        },
      };
    }

    return { value: null, source: null };
  }

  private cleanName(value: string | null | undefined): string | null {
    if (!value) return null;

    // Strip "logo" word and trim
    let output = compactText(value.replace(/\blogo\b/gi, ""));

    // Strip everything after common separators (| - • :)
    for (const separator of agentRules.identity.titleSeparators) {
      output = output.split(separator)[0] ?? output;
    }

    output = compactText(output);
    if (!output || output.length < 2 || output.length > 80) return null;

    // Reject blacklisted nav-style names
    if (NAME_BLACKLIST.test(output)) return null;

    return output;
  }

  /** Returns true if the string looks like a company name rather than a marketing tagline */
  private looksLikeBusinessName(value: string): boolean {
    // Reject if it's a sentence / tagline (has > 4 words and contains verbs)
    const words = value.split(/\s+/);
    if (words.length > 5) return false;
    if (/\b(we|our|your|the|a |an )\b/i.test(value)) return false;
    return true;
  }

  private nameFromDomain(url: string | undefined): string | null {
    if (!url) return null;
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      const base = hostname.split(".")[0] ?? "";
      if (!base) return null;
      return base
        .split(/[-_]/)
        .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
        .join(" ");
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Industry Classification Agent
// ---------------------------------------------------------------------------
const IndustrySchema = z.object({
  industry: z.string().describe("The primary macro industry, e.g. 'Manufacturing', 'Technology', 'Healthcare', 'Agriculture'").nullable(),
  subIndustry: z.string().describe("The specific sub-industry or niche, e.g. 'Industrial manufacturing', 'Cybersecurity', 'Seed Distribution'").nullable(),
  businessModel: z.string().describe("The primary business model, e.g. 'B2B manufacturing', 'B2B SaaS', 'B2C commerce', 'B2B services'").nullable(),
  sourceEvidence: z.string().describe("A short quote or sentence from the text proving this classification").nullable()
});

class IndustryClassificationAgent {
  readonly name = "industry-classification-agent";

  async run(text: string): Promise<Pick<BusinessIdentity, "industry" | "subIndustry" | "businessModel"> & { sourceEvidence: string | null }> {
    const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.0 }).withStructuredOutput(IndustrySchema);
    const prompt = `Analyze the following business text and classify its industry.
    
    Determine the macro industry, specific sub-industry/niche, and the primary business model.
    Provide a short snippet of evidence from the text justifying this classification.
    
    Text context:
    ${text}
    `;

    try {
      const result = await llm.invoke(prompt);
      return {
        industry: result.industry || null,
        subIndustry: result.subIndustry || null,
        businessModel: result.businessModel || null,
        sourceEvidence: result.sourceEvidence || null,
      };
    } catch (e) {
      return { industry: null, subIndustry: null, businessModel: null, sourceEvidence: null };
    }
  }
}

// ---------------------------------------------------------------------------
// Public Agent
// ---------------------------------------------------------------------------
export class BusinessIdentityAgent {
  readonly name = "business-identity-agent";
  readonly version = agentRules.version;
  private readonly nameResolver = new NameResolutionAgent();
  private readonly industryClassifier = new IndustryClassificationAgent();

  async run(pages: PageSnapshot[], semantic: SemanticWebData, social: SocialIntelligence): Promise<AgentResult<BusinessIdentity>> {
    const combinedText = [
      ...semantic.metadata.titles,
      ...semantic.metadata.descriptions,
      semantic.combinedText,
      ...social.profiles.flatMap((p) => [p.bio, ...p.identitySignals]),
    ]
      .filter(Boolean)
      .join(" ");

    let resolvedName = this.nameResolver.run(pages, semantic, social);

    const textWithoutBrochure = combinedText.split("=== BROCHURE ===")[0];
    const domainUrl = pages[0]?.url || "Unknown";
    
    const llm = new ChatOpenAI({ model: "gpt-4o", temperature: 0.0 });
    const prompt = `Extract the official business or company name from the following text. You should extract the fully qualified corporate name if available (including suffixes like Ltd, Pvt Ltd, Inc).
CRITICAL RULE: If multiple company names are mentioned (e.g. sister companies, group names), you MUST strictly prioritize the name that most closely matches the website's domain URL (${domainUrl}). Ignore other companies.
Output ONLY the company name, nothing else. If you cannot find a clear business name, output "UNKNOWN".

TEXT:
${textWithoutBrochure}`;

    try {
      const response = await llm.invoke(prompt);
      const extractedName = response.content.toString().trim();
      
      if (extractedName && extractedName !== "UNKNOWN" && extractedName.length > 2) {
        resolvedName = {
          value: extractedName,
          source: {
            url: pages[0]?.url ?? "",
            field: "businessIdentity.officialName",
            evidence: `LLM Extraction prioritizing Domain (${domainUrl}): ${extractedName}`,
            confidence: "high",
            inferred: true,
          }
        };
      }
    } catch (err) {
      // Keep heuristic fallback if LLM crashes
    }

    // --- Extract Business Location ---
    let extractedLocation: string | null = null;
    try {
      const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.0 });
      const prompt = `Extract the physical headquarters location (City, State/Province, Country) of the business from the following text. Look for contact details, footers, or 'About Us' information. If you find multiple locations, use the primary headquarters.
Output ONLY the location in the format "City, State, Country".
If you cannot determine the location, output "UNKNOWN".

TEXT:
TEXT:
${combinedText}`;
      const response = await llm.invoke(prompt);
      const loc = response.content.toString().trim();
      if (loc && loc !== "UNKNOWN" && loc.length > 2) {
        extractedLocation = loc;
      }
    } catch (e) {
      // Silent catch
    }

    // Fallback: Web search for location if not found in text
    if (!extractedLocation && resolvedName.value && resolvedName.value !== "UNKNOWN") {
      try {
        const searchTool = new FreeSearchEngine({ maxResults: 3 });
        const resultRaw = await searchTool.invoke({ query: `${resolvedName.value} headquarters location city country address` });
        const searchContext = typeof resultRaw === "string" ? resultRaw : JSON.stringify(resultRaw);
        
        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.0 });
        const prompt = `Based on these search results, what is the headquarters location (City, State/Province, Country) for the company "${resolvedName.value}"?
Output ONLY the location in the format "City, State, Country".
If you cannot determine the location, output "UNKNOWN".

SEARCH RESULTS:
${searchContext}`;
        const response = await llm.invoke(prompt);
        const loc = response.content.toString().trim();
        if (loc && loc !== "UNKNOWN" && loc.length > 2) {
          extractedLocation = loc;
        }
      } catch (e) {
        // Silent catch
      }
    }

    // --- Extract Business Vision ---
    let extractedVision: string | null = null;
    try {
      const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.1 });
      const prompt = `Extract the overarching Vision, Mission, or core philosophical goal of the business from the following text. Look for 'About Us', 'Our Mission', or 'Our Vision' sections.
Summarize it into a concise, powerful 1-2 sentence statement.
If you cannot determine any clear vision or mission, output "UNKNOWN".

TEXT:
TEXT:
${combinedText}`;
      const response = await llm.invoke(prompt);
      const vis = response.content.toString().trim();
      if (vis && vis !== "UNKNOWN" && vis.length > 5) {
        extractedVision = vis;
      }
    } catch (e) {
      // Silent catch
    }

    // Fallback: Web search for Vision if not found in text
    if (!extractedVision && resolvedName.value && resolvedName.value !== "UNKNOWN") {
      try {
        const searchTool = new FreeSearchEngine({ maxResults: 3 });
        const resultRaw = await searchTool.invoke({ query: `${resolvedName.value} company vision mission statement core values` });
        const searchContext = typeof resultRaw === "string" ? resultRaw : JSON.stringify(resultRaw);
        
        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.1 });
        const prompt = `Based on these search results, what is the overarching Vision, Mission, or core philosophical goal for the company "${resolvedName.value}"?
Summarize it into a concise, powerful 1-2 sentence statement.
If you cannot determine any clear vision or mission, output "UNKNOWN".

SEARCH RESULTS:
${searchContext}`;
        const response = await llm.invoke(prompt);
        const vis = response.content.toString().trim();
        if (vis && vis !== "UNKNOWN" && vis.length > 5) {
          extractedVision = vis;
        }
      } catch (e) {
        // Silent catch
      }
    }

    const classification = await this.industryClassifier.run(combinedText);

    const data: BusinessIdentity = {
      officialName: resolvedName.value,
      aliases: unique([
        ...(resolvedName.value ? [] : semantic.metadata.titles),
        ...social.profiles.flatMap((p) => p.identitySignals.slice(0, 1)),
      ]).filter((v) => v && v !== resolvedName.value),
      industry: classification.industry,
      subIndustry: classification.subIndustry,
      businessModel: classification.businessModel,
      location: extractedLocation,
      vision: extractedVision,
    };

    const sources: SourceRef[] = [];
    if (resolvedName.source) sources.push(resolvedName.source);
    if (classification.industry && classification.sourceEvidence) {
      sources.push({
        url: pages[0]?.url ?? "",
        field: "businessIdentity.industry",
        evidence: classification.sourceEvidence,
        confidence: "medium",
        inferred: true,
      });
    }

    return {
      agent: this.name,
      version: this.version,
      confidence: data.officialName && data.industry ? "high" : data.officialName || data.industry ? "medium" : "low",
      data,
      sources,
      warnings: data.officialName ? [] : ["Could not resolve official business name from any available source (JSON-LD, logo, H1, title, domain)."],
    };
  }
}
