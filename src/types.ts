export type Confidence = "high" | "medium" | "low";

export interface SourceRef {
  url: string;
  field: string;
  evidence: string;
  confidence: Confidence;
  inferred: boolean;
}

export interface AgentResult<T> {
  agent: string;
  version?: string;
  confidence?: Confidence;
  data: T;
  sources: SourceRef[];
  warnings: string[];
}

export interface BusinessInput {
  websiteUrl: string;
  socialUrls: string[];
  brochureText?: string;
}

export interface PageSnapshot {
  url: string;
  status: number;
  title: string | null;
  logoText: string | null;
  metaDescription: string | null;
  metaKeywords: string | null;
  headings: string[];
  links: Array<{ href: string; text: string }>;
  contentText: string;
  navigationText: string[];
  footerText: string[];
  text: string;
  emails: string[];
  phones: string[];
  schemaTypes: string[];
  /** Inferred page purpose: homepage | about | product | service | contact | blog | other */
  pageType: string;
  /** Raw JSON-LD blocks found on this page (unparsed strings) */
  jsonLdBlocks: string[];
}

export interface SemanticWebData {
  pages: Array<{
    url: string;
    title: string | null;
    cleanText: string;
    cleanHeadings: string[];
    removedNoise: string[];
  }>;
  combinedText: string;
  businessHeadings: string[];
  metadata: {
    titles: string[];
    descriptions: string[];
    keywords: string[];
    schemaTypes: string[];
  };
  contact: {
    locations: string[];
    emails: string[];
    phones: string[];
    legitimacySignals: string[];
  };
}

export interface WebIntelligence {
  homepage: {
    businessSummary: string | null;
    headlineMessaging: string[];
    valueProposition: string | null;
  };
  offerings: {
    products: string[];
    services: string[];
    categories: string[];
  };
  seo: {
    metaTitle: string | null;
    metaDescription: string | null;
    keywords: string[];
    schemaSignals: string[];
  };
  contact: {
    locations: string[];
    emails: string[];
    phones: string[];
    legitimacySignals: string[];
  };
  crawledUrls: string[];
}

export interface SocialIntelligence {
  profiles: Array<{
    url: string;
    bio: string | null;
    identitySignals: string[];
    contentThemes: string[];
    visualSignals: string[];
    engagementSignals: string[];
    accessStatus: "fetched" | "blocked" | "failed";
  }>;
}

export interface BusinessIdentity {
  officialName: string | null;
  aliases: string[];
  industry: string | null;
  subIndustry: string | null;
  businessModel: string | null;
}

export interface SubProduct {
  name: string;
  description: string;
}

export interface ProductDetailed {
  name: string;
  category: string;
  description: string;
  keyFeatures: string[];
  technicalSpecs: Record<string, string>;
  useCases: string[];
  exportMarkets: string[];
  subProducts?: SubProduct[];
  aiSocialSummary?: string;
  aiLaymanSummary?: string;
}

export interface ServiceDetailed {
  name: string;
  description: string;
  applications: string[];
  processes: string[];
  aiSocialSummary?: string;
  aiLaymanSummary?: string;
}

export interface ProcessDetailed {
  name: string;
  description: string;
  workflow: string[];
  capacity: string;
  machineryUsed: string[];
  aiSocialSummary?: string;
  aiLaymanSummary?: string;
}

export interface OfferingsIntelligence {
  products: ProductDetailed[];
  services: ServiceDetailed[];
  valuePropositions: string[];
}

export interface ProcessIntelligence {
  processes: ProcessDetailed[];
}

export interface AudienceIntelligence {
  buyerPersonas: string[];
  geographies: string[];
  targetIndustries: string[];
}

export interface BrandIntelligence {
  tone: string | null;
  positioning: string | null;
  usps: string[];
  messagingStyle: string | null;
}

export interface DigitalMaturity {
  score: number;
  websiteQuality: {
    score: number;
    signals: string[];
  };
  seoReadiness: {
    score: number;
    signals: string[];
    gaps: string[];
  };
  socialActivity: {
    score: number;
    signals: string[];
  };
}

export interface RdInsights {
  opportunities: string[];
  gaps: string[];
  improvements: string[];
}

export interface MarketingSalesIntelligence {
  contentStrategy: {
    platforms: string[];
    themes: string[];
    postTypes: string[];
  };
  creativeConcepts: Array<{
    type: "Image" | "Video";
    concept: string;
    description: string;
    targetAudience: string;
  }>;
  competitors: Array<{
    name: string;
    region: string;
    threatLevel: "High" | "Medium" | "Low";
    differentiator: string;
  }>;
  linkedinOutreach: Array<{
    persona: string;
    messages: string[];
  }>;
}

export interface CompetitorProfile {
  name: string;
  url: string;
  type: "local" | "global";
  location: string;
  socials: {
    linkedin: string | null;
    instagram: string | null;
    facebook: string | null;
    twitter: string | null;
    youtube: string | null;
  };
}

export interface StructuredMemory {
  generatedAt: string;
  input: BusinessInput;
  schemaVersion?: string;
  agentDiagnostics: Array<{ agent: string; version: string; confidence: Confidence }>;
  businessIdentity: BusinessIdentity;
  industryClassification: {
    industry: string | null;
    subIndustry: string | null;
    businessModel: string | null;
  };
  offerings: OfferingsIntelligence;
  processes: ProcessIntelligence;
  audience: AudienceIntelligence;
  brandPositioning: BrandIntelligence;
  digitalMaturity: DigitalMaturity;
  rdInsights: RdInsights;
  marketingSales: MarketingSalesIntelligence;
  sourceMap: SourceRef[];
  vectorKnowledgeBase?: {
    facts: Array<{
      text: string;
      source: string;
      tokens: number;
      embedding: number[];
    }>;
  };
  competitors?: CompetitorProfile[];
}

export interface BusinessIntelligenceProfile {
  businessIdentitySummary: BusinessIdentity;
  industryClassification: StructuredMemory["industryClassification"];
  offeringsBreakdown: OfferingsIntelligence;
  processesBreakdown: ProcessIntelligence;
  audienceProfile: AudienceIntelligence;
  brandPositioning: BrandIntelligence;
  digitalMaturityReport: DigitalMaturity;
  rdInsights: RdInsights;
  marketingSales: MarketingSalesIntelligence;
  structuredJsonMemoryObject: StructuredMemory;
  qc: QcReport;
}

export interface QcIssue {
  module: string;
  field: string;
  severity: "error" | "warning";
  message: string;
}

export interface QcReport {
  passed: boolean;
  attempts: number;
  issues: QcIssue[];
  /** 0–1 score representing overall data completeness & source coverage. Must reach 0.85 to pass. */
  confidenceScore: number;
}
