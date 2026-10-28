import { OrchestratorAgent } from "./dist/orchestrator.js";
import { MemoryStore } from "./dist/memory/memoryStore.js";
import { knowledgeIndex } from "./dist/memory/knowledgeIndex.js";
import { createLogger } from "./dist/utils/logger.js";

const logger = createLogger('TestPipeline');

async function runPipeline() {
  logger.info('Starting pipeline test...');
  const orchestrator = new OrchestratorAgent();
  const store = new MemoryStore();

  // Clear any existing memory for this URL
  await store.removeTombstone('https://www.venuswomenshospital.com');
  await store.evictCache('https://www.venuswomenshospital.com');

  const input = {
    websiteUrl: 'https://www.venuswomenshospital.com',
    socialUrls: ['https://www.venuswomenshospital.com/facebook'],
    customInstructions: 'Focus on medical services and IVF offerings'
  };

  logger.info('Running orchestrator.run()...');
  const profile = await orchestrator.run(input, (step, partial) => {
    logger.info(`Step: ${step}`, partial);
  });

  logger.info('Pipeline completed');
  console.log('=== FINAL PROFILE ===');
  console.log(JSON.stringify(profile, null, 2));

  // Verify memory store and knowledgeIndex sync
  const saved = await store.loadBySite('https://www.venuswomenshospital.com');
  const indexed = knowledgeIndex.get('www.venuswomenshospital.com');

  logger.info('MemoryStore has:', saved ? 'yes' : 'no');
  logger.info('KnowledgeIndex has:', indexed ? 'yes' : 'no');

  if (saved && indexed) {
    logger.success('✅ Memory and knowledge index are in sync');
  } else {
    logger.error('❌ Memory/index sync issue');
  }

  // Check QC retry counts
  const qcAgent = orchestrator.qcAgent;
  logger.info('QC retry counts:', qcAgent.getRetryCounts());
}

runPipeline().catch(err => {
  logger.error('Pipeline failed:', err);
  process.exit(1);
});