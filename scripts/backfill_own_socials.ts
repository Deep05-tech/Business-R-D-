import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/memoryStore.js";
import { ProjectSocialAgent } from "../src/agents/projectSocialAgent.js";
import type { StructuredMemory } from "../src/types.js";

async function main() {
  console.log("=== Backfilling Own Socials & Brand Voice Patterns for Existing Projects ===");
  const memoryStore = new MemoryStore("data/memory");
  const projectSocialAgent = new ProjectSocialAgent();
  const files = (await readdir("data/memory")).filter(f => f.endsWith(".json"));

  for (const file of files) {
    const filePath = join("data/memory", file);
    const content = await readFile(filePath, "utf8");
    let mem: StructuredMemory;
    try {
      mem = JSON.parse(content);
    } catch {
      continue;
    }

    if (!mem.input?.websiteUrl) continue;
    const companyName = mem.businessIdentity?.officialName || file.replace('.json', '');
    console.log(`\nProcessing: ${companyName} (${mem.input.websiteUrl})...`);

    let modified = false;

    // 1. Check if ownSocials or brandVoicePattern is missing, or if configured platforms have no posts
    const hasIg = Boolean(mem.ownSocials?.instagram);
    const hasFb = Boolean(mem.ownSocials?.facebook);
    const currentPlatforms = new Set((mem.ownSocialFeed || []).map((p: any) => p.platform));
    const missingConfiguredPlatform = (hasIg && !currentPlatforms.has("Instagram")) || (hasFb && !currentPlatforms.has("Facebook"));

    if (!mem.ownSocials || !mem.brandVoicePattern || !mem.ownSocialFeed || missingConfiguredPlatform) {
      const result = await projectSocialAgent.run(
        companyName,
        mem.input.websiteUrl,
        mem.ownSocials || mem.input.socialUrls,
        undefined,
        mem
      );

      mem.ownSocials = result.ownSocials;
      mem.ownSocialFeed = result.ownSocialFeed;
      mem.brandVoicePattern = result.brandVoicePattern;
      modified = true;

      console.log(`[Success] ${companyName}:`);
      console.log(`  Socials: ${JSON.stringify(mem.ownSocials)}`);
      console.log(`  Posts Found: ${mem.ownSocialFeed.length}`);
      console.log(`  Brand Tone: "${mem.brandVoicePattern.tone}"`);
      console.log(`  Recent Topics Excluded: ${mem.brandVoicePattern.recentPostTopics.length}`);
    }

    if (modified) {
      await memoryStore.save(mem);
      console.log(`[Saved to Disk & Synced to GitHub] ${companyName}`);
    } else {
      console.log(`[Up to date] ${companyName}`);
    }
  }

  console.log("\n=== Finished Backfilling All Project Socials & Voice Patterns ===");
}

main().catch(err => {
  console.error("Backfilling failed:", err);
  process.exit(1);
});
