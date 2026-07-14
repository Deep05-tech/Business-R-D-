import { AudienceIntelligenceAgent } from "./audienceIntelligenceAgent.js";
import { BrandIntelligenceAgent } from "./brandIntelligenceAgent.js";
import { BusinessIdentityAgent } from "./businessIdentityAgent.js";
import { DigitalMaturityAgent } from "./digitalMaturityAgent.js";
import { OfferingsExtractionAgent } from "./offeringsExtractionAgent.js";
import { RdInsightAgent } from "./rdInsightAgent.js";
import { SemanticCleaningAgent } from "./semanticCleaningAgent.js";
import { SocialIntelligenceAgent } from "./socialIntelligenceAgent.js";
import { WebIntelligenceAgent } from "./webIntelligenceAgent.js";
import { WebScraperAgent } from "./webScraperAgent.js";
import { AiContentAgent } from "./aiContentAgent.js";
import { MarketingSalesAgent } from "./marketingSalesAgent.js";
import { DiagnosticAgent } from "./diagnosticAgent.js";
import { WebTool } from "../tools/webTool.js";

export interface AgentRegistry {
  webScraper: WebScraperAgent;
  semanticCleaning: SemanticCleaningAgent;
  webIntelligence: WebIntelligenceAgent;
  socialIntelligence: SocialIntelligenceAgent;
  businessIdentity: BusinessIdentityAgent;
  offerings: OfferingsExtractionAgent;
  aiContent: AiContentAgent;
  audience: AudienceIntelligenceAgent;
  brand: BrandIntelligenceAgent;
  digital: DigitalMaturityAgent;
  rd: RdInsightAgent;
  marketingSales: MarketingSalesAgent;
  diagnostic: DiagnosticAgent;
}

export function createAgentRegistry(webTool = new WebTool()): AgentRegistry {
  return {
    webScraper: new WebScraperAgent(webTool),
    semanticCleaning: new SemanticCleaningAgent(),
    webIntelligence: new WebIntelligenceAgent(),
    socialIntelligence: new SocialIntelligenceAgent(webTool),
    businessIdentity: new BusinessIdentityAgent(),
    offerings: new OfferingsExtractionAgent(),
    aiContent: new AiContentAgent(),
    audience: new AudienceIntelligenceAgent(),
    brand: new BrandIntelligenceAgent(),
    digital: new DigitalMaturityAgent(),
    rd: new RdInsightAgent(),
    marketingSales: new MarketingSalesAgent(),
    diagnostic: new DiagnosticAgent(),
  };
}
