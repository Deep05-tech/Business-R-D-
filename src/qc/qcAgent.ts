import { agentRules } from "../config/agentRules.js";
import type { BusinessIntelligenceProfile, QcIssue, QcReport, SourceRef, StructuredMemory } from "../types.js";
import { createLogger } from "../utils/logger.js";
import { FreeSearchEngine } from "../utils/freeSearchEngine.js";

const logger = createLogger("QC Agent");

const requiredTopLevelFields = agentRules.qc.requiredMemoryFields as unknown as Array<keyof StructuredMemory>;

/**
 * Critical fields that MUST have source-map entries to achieve a high confidence score.
 * Missing any of these reduces the confidenceScore significantly.
 */
const CRITICAL_SOURCE_FIELDS = [
  "businessIdentity.officialName",
  "homepage.businessSummary",
  "seo.metaTitle",
  "offerings.products",
  "offerings.services",
  "businessIdentity.industry",
];

export class QcAgent {
  readonly name = "qc-agent";

  async validate(profile: Omit<BusinessIntelligenceProfile, "qc">, attempts: number): Promise<QcReport> {
    const memory = profile.structuredJsonMemoryObject;

    const schemaIssues = this.schemaValidator(memory);
    const missingDataIssues = this.completenessChecker(memory);
    const conflictIssues = this.consistencyChecker(memory);
    const hallucinationIssues = this.hallucinationDetector(memory.sourceMap);
    const noiseIssues = this.noiseDetector(memory);
    const factualIssues = await this.factualAccuracyChecker(memory);

    // Compute numeric confidence score (0–1)
    const confidenceScore = this.computeConfidenceScore(memory);

    // Low-confidence agents and fields below threshold are elevated to errors
    const lowConfidenceIssues = this.confidenceChecker(memory, confidenceScore);
    
    const issues = [
      ...schemaIssues,
      ...missingDataIssues,
      ...conflictIssues,
      ...hallucinationIssues,
      ...noiseIssues,
      ...lowConfidenceIssues,
      ...factualIssues,
    ];

    if (issues.length > 0) {
      logger.warn(`Validation failed with ${issues.length} issues:`, issues.map((i) => i.message));
    }

    const passed = !issues.some((i) => i.severity === "error");

    return {
      passed,
      attempts,
      issues,
      confidenceScore,
    };
  }

  retryModules(report: QcReport): string[] {
    return [
      ...new Set(report.issues.filter((i) => i.severity === "error").map((i) => i.module)),
    ];
  }

  // ---------------------------------------------------------------------------
  // Confidence score calculation
  // ---------------------------------------------------------------------------

  /**
   * Computes a 0–1 score based on:
   * - Presence of critical business fields (40%)
   * - Source coverage of critical fields (30%)
   * - Agent-level confidence (30%)
   */
  private computeConfidenceScore(memory: StructuredMemory): number {
    const fieldScore = this.fieldPresenceScore(memory);       // 0–1
    const sourceScore = this.sourceCoverageScore(memory);     // 0–1
    const agentScore = this.agentConfidenceScore(memory);     // 0–1

    const score = fieldScore * 0.4 + sourceScore * 0.3 + agentScore * 0.3;
    return Math.round(score * 1000) / 1000; // round to 3 decimals
  }

  /** Score for how many critical data fields are populated */
  private fieldPresenceScore(memory: StructuredMemory): number {
    const hasOfferings = memory.offerings.products.length > 0 || memory.offerings.services.length > 0;
    const checks = [
      Boolean(memory.businessIdentity.officialName),
      Boolean(memory.businessIdentity.industry),
      Boolean(memory.businessIdentity.subIndustry),
      Boolean(memory.businessIdentity.businessModel),
      hasOfferings,
      memory.audience.buyerPersonas.length > 0,
      memory.audience.geographies.length > 0 || memory.audience.targetIndustries.length > 0,
      Boolean(memory.brandPositioning.tone),
      Boolean(memory.brandPositioning.positioning),
      typeof memory.digitalMaturity.score === "number" && memory.digitalMaturity.score > 0,
      memory.rdInsights.opportunities.length > 0,
    ];
    return checks.filter(Boolean).length / checks.length;
  }

