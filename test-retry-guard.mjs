import { QcAgent } from "./dist/qc/qcAgent.js";

async function testRetryGuard() {
  console.log('=== Testing QC Retry Guard ===\n');

  const qcAgent = new QcAgent();

  // Create a minimal profile that will fail QC with errors
  const failingProfile = {
    structuredJsonMemoryObject: {
      input: { websiteUrl: "https://test-retry-guard.com" },
      businessIdentity: { officialName: "", industry: "", subIndustry: "", businessModel: "" },
      homepage: { businessSummary: "" },
      seo: { metaTitle: "" },
      offerings: { products: [], services: [], valuePropositions: [] },
      audience: { buyerPersonas: [], geographies: [], targetIndustries: [] },
      brandPositioning: { tone: "", positioning: "", usps: [] },
      digitalMaturity: { score: 0, websiteQuality: 0, seoReadiness: 0, socialActivity: 0, details: {} },
      rdInsights: { opportunities: [], threats: [], trends: [] },
      marketingSales: { contentStrategy: "", linkedinOutreach: "" },
      industryClassification: { industry: "" },
      aiContent: { offerings: [], processes: [] },
      sourceMap: [],
      agentDiagnostics: [
        { agent: "business-identity-agent", confidence: "low", details: "failed" },
        { agent: "offerings-extraction-agent", confidence: "low", details: "failed" }
      ],
      competitors: [],
      ownSocials: { platforms: {} },
      brandVoicePattern: { tone: "", style: "", vocabulary: [] },
      rejectedCompetitors: [],
      vectorKnowledgeBase: { facts: [], vectors: [] },
      executiveSummary: "",
      pdfReport: null
    },
    businessIdentitySummary: { officialName: "", industry: "", location: "", website: "https://test-retry-guard.com" },
    offeringsSummary: { products: [], services: [], valuePropositions: [] },
    audienceSummary: { buyerPersonas: [], geographies: [], targetIndustries: [] },
    brandPositioningSummary: { tone: "", positioning: "", usps: [] },
    digitalMaturitySummary: { score: 0, details: {} },
    rdInsightsSummary: { opportunities: [], threats: [], trends: [] },
    marketingSalesSummary: { contentStrategy: "", linkedinOutreach: "" },
    aiContentSummary: { offerings: [], processes: [] },
    competitorAnalysis: { gaps: [], opportunities: [], threats: [] },
    seoAnalysis: { keywords: [], technicalIssues: [], recommendations: [] },
    socialMediaStrategy: { posts: [], calendar: [] }
  };

  console.log('Test 1: Initial QC should fail with errors');
  const qc1 = await qcAgent.validate(failingProfile, 1);
  console.log('  Passed:', qc1.passed);
  console.log('  Issues:', qc1.issues.length);
  console.log('  Errors:', qc1.issues.filter(i => i.severity === 'error').length);
  console.log('  Confidence:', qc1.confidenceScore);
  console.log('  Retry counts:', qcAgent.getRetryCounts());

  console.log('\nTest 2: retryModules should return modules with errors');
  const retryModules = qcAgent.retryModules(qc1);
  console.log('  Modules to retry:', retryModules);

  console.log('\nTest 3: incrementRetryCount for each module');
  for (const mod of retryModules) {
    qcAgent.incrementRetryCount(mod);
  }
  console.log('  Retry counts after 1st increment:', qcAgent.getRetryCounts());

  console.log('\nTest 4: Second QC validation (attempt 2)');
  const qc2 = await qcAgent.validate(failingProfile, 2);
  const retryModules2 = qcAgent.retryModules(qc2);
  console.log('  Passed:', qc2.passed);
  console.log('  Modules to retry:', retryModules2);
  for (const mod of retryModules2) {
    qcAgent.incrementRetryCount(mod);
  }
  console.log('  Retry counts after 2nd increment:', qcAgent.getRetryCounts());

  console.log('\nTest 5: Third QC validation (attempt 3)');
  const qc3 = await qcAgent.validate(failingProfile, 3);
  const retryModules3 = qcAgent.retryModules(qc3);
  console.log('  Passed:', qc3.passed);
  console.log('  Modules to retry:', retryModules3);
  for (const mod of retryModules3) {
    qcAgent.incrementRetryCount(mod);
  }
  console.log('  Retry counts after 3rd increment:', qcAgent.getRetryCounts());

  console.log('\nTest 6: Fourth QC validation (attempt 4) - should be blocked by retry guard');
  const qc4 = await qcAgent.validate(failingProfile, 4);
  const retryModules4 = qcAgent.retryModules(qc4);
  console.log('  Passed:', qc4.passed);
  console.log('  Modules to retry:', retryModules4);
  console.log('  Retry counts:', qcAgent.getRetryCounts());

  if (retryModules4.length === 0) {
    console.log('\n✅ RETRY GUARD WORKING: Modules with 3 retries are blocked from further retries');
  } else {
    console.log('\n❌ RETRY GUARD FAILED: Modules still being retried after 3 attempts');
  }

  console.log('\nTest 7: resetRetryCounts()');
  qcAgent.resetRetryCounts();
  console.log('  Retry counts after reset:', qcAgent.getRetryCounts());

  const retryAfterReset = qcAgent.retryModules(qc1);
  console.log('  Modules to retry after reset:', retryAfterReset);

  if (retryAfterReset.length > 0) {
    console.log('\n✅ RESET WORKING: Retry counts cleared, modules can be retried again');
  } else {
    console.log('\n❌ RESET FAILED');
  }
}

testRetryGuard().catch(console.error);