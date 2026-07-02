import { CompetitorAgent } from "./src/agents/competitorAgent.js";
import { MemoryStore } from "./src/memory/memoryStore.js";
import { config } from "dotenv";
config();

import { CompetitiveAnalysisAgent } from "./src/agents/competitiveAnalysisAgent.js";

async function test() {
  const store = new MemoryStore();
  const memory = await store.loadBySite("https://shaileshforging.com/");
  if (!memory) {
    console.log("Memory not found!");
    return;
  }
  const agent = new CompetitorAgent();
  const res = await agent.run(memory);
  console.log("\n\n--- COMPETITORS ---\n\n");
  console.log(res);

  console.log("\n\n--- EXTRACTING COMPETITOR URLS ---\n\n");
  const urlRegex = /\-\s*\*\*Website:\*\*\s*(https?:\/\/[^\s\)]+)/g;
  const urls: string[] = [];
  let match;
  while ((match = urlRegex.exec(res)) !== null) {
    urls.push(match[1]);
  }
  
  if (urls.length === 0) {
    console.log("No competitor URLs found to analyze.");
    return;
  }
  
  console.log(`Found ${urls.length} URLs. Launching Competitive Analysis Agent...`);
  const analysisAgent = new CompetitiveAnalysisAgent();
  const analysisRes = await analysisAgent.run(memory, urls);
  
  console.log("\n\n--- COMPETITIVE GAP ANALYSIS & STRATEGY ---\n\n");
  console.log(analysisRes);
}
test().catch(console.error);