  /** Score for how many critical fields have source-map backing */
  private sourceCoverageScore(memory: StructuredMemory): number {
    const sourceFields = new Set(memory.sourceMap.map((s) => s.field));
    const hasOfferingsSource = sourceFields.has("offerings.products") || sourceFields.has("offerings.services");
    
    // Check other critical fields
    const otherCritical = CRITICAL_SOURCE_FIELDS.filter((f) => !f.startsWith("offerings."));
    const covered = otherCritical.filter((f) => sourceFields.has(f)).length + (hasOfferingsSource ? 1 : 0);
    
    return covered / (otherCritical.length + 1);
  }

  /** Score based on per-agent confidence levels */
  private agentConfidenceScore(memory: StructuredMemory): number {
    const diagnostics = memory.agentDiagnostics ?? [];
    if (diagnostics.length === 0) return 0.5;
    const scores = diagnostics.map((d) => (d.confidence === "high" ? 1 : d.confidence === "medium" ? 0.6 : 0.2));
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }

  // ---------------------------------------------------------------------------
  // Validation sub-checks
  // ---------------------------------------------------------------------------

  private schemaValidator(memory: StructuredMemory): QcIssue[] {
    const issues: QcIssue[] = [];
    for (const field of requiredTopLevelFields) {
      if (!memory[field]) {
        issues.push({ module: "schema", field, severity: "error", message: `Missing required memory field: ${field}` });
      }
    }
    if (!Array.isArray(memory.sourceMap)) {
      issues.push({ module: "schema", field: "sourceMap", severity: "error", message: "sourceMap must be an array." });
    }
    if (typeof memory.digitalMaturity?.score !== "number") {
      issues.push({ module: "digital", field: "digitalMaturity.score", severity: "error", message: "Digital maturity score must be numeric." });
    }
    return issues;
  }

  private completenessChecker(memory: StructuredMemory): QcIssue[] {
    const issues: QcIssue[] = [];
    if (!memory.businessIdentity.officialName) {
      issues.push({
        module: "identity",
        field: "businessIdentity.officialName",
        severity: "warning",
        message: "Official name could not be extracted from readable sources.",
      });
    }
    if (!memory.businessIdentity.industry) {
      issues.push({
        module: "identity",
        field: "businessIdentity.industry",
        severity: "warning",
        message: "Industry classification is missing because evidence was insufficient.",
      });
    }
    if (memory.offerings.products.length + memory.offerings.services.length === 0) {
      issues.push({
        module: "offerings",
        field: "offerings",
        severity: "warning",
        message: "No explicit products or services were extracted.",
      });
    }
    if (memory.audience.buyerPersonas.length === 0) {
      issues.push({
        module: "audience",
        field: "audience.buyerPersonas",
        severity: "warning",
        message: "No buyer personas could be inferred.",
      });
    }
    return issues;
  }

  private consistencyChecker(memory: StructuredMemory): QcIssue[] {
    const issues: QcIssue[] = [];
    if (memory.businessIdentity.industry !== memory.industryClassification.industry) {
      issues.push({
        module: "identity",
        field: "industryClassification.industry",
        severity: "error",
        message: "Business identity and industry classification disagree.",
      });
    }
    return issues;
  }

  private hallucinationDetector(sourceMap: SourceRef[]): QcIssue[] {
    return sourceMap
      .filter((s) => !s.inferred && (!s.url || !s.evidence))
      .map((s) => ({
        module: this.moduleFromField(s.field),
        field: s.field,
        severity: "error" as const,
        message: "Non-inferred field is missing URL or evidence.",
      }));
  }

  private noiseDetector(memory: StructuredMemory): QcIssue[] {
    const issues: QcIssue[] = [];
    const values: Array<readonly [string, string, string]> = [
      ...memory.offerings.products.map((v) => ["offerings", "offerings.products", v.name] as const),
      ...memory.offerings.services.map((v) => ["offerings", "offerings.services", v.name] as const),
      ...memory.brandPositioning.usps.map((v) => ["brand", "brandPositioning.usps", v] as const),
      ...memory.audience.buyerPersonas.map((v) => ["audience", "audience.buyerPersonas", v] as const),
    ];

    for (const [module, field, value] of values) {
      const normalized = value.trim().toLowerCase();
      if (
        agentRules.cleaning.noisyLabels.some(
          (label) => normalized === label || (normalized.length < 30 && normalized.startsWith(`${label} `)),
        )
      ) {
        issues.push({ module, field, severity: "error", message: `Output contains UI/navigation noise: "${value}"` });
      }
    }
    return issues;
  }

