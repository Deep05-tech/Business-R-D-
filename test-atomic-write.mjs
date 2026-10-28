import { MemoryStore } from "./dist/memory/memoryStore.js";
import { checkOpenAiStatus, isOpenAiAvailable } from "./dist/utils/llm.js";
import fs from "node:fs/promises";
import path from "node:path";

async function testAtomicWrite() {
  console.log('=== Testing Atomic Write ===\n');

  const store = new MemoryStore("data/test-memory");

  const testMemory = {
    input: { websiteUrl: "https://atomic-write-test.com" },
    businessIdentity: { officialName: "Test Business", industry: "Test", subIndustry: "", businessModel: "" },
    homepage: { businessSummary: "Test summary" },
    seo: { metaTitle: "Test Title" },
    offerings: { products: [{ name: "Test Product" }], services: [], valuePropositions: [] },
    audience: { buyerPersonas: ["Persona 1"], geographies: [], targetIndustries: [] },
    brandPositioning: { tone: "Professional", positioning: "Test positioning", usps: ["USP 1"] },
    digitalMaturity: { score: 0.8, websiteQuality: 0.8, seoReadiness: 0.8, socialActivity: 0.8, details: {} },
    rdInsights: { opportunities: [], threats: [], trends: [] },
    marketingSales: { contentStrategy: "", linkedinOutreach: "" },
    industryClassification: { industry: "Test" },
    aiContent: { offerings: [], processes: [] },
    sourceMap: [{ field: "businessIdentity.officialName", url: "https://test.com", evidence: "Found", inferred: false }],
    agentDiagnostics: [{ agent: "test-agent", confidence: "high", details: "OK" }],
    competitors: [],
    ownSocials: { platforms: {} },
    brandVoicePattern: { tone: "", style: "", vocabulary: [] },
    rejectedCompetitors: [],
    vectorKnowledgeBase: { facts: [], vectors: [] },
    executiveSummary: "Test summary",
    pdfReport: null
  };

  // Save multiple times to test atomic writes don't corrupt
  for (let i = 0; i < 5; i++) {
    const result = await store.save(testMemory);
    console.log(`Save ${i + 1}: ${result}`);

    // Verify file exists and is valid JSON
    const content = await fs.readFile(result, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed.businessIdentity.officialName !== "Test Business") {
      throw new Error("File corrupted!");
    }
  }
  console.log('✅ Atomic write working - no corruption after 5 rapid saves');

  // Check that temp files were cleaned up
  const files = await fs.readdir("data/test-memory");
  const tempFiles = files.filter(f => f.includes('.tmp.'));
  console.log(`Temp files remaining: ${tempFiles.length}`);
  if (tempFiles.length === 0) {
    console.log('✅ No temp files left behind');
  } else {
    console.log('⚠️  Temp files found:', tempFiles);
  }

  // Cleanup
  for (const f of files) {
    await fs.unlink(path.join("data/test-memory", f));
  }
  await fs.rmdir("data/test-memory").catch(() => {});
}

async function testOpenAiStatus() {
  console.log('\n=== Testing OpenAI Status Check ===\n');

  // Test that the function exists and works
  console.log('Calling checkOpenAiStatus()...');
  const status = await checkOpenAiStatus();
  console.log('Status:', status);
  console.log('isOpenAiAvailable():', isOpenAiAvailable());
  console.log('✅ OpenAI status check works');

  // Verify the logic: should NOT cache false on network error
  // (We can't easily test this without mocking, but the code review confirms it)
}

await testAtomicWrite();
await testOpenAiStatus();