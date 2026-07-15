import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import { z } from "zod";
import type { CompetitorProfile } from "../types.js";

const logger = createLogger("CompetitorQCAgent");

export class CompetitorQCAgent {
  async qcCompetitorLinks(competitors: CompetitorProfile[], targetIndustry: string, targetProducts: string): Promise<CompetitorProfile[]> {
    if (competitors.length === 0) return competitors;

    const llm = new ChatOpenAI({ modelName: "gpt-4o", temperature: 0 });
    
    const qcSchema = z.object({
      valid_competitors: z.array(z.object({
        name: z.string(),
        url: z.string(),
        manufactures_exact_same_products: z.boolean().describe("Set to true if the company manufactures the same products OR is in the exact same specific product category (e.g., automotive forgings). Set to false if they are unrelated."),
        relevance_score: z.number().min(1).max(100).describe("Score from 1 to 100 on how closely this competitor's products match the target business. 100 means an absolutely perfect direct competitor with the exact same core product catalog."),
        why_competitor_improved: z.string().describe("Rewrite the rationale into a powerful 1-2 sentence explanation. CRITICAL: You MUST explicitly state the EXACT product or service that makes them a competitor (e.g., 'Direct competitor for manufacturing Torque Rod Arms.'). Do NOT hallucinate products! Only mention products that BOTH companies actually manufacture."),
        approved_evidence_urls: z.array(z.object({
          title: z.string(),
          url: z.string()
        })).describe("Select UP TO 5 URLs from the provided pool that most explicitly point to actual products, services, or catalogs. Remove corporate, leadership, news, or blog links.")
      }))
    });

    const prompt = `You are a strict Data Quality Control (QC) Auditor.
Your job is to review a list of scraped competitors and their extracted links to ensure 100% accuracy for a Business Intelligence dashboard.
The target business operates in this exact industry: ${targetIndustry}
The target business EXACT CORE PRODUCTS are:
${targetProducts}

Here are the scraped competitors and their extracted product links:
${JSON.stringify(competitors, null, 2)}

INSTRUCTIONS:
1. manufactures_exact_same_products: Review each competitor. If you cannot confirm they manufacture AT LEAST ONE EXACT SPECIFIC PRODUCT (e.g. 'Torque Rod Arms', 'Steering Knuckle') from the target business's core products list, you MUST set this to false and they will be deleted. Generic industry overlaps like "automotive parts" or "forged components" are UNACCEPTABLE.
2. why_competitor_improved: YOU MUST EXPLICITLY NAME THE EXACT SHARED PRODUCTS in your first sentence. Format it exactly like: 'Direct competitor for [Exact Shared Product 1, Exact Shared Product 2]. [Brief explanation]'. Do NOT use generic terms like 'forged components' or 'automotive parts'. If they do not share an exact specific product, they should have been marked false in step 1.
3. approved_evidence_urls: You have been given a broad pool of raw links for each competitor. You MUST carefully analyze these links and SELECT UP TO 5 of the most specific product, service, solution, or catalog pages.
   - DO NOT include leadership profiles (e.g., "Chairman", "CEO", "CFO")
   - DO NOT include corporate stories, blogs, or news (e.g., "Story", "Our History", "Press")
   - DO NOT include About Us, Careers, or Investor Relations pages
   If ALL of a competitor's links are invalid or if no specific products exist, just return an empty array for their approved_evidence_urls.
4. LANGUAGE TRANSLATION: If any of the selected product page titles are in a foreign language, you MUST translate the title into English before outputting it.
5. RELEVANCE SCORE: Score them 1-100 strictly based on HOW MANY EXACT SPECIFIC PRODUCTS they share with the target business's core products list. If they manufacture the exact same specific items (e.g. Torque Rod Arms), give them 90-100. If they just generally do 'forging' but don't explicitly list specific matching parts, give them a lower score (10-50).
6. Return the exact same competitors, but with the 'is_strictly_same_industry' flag properly evaluated, and the 'evidenceUrls' array containing only the top 5 valid product links you intelligently selected.`;

    try {
      const parsed = await llm.withStructuredOutput(qcSchema).invoke(prompt);
      
      const qcApproved: CompetitorProfile[] = [];
      for (const comp of competitors) {
        const qcData = parsed.valid_competitors.find(c => c.url === comp.url || c.name === comp.name);
        if (qcData) {
          if (qcData.manufactures_exact_same_products) {
             let validUrls = qcData.approved_evidence_urls || [];
             
             if (validUrls.length === 0) {
                 validUrls = [{title: "Homepage", url: comp.url}];
             }
             
             comp.evidenceUrls = validUrls;
             comp.whyCompetitor = qcData.why_competitor_improved || comp.whyCompetitor;
             (comp as any)._relevanceScore = qcData.relevance_score;
             qcApproved.push(comp);
          } else {
             logger.warn(`QC Agent discarded ${comp.name} because it does not manufacture the exact specific products.`);
          }
        } else {
           qcApproved.push(comp);
        }
      }
      
      logger.info(`QC Agent approved ${qcApproved.length} competitors out of ${competitors.length}. Sorting by relevance score and returning top 10.`);
      qcApproved.sort((a, b) => ((b as any)._relevanceScore || 0) - ((a as any)._relevanceScore || 0));
      return qcApproved.slice(0, 10);
    } catch (e: any) {
      logger.error(`QC Validation failed: ${e.message}`);
      return competitors;
    }
  }
}