  /**
   * Active confidence check: if the overall confidenceScore is below the
   * minimum threshold (0.85), all agent modules with low confidence are
   * elevated to errors so the orchestrator will trigger a re-run.
   */
  private confidenceChecker(memory: StructuredMemory, overallScore: number): QcIssue[] {
    const issues: QcIssue[] = [];

    // Individual low-confidence agents always get flagged as errors
    for (const diagnostic of memory.agentDiagnostics ?? []) {
      if (diagnostic.confidence === "low") {
        issues.push({
          module: this.moduleFromAgent(diagnostic.agent),
          field: "agentDiagnostics.confidence",
          severity: "error",
          message: `${diagnostic.agent} returned low confidence output — re-run required.`,
        });
      }
    }

    // ROOT CAUSE FIX LOGIC: Replace blind systemic retries
    if (overallScore < agentRules.qc.minConfidenceScore) {
      if (memory.offerings.products.length === 0 && memory.offerings.services.length === 0) {
        issues.push({
          module: "offerings",
          field: "offerings",
          severity: "error",
          message: `Root Cause: Missing products/services. Retrying offerings extractor.`,
        });
      } else {
        issues.push({
          module: "semantic",
          field: "confidenceScore",
          severity: "warning", // Changed to warning so it doesn't cause infinite retry
          message: `Overall confidence score ${overallScore.toFixed(3)} is low, but no specific critical root cause identified. Marked for review.`,
        });
      }
    }

    return issues;
  }

  private async factualAccuracyChecker(memory: StructuredMemory): Promise<QcIssue[]> {
    const issues: QcIssue[] = [];
    const sourceFields = new Set(memory.sourceMap.map((s) => s.field));
    const factFields = [
      "businessIdentity.officialName",
      "homepage.businessSummary",
      "seo.metaTitle",
      "brand.positioning",
    ];

    for (const field of factFields) {
      if (this.hasValue(memory, field) && !sourceFields.has(field)) {
        issues.push({
          module: this.moduleFromField(field),
          field,
          severity: "warning",
          message: "Field has value but no exact source-map entry.",
        });
      }
    }

    // Secondary Tools: Web Search / Entity Verification Fact Check
    if (memory.businessIdentity.officialName && memory.industryClassification.industry) {
      const verified = await this.verifyEntity(memory.businessIdentity.officialName, memory.industryClassification.industry);
      if (!verified) {
        issues.push({
          module: "identity",
          field: "businessIdentity.officialName",
          severity: "warning",
          message: "Secondary web search could not verify business existence.",
        });
      }
    }

    return issues;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async verifyEntity(officialName: string, industry: string): Promise<boolean> {
    logger.info(`Engaging Secondary Tools: Verifying Entity <${officialName}> in industry <${industry}> via Web Search...`);
    
    try {
      const query = `"${officialName}" ${industry}`;
      const searchEngine = new FreeSearchEngine({ maxResults: 3 });
      const rawRes = await searchEngine.invoke({ query });
      const data = typeof rawRes === "string" ? JSON.parse(rawRes) : rawRes;
      
      return data && data.length > 0;
    } catch (e) {
      logger.error("Secondary Web Search Failed", e);
      return true; // fail-open so pipeline continues
    }
  }

  private hasValue(memory: StructuredMemory, field: string): boolean {
    if (field === "businessIdentity.officialName") return Boolean(memory.businessIdentity.officialName);
    if (field === "brand.positioning") return Boolean(memory.brandPositioning.positioning);
    if (field === "seo.metaTitle") return memory.sourceMap.some((s) => s.field === "seo.metaTitle");
    if (field === "homepage.businessSummary") return memory.sourceMap.some((s) => s.field === "homepage.businessSummary");
    return false;
  }

  private moduleFromField(field: string): string {
    if (field.startsWith("businessIdentity") || field.startsWith("industry")) return "identity";
    if (field.startsWith("offerings")) return "offerings";
    if (field.startsWith("audience")) return "audience";
    if (field.startsWith("brand")) return "brand";
    if (field.startsWith("digital")) return "digital";
    if (field.startsWith("confidence")) return "schema";
    return "web";
  }

  private moduleFromAgent(agent: string): string {
    if (agent.includes("scraper") || agent.includes("social")) return agent.includes("social") ? "social" : "webScrape";
    if (agent.includes("semantic")) return "semantic";
    if (agent.includes("identity") || agent.includes("industry")) return "identity";
    if (agent.includes("offering")) return "offerings";
    if (agent.includes("audience")) return "audience";
    if (agent.includes("brand")) return "brand";
    if (agent.includes("digital")) return "digital";
    if (agent.includes("rd")) return "rd";
    return "web";
  }
}
