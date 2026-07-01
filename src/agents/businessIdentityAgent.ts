import { agentRules } from "../config/agentRules.js";
import type { AgentResult, BusinessIdentity, PageSnapshot, SemanticWebData, SocialIntelligence, SourceRef } from "../types.js";
import { compactText, unique } from "../utils/text.js";
import { ChatOpenAI } from "@langchain/openai";

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
class IndustryClassificationAgent {
  readonly name = "industry-classification-agent";

  run(text: string): Pick<BusinessIdentity, "industry" | "subIndustry" | "businessModel"> & { sourceEvidence: string | null } {
    for (const rule of agentRules.industry) {
      if (new RegExp(rule.pattern, "i").test(text)) {
        return {
          industry: rule.industry,
          subIndustry: rule.subIndustry,
          businessModel: rule.businessModel,
          sourceEvidence: text.match(new RegExp(`.{0,80}(?:${rule.pattern}).{0,80}`, "i"))?.[0] ?? text.slice(0, 180),
        };
      }
    }
    return { industry: null, subIndustry: null, businessModel: null, sourceEvidence: null };
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

    // AI Fallback for exact business name (crucial for OCR text where titles/JSON-LD are missing)
    if (!resolvedName.value || resolvedName.value.toLowerCase().includes("pdf")) {
      try {
        const llm = new ChatOpenAI({ model: "gpt-4o-mini", temperature: 0.0 });
        const prompt = `Extract the official business or company name from the following text. Do not include legal suffixes like LLC or Pvt Ltd unless necessary. Output ONLY the company name, nothing else. If you cannot find a clear business name, output "UNKNOWN".\n\nTEXT:\n${combinedText.substring(0, 6000)}`;
        const response = await llm.invoke(prompt);
        const extractedName = response.content.toString().trim();
        
        if (extractedName && extractedName !== "UNKNOWN" && extractedName.length > 2) {
          resolvedName = {
            value: extractedName,
            source: {
              url: pages[0]?.url ?? "",
              field: "businessIdentity.officialName",
              evidence: `LLM Extraction: ${extractedName}`,
              confidence: "high",
              inferred: true,
            }
          };
        }
      } catch (e) {
        // Silent catch, fallback to null/domain
      }
    }

    const classification = this.industryClassifier.run(combinedText);

    const data: BusinessIdentity = {
      officialName: resolvedName.value,
      aliases: unique([
        ...(resolvedName.value ? [] : semantic.metadata.titles),
        ...social.profiles.flatMap((p) => p.identitySignals.slice(0, 1)),
      ]).filter((v) => v && v !== resolvedName.value),
      industry: classification.industry,
      subIndustry: classification.subIndustry,
      businessModel: classification.businessModel,
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
