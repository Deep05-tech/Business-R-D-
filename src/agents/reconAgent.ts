import type { PageSnapshot } from "../types.js";
import { compactText } from "../utils/text.js";

export interface ReconDag {
  requiredAgents: string[];
  skippedAgents: string[];
  reasoning: string;
}

export class ReconAgent {
  public name = "Reconnaissance Agent";

  /**
   * Scans the homepage and returns a Directed Acyclic Graph (DAG) of required agents.
   * e.g., skips R&D insights for local mom-and-pop shops.
   */
  public generateDag(homepage: PageSnapshot): ReconDag {
    const text = compactText(`${homepage.title} ${homepage.metaDescription} ${homepage.headings.join(" ")}`).toLowerCase();
    
    // Heuristic: Local business / restaurant detection
    const isLocalBusiness = /(restaurant|menu|cafe|bakery|salon|plumbing|roofing|hvac|landscaping|dental|clinic)/i.test(text);

    // Default agents
    const allAgents = [
      "businessIdentity",
      "industryClassification",
      "offeringsExtraction",
      "audienceIntelligence",
      "brandIntelligence",
      "digitalMaturity",
      "rdInsight"
    ];

    if (isLocalBusiness) {
      return {
        requiredAgents: allAgents.filter(a => a !== "rdInsight" && a !== "digitalMaturity"),
        skippedAgents: ["rdInsight", "digitalMaturity"],
        reasoning: "Detected local B2C service/hospitality business. Skipping R&D Insights and Digital Maturity as they are mostly irrelevant."
      };
    }

    return {
      requiredAgents: allAgents,
      skippedAgents: [],
      reasoning: "Detected standard B2B/B2C entity. Running full intelligence pipeline."
    };
  }
}
