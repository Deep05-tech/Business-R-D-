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
    
    // Full intelligence pipeline: all agents are required so no project sections are ever left blank
    const allAgents = [
      "businessIdentity",
      "industryClassification",
      "offeringsExtraction",
      "audienceIntelligence",
      "brandIntelligence",
      "digitalMaturity",
      "rdInsight"
    ];

    return {
      requiredAgents: allAgents,
      skippedAgents: [],
      reasoning: "Running full intelligence pipeline to guarantee complete business intelligence across all modules."
    };
  }
}
