import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory, PageSnapshot } from "../types.js";
import { WebTool } from "../tools/webTool.js";

const logger = createLogger("SeoAgent");

export class SeoAgent {
  readonly name = "seo-agent";
  readonly version = "2.0.0";

  async run(memory: StructuredMemory): Promise<string> {
    logger.info(`Running Deep SEO & Google Presence analysis for ${memory.input.websiteUrl}...`);

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.2,
      maxTokens: 8000,
    });

    const webTool = new WebTool({ timeoutMs: 15000, maxBytes: 1000000 });

    logger.info(`Crawling Target Business Homepage: ${memory.input.websiteUrl}`);
    const targetSnapshot = await webTool.fetchPage(memory.input.websiteUrl);
    logger.info(`Successfully extracted SEO footprint for Target Business. Found ${targetSnapshot.headings.length} headings.`);

    const topCompetitors = memory.competitors || [];
    const competitorSnapshots: { name: string; url: string; seo: Partial<PageSnapshot> }[] = [];

    if (topCompetitors.length > 0) {
      logger.info(`Crawling ${topCompetitors.length} Competitor Homepages for SEO footprints...`);
      const results = await Promise.all(
        topCompetitors.map(async (comp) => {
          try {
            const snap = await webTool.fetchPage(comp.url);
            return {
              name: comp.name,
              url: comp.url,
              seo: {
                title: snap.title,
                metaDescription: snap.metaDescription,
                headings: snap.headings,
                contentText: snap.contentText || "No text extracted"
              }
            };
          } catch (e) {
            logger.warn(`Failed to crawl competitor ${comp.name} homepage for SEO.`);
            return {
              name: comp.name,
              url: comp.url,
              seo: { title: "Crawl Failed", metaDescription: "N/A", headings: [], contentText: "N/A" }
            };
          }
        })
      );
      competitorSnapshots.push(...results);
    }

    const memoryContext = JSON.stringify({
      businessIdentity: memory.businessIdentity,
      offerings: memory.offerings,
      targetBusinessSEO: {
        title: targetSnapshot.title,
        metaDescription: targetSnapshot.metaDescription,
        headings: targetSnapshot.headings,
        contentSnippet: targetSnapshot.contentText || "N/A"
      },
      competitorSEO: competitorSnapshots
    }, null, 2);

    const prompt = `You are an elite SEO Strategist and Growth Hacker. 
Your task is to analyze the LIVE SEO footprints of the target business and its competitors, and generate a strategic, actionable SEO & Google Presence Improvement Plan.

BUSINESS & LIVE SEO CONTEXT:
${memoryContext}

CRITICAL CONSTRAINT - READ CAREFULLY:
You must strictly align your suggestions with the business's current \`offerings\` profile. Do not suggest selling new physical products or completely unrelated services. 
HOWEVER, you SHOULD heavily suggest adding new website content, structural elements, pages (e.g., FAQs, buyers guides, comparison pages, blogs), and specific keyword topics that the competitors have but the target business is missing. 
Your goal is to suggest what the target business needs to ADD to their website to rank on top for their existing offerings.

${memory.input.customInstructions ? `USER INSTRUCTIONS / REVIEWS: \n${memory.input.customInstructions}\n\nStrictly follow the user instructions above when generating the SEO strategy.` : ""}

INSTRUCTIONS:
1. Deeply analyze the target business's current SEO footprint (Title, Description, Headings) against the competitors' footprints.
2. Identify the high-value "money keywords" (commercial intent) that the competitors are dominating AND that apply directly to the target business's current offerings.
3. Formulate a 4-step actionable SEO strategy (Content Additions, On-Page Optimization, Technical/Meta gap fixes, Authority/Local) to outrank these competitors.
4. Keep the tone professional, highly technical, and direct. Output in clean Markdown format with bold headings.
5. Explicitly point out what the competitors are doing well (e.g., "Competitor X uses keyword Y in their H1") and clearly state what new things the target business needs to ADD to their website to beat them.

Format:
### 1. Competitor SEO Breakdown & Gaps
[Analyze the actual Title tags, Headings, and Meta Descriptions scraped from the competitors. Compare them to the target business's footprint.]

### 2. High-Value Keyword Targets
[List 5-8 exact match keywords with high commercial intent that the target business can realistically rank for based on its CURRENT offerings.]

### 3. Website Content to Add
[Actionable list of new pages, content sections (e.g., FAQs, Guides), or blog topics that the business must ADD to the website to match and outrank the competitors.]

### 4. Actionable On-Page Optimization Strategy
[Actionable plan to fix existing Titles, Meta Descriptions, and Headings.]

### 5. Google Presence & Authority Building
[Actionable plan for backlinks, local SEO, and authority building.]
`;

    try {
      logger.info(`Analyzing footprints and generating SEO strategy via LLM...`);
      const response = await llm.invoke(prompt);
      logger.info(`Successfully generated Deep SEO & Google Presence Improvement Plan for ${memory.input.websiteUrl}.`);
      return typeof response.content === "string" ? response.content : "Error generating SEO strategy.";
    } catch (e: any) {
      logger.error(`SEO Agent failed: ${e.message}`);
      throw e;
    }
  }
}
