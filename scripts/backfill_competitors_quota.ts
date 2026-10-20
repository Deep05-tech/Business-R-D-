import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();

import { CompetitorAgent } from "../src/agents/competitorAgent.js";
import { MemoryStore } from "../src/memory/memoryStore.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger("BackfillCompetitorQuota");

async function main() {
  const memoryStore = new MemoryStore();
  const agent = new CompetitorAgent();
  const memoryDir = path.resolve(process.cwd(), "data", "memory");
  const files = fs.readdirSync(memoryDir).filter(f => f.endsWith(".json"));

  console.log(`Found ${files.length} project memory files to inspect for competitor quota...`);

  for (const file of files) {
    const filePath = path.join(memoryDir, file);
    try {
      const memory = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (!memory.input?.websiteUrl) continue;

      const comps = memory.competitors || [];
      const localCount = comps.filter((c: any) => c.type === "local").length;
      const regCount = comps.filter((c: any) => c.type === "regional").length;
      const globCount = comps.filter((c: any) => c.type === "global").length;

      console.log(`\n======================================================`);
      console.log(`Project: ${memory.businessIdentity?.officialName || file}`);
      console.log(`URL: ${memory.input.websiteUrl}`);
      console.log(`Current: Total=${comps.length} (Local=${localCount}, Regional=${regCount}, Global=${globCount})`);

      if (localCount >= 10 && regCount >= 10 && globCount >= 10) {
        console.log(`✅ Quota already satisfied (>= 10 in all categories). Skipping.`);
        continue;
      }

      console.log(`⚡ Upgrading competitor quota to 10-15 per category...`);
      const updatedComps = await agent.run(
        memory,
        "all",
        (comp, statusMsg) => {
          if (comp) {
            console.log(`  + [${comp.type}] ${comp.name} (${comp.url})`);
          }
        },
        45,
        true
      );

      memory.competitors = updatedComps;
      await memoryStore.save(memory);

      const newLocal = updatedComps.filter(c => c.type === "local").length;
      const newReg = updatedComps.filter(c => c.type === "regional").length;
      const newGlob = updatedComps.filter(c => c.type === "global").length;

      console.log(`🎉 Upgraded ${memory.businessIdentity?.officialName}: Total=${updatedComps.length} (Local=${newLocal}, Regional=${newReg}, Global=${newGlob})`);
    } catch (err: any) {
      console.error(`❌ Error updating ${file}:`, err.message);
    }
  }

  console.log(`\nAll projects processed.`);
}

main().catch(console.error);
