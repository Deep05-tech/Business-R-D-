import { describe, expect, it } from "vitest";
import { QcAgent } from "./qcAgent.js";
import type { BusinessIntelligenceProfile } from "../types.js";

const baseProfile: Omit<BusinessIntelligenceProfile, "qc"> = {
  businessIdentitySummary: {
    officialName: "Example",
    aliases: [],
    industry: "Technology",
    subIndustry: "Software",
    businessModel: "B2B SaaS",
  },
  industryClassification: {
    industry: "Technology",
    subIndustry: "Software",
    businessModel: "B2B SaaS",
  },
  offeringsBreakdown: {
    products: ["Analytics platform"],
    services: [],
    valuePropositions: ["Analytics platform for teams"],
  },
  audienceProfile: {
    buyerPersonas: ["Business decision makers"],
    geographies: [],
    targetIndustries: ["Technology"],
  },
  brandPositioning: {
    tone: "Professional",
    positioning: "Analytics platform for teams",
    usps: ["Analytics platform for teams"],
    messagingStyle: "Customer-outcome focused",
  },
  digitalMaturityReport: {
    score: 75,
    websiteQuality: { score: 75, signals: [] },
    seoReadiness: { score: 75, signals: [], gaps: [] },
    socialActivity: { score: 75, signals: [] },
  },
  rdInsights: {
    opportunities: [],
    gaps: [],
    improvements: [],
  },
  structuredJsonMemoryObject: {
    generatedAt: "2026-06-19T00:00:00.000Z",
    input: { websiteUrl: "https://example.com/", socialUrls: [] },
    businessIdentity: {
      officialName: "Example",
      aliases: [],
      industry: "Technology",
      subIndustry: "Software",
      businessModel: "B2B SaaS",
    },
    industryClassification: {
      industry: "Technology",
      subIndustry: "Software",
      businessModel: "B2B SaaS",
    },
    offerings: {
      products: ["Analytics platform"],
      services: [],
      valuePropositions: ["Analytics platform for teams"],
    },
    audience: {
      buyerPersonas: ["Business decision makers"],
      geographies: [],
      targetIndustries: ["Technology"],
    },
    brandPositioning: {
      tone: "Professional",
      positioning: "Analytics platform for teams",
      usps: ["Analytics platform for teams"],
      messagingStyle: "Customer-outcome focused",
    },
    digitalMaturity: {
      score: 75,
      websiteQuality: { score: 75, signals: [] },
      seoReadiness: { score: 75, signals: [], gaps: [] },
      socialActivity: { score: 75, signals: [] },
    },
    rdInsights: {
      opportunities: ["Expand into new verticals"],
      gaps: [],
      improvements: [],
    },
    agentDiagnostics: [
      { agent: "web-scraper-agent", version: "v2", confidence: "high", warnings: [] },
      { agent: "semantic-cleaning-agent", version: "v2", confidence: "high", warnings: [] },
      { agent: "business-identity-agent", version: "v2", confidence: "high", warnings: [] },
      { agent: "offerings-extraction-agent", version: "v2", confidence: "high", warnings: [] },
      { agent: "web-intelligence-agent", version: "v2", confidence: "high", warnings: [] },
    ],
    sourceMap: [
      {
        url: "https://example.com/",
        field: "businessIdentity.officialName",
        evidence: "Example",
        confidence: "high",
        inferred: false,
      },
      {
        url: "https://example.com/",
        field: "homepage.businessSummary",
        evidence: "Analytics platform for teams",
        confidence: "high",
        inferred: false,
      },
      {
        url: "https://example.com/",
        field: "seo.metaTitle",
        evidence: "Example — Analytics",
        confidence: "high",
        inferred: false,
      },
      {
        url: "https://example.com/",
        field: "offerings.products",
        evidence: "Analytics platform",
        confidence: "medium",
        inferred: false,
      },
      {
        url: "https://example.com/",
        field: "offerings.services",
        evidence: "Data consulting",
        confidence: "medium",
        inferred: false,
      },
      {
        url: "https://example.com/",
        field: "businessIdentity.industry",
        evidence: "Technology sector",
        confidence: "medium",
        inferred: true,
      },
      {
        url: "https://example.com/",
        field: "brand.positioning",
        evidence: "Analytics platform for teams",
        confidence: "medium",
        inferred: false,
      },
    ],
  },
};

describe("QcAgent", () => {
  it("passes a complete consistent profile", () => {
    const report = new QcAgent().validate(baseProfile, 1);
    expect(report.passed).toBe(true);
  });

  it("returns a numeric confidenceScore between 0 and 1", () => {
    const report = new QcAgent().validate(baseProfile, 1);
    expect(typeof report.confidenceScore).toBe("number");
    expect(report.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(report.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("fails when industry fields disagree", () => {
    const profile = structuredClone(baseProfile);
    profile.structuredJsonMemoryObject.industryClassification.industry = "Healthcare";
    const report = new QcAgent().validate(profile, 1);
    expect(report.passed).toBe(false);
    expect(new QcAgent().retryModules(report)).toContain("identity");
  });

  it("fails when a product is a noisy label", () => {
    const profile = structuredClone(baseProfile);
    profile.structuredJsonMemoryObject.offerings.products.push("products");
    const report = new QcAgent().validate(profile, 1);
    const noiseIssue = report.issues.find((i) => i.message.includes("UI/navigation noise"));
    expect(noiseIssue).toBeTruthy();
  });
});
