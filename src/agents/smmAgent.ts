import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory } from "../types.js";

const logger = createLogger("SmmAgent");

export class SmmAgent {
  readonly name = "smm-agent";
  readonly version = "1.0.0";

  async run(memory: StructuredMemory, type: "video" | "image", totalPosts: number, language: string = "English", strategy: string = "new", theme: string = "brand", targetProduct?: string): Promise<string[]> {
    logger.info(`Generating ${totalPosts} SMM ${type} posts in ${language} for ${memory.input.websiteUrl} (Strategy: ${strategy}, Theme: ${theme}, Product: ${targetProduct || 'None'})...`);

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.7,
      maxTokens: 16000,
    });

    const memoryContext = JSON.stringify({
      businessIdentity: memory.businessIdentity,
      offerings: memory.offerings,
      brandPositioning: memory.brandPositioning,
      rdInsights: memory.rdInsights,
    }, null, 2);

    let competitorContext = "";
    if (strategy === "mirror" && memory.competitors && memory.competitors.length > 0) {
      competitorContext = `
CRITICAL STRATEGY INSTRUCTION: 
The user has requested to MIRROR their competitors' strategies.
Below are the top competitors identified for this business:
${memory.competitors.map(c => `- ${c.name} (Socials: ${JSON.stringify(c.socials)})`).join('\n')}

Your generated content MUST emulate the tone, structure, and pacing typically used by these specific competitors in this exact industry. If they rely heavily on technical showcases, do the same. Analyze what these market leaders likely do to succeed, and adopt that exact posture for your posts.
`;
    }

    const customInstructionsContext = memory.input.customInstructions ? `
USER INSTRUCTIONS / REVIEWS: 
${memory.input.customInstructions}

Strictly follow the user instructions above. The user instructions take absolute priority over any other theme or strategy rules.
` : "";

    let themeInstruction = "";
    switch (theme) {
      case "brand":
        themeInstruction = "THEME: BRAND. Focus heavily on the company's overarching vision, history, scale, and ethos. Build trust and authority.";
        break;
      case "product":
        themeInstruction = "THEME: PRODUCT. Focus heavily on specific product features, direct benefits, competitive advantages, and the exact problems they solve.";
        break;
      case "technical":
        themeInstruction = "THEME: TECHNICAL. Deep dive into engineering. Highlight hard specifications, metallurgy, manufacturing processes, tolerances, and advanced R&D capabilities.";
        break;
      case "educative":
        themeInstruction = "THEME: INFORMATIVE/EDUCATIVE. Act as a thought leader. Explain 'how things work', share industry best practices, and educate the target audience on complex topics.";
        break;
      case "ugc":
        themeInstruction = "THEME: USER GENERATED CONTENT (UGC). Use a raw, authentic, 'behind-the-scenes' tone. Focus on the factory floor, employee POVs, real-world testing, or 'day in the life' content.";
        break;
      default:
        themeInstruction = "THEME: BRAND. Focus heavily on the company's overarching vision, history, scale, and ethos.";
    }

    let productFocusInstruction = "";
    if (targetProduct) {
      const foundProduct = memory.offerings.products.find(p => p.name === targetProduct || (typeof p === 'string' && p === targetProduct));
      productFocusInstruction = `
CRITICAL PRODUCT FOCUS:
The user has explicitly requested that these posts focus on ONE SPECIFIC PRODUCT ONLY: "${targetProduct}".
Do NOT write about general brand information or other products. Everything must revolve around this specific target product.
${foundProduct && typeof foundProduct === 'object' ? `Product Details to reference:
Description: ${foundProduct.description}
Key Features: ${foundProduct.keyFeatures?.join(', ')}
Technical Specs: ${JSON.stringify(foundProduct.technicalSpecs || {})}` : ''}
`;
    }

    let formatInstructions = "";
    if (type === "video") {
      formatInstructions = `
You must act as a master video editor and director with over 20 years of experience creating highly engaging, fast-paced cinematic short-form content (Reels/TikToks). 
Generate exactly ${totalPosts} short-form video scripts (30 seconds each).
CRITICAL: Every single script MUST focus on a completely DIFFERENT topic. Do NOT write the same script twice. One can focus on a specific product, another on the manufacturing process, another on a specific use-case industry, etc.

Format each script explicitly as follows:
---
### Post [Number]: [Catchy Title]
**Topic Focus:** [State the specific product/process/insight this video focuses on]

**Scene 1: The Hook (0-3s)** 
- **Visuals:** [Dynamic visual direction, e.g., fast pan, extreme close-up, fast cuts]
- **Sound Design SFX:** [Heavy industrial sound, e.g., massive hydraulic thud, steam hiss]
- **Voiceover:** [High-stakes opening line leading with the cost of failure, extreme conditions, or scale. NO clichés.]

**Scene 2: Context / Problem (3-8s)** 
- **Visuals:** [Visuals establishing the industrial context, challenge, or scale]
- **Sound Design SFX:** [Ambient industrial rumble or rhythmic mechanical clanking]
- **Voiceover:** [Explaining the engineering challenge or context]

**Scene 3: The Product / Solution (8-15s)** 
- **Visuals:** [Cinematic reveal or slow-motion shot of the specific component being manufactured or displayed]
- **Sound Design SFX:** [Sharp metallic ping or heavy forging impact]
- **Voiceover:** [Introducing the component. Surface hard metrics, specific materials, or dimensions here.]

**Scene 4: Technical Detail (15-22s)** 
- **Visuals:** [Macro shots of the material, CNC machining process, or quality testing]
- **Sound Design SFX:** [High-frequency CNC whirring or precise metallic clicking]
- **Voiceover:** [Highlighting a specific technical specification (e.g. weights, dimensions, steel grades) from the memory]

**Scene 5: Real-World Application (22-26s)** 
- **Visuals:** [Footage of the component actively working inside its final assembly, e.g. a wind turbine or gearbox]
- **Sound Design SFX:** [Deep bass drone or heavy engine roar]
- **Voiceover:** [Describing exactly where and how it is used in the industry]

**Scene 6: Call to Action (26-30s)** 
- **Visuals:** [High-contrast, moody industrial frame or dark metallic texture with clean, minimalist typography overlay of the brand name]
- **Sound Design SFX:** [Final heavy metallic lock-in sound]
- **Voiceover:** [A strong, authoritative B2B call to action]
---
`;
    } else {
      formatInstructions = `
You must generate exactly ${totalPosts} highly engaging image post concepts for social media (LinkedIn/Instagram).
Each post should focus on a DIFFERENT product, use-case, or value proposition found in the provided business memory.

Format each post explicitly as follows:
---
### Post [Number]: [Catchy Title]
**Visual Idea:** [Describe exactly what the image/graphic should look like, including any text overlays]
**Caption:** [Write a high-converting, professional caption]
**Hashtags:** [5-7 relevant hashtags]
---
`;
    }

    const prompt = `You are an elite Social Media Marketing (SMM) Manager for a B2B industrial/manufacturing business.
Your goal is to generate extremely high-quality, technically accurate social media content based STRICTLY on the business's data.

BUSINESS MEMORY:
${memoryContext}

INSTRUCTIONS:
${formatInstructions}

IMPORTANT RULES & B2B TONAL OVERRIDE:
1. ONLY generate content based on the products and capabilities explicitly listed in the BUSINESS MEMORY. Do not hallucinate or invent new products.
2. BAN THE CORPORATE CLICHÉS: Never use generic marketing phrases (e.g., "Where precision meets performance", "Crafted to perfection", "Unleash the power"). If a sentence sounds like a generic brochure tagline, delete it.
3. HIGH-STAKES HOOKS: The first line must immediately lead with the stakes, cost of component failure, extreme environmental conditions (pressure/heat), or technical scale. Never start with "discover".
4. AUTHORITATIVE VOICE: The narrator persona must be a grounded, expert metallurgical engineer or industry consultant. Strip out ALL exclamation marks. Speak with technical authority. Surface hard metrics, materials, and dimensions in the first half of the script.
5. CINEMATIC OUTROS: Never use "clean white backgrounds". End on high-contrast, moody industrial shots with minimalist typography.
6. ALIGN WITH VISION & THEME: The content MUST implicitly reflect the core vision of the business AND strictly adhere to the following theme directive:
   >> ${themeInstruction}
7. You must generate EXACTLY ${totalPosts} posts.
8. CRITICAL LANGUAGE RULE: You must write the entire output (including scripts, captions, and visual descriptions) exclusively in the **${language}** language.

${customInstructionsContext}
${competitorContext}
${productFocusInstruction}

Begin generating the posts now:`;

    try {
      const response = await llm.invoke(prompt);
      const content = typeof response.content === "string" ? response.content : "";
      
      // Split by '---' to return an array of posts, filtering out empty ones
      const posts = content.split("---").map(p => p.trim()).filter(p => p.length > 20);
      return posts.slice(0, totalPosts);
    } catch (e: any) {
      logger.error(`SMM generation failed: ${e.message}`);
      throw e;
    }
  }
}
