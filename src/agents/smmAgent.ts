import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory } from "../types.js";

const logger = createLogger("SmmAgent");

export class SmmAgent {
  readonly name = "smm-agent";
  readonly version = "1.0.0";

  async run(memory: StructuredMemory, type: "video" | "image", totalPosts: number, language: string = "English", strategy: string = "new", theme: string = "brand", subTheme?: string, mirrorCompetitor?: string, mirrorPost?: any, industryFocus?: string, customGoal?: string, trendingTopic?: any): Promise<string[]> {
    logger.info(`Generating ${totalPosts} SMM ${type} posts in ${language} for ${memory.input.websiteUrl} (Strategy: ${strategy}, Theme: ${theme}, SubTheme: ${subTheme || 'None'}, Industry Focus: ${industryFocus || 'all'}, Trending Topic: ${trendingTopic?.title || 'None'})...`);

    const llm = new ChatOpenAI({
      model: "gpt-4o",
      temperature: 0.85,
      maxTokens: 8192,
      apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY,
    });

    const memoryContext = JSON.stringify({
      businessIdentity: memory.businessIdentity,
      offerings: memory.offerings,
      brandPositioning: memory.brandPositioning,
      rdInsights: memory.rdInsights,
    }, null, 2);

    let competitorContext = "";
    if (strategy === "mirror" && mirrorPost) {
      competitorContext = `
CRITICAL STRATEGY INSTRUCTION: 
The user has requested to MIRROR a specific competitor's post perfectly.
Competitor: ${mirrorCompetitor}
Original Post Platform: ${mirrorPost.platform}
Original Post Date: ${mirrorPost.date}
Original Post Content: 
"${mirrorPost.content}"

Your generated content MUST emulate the exact tone, structure, topic, and pacing used in this specific post. Do not copy the text word-for-word, but write a post for the current business that achieves the exact same strategic goal and style as the mirrored post.
`;
    } else if (strategy === "mirror" && memory.competitors && memory.competitors.length > 0) {
      competitorContext = `
CRITICAL STRATEGY INSTRUCTION: 
The user has requested to MIRROR their competitors' strategies.
Below are the top competitors identified for this business:
${memory.competitors.map(c => `- ${c.name} (Socials: ${JSON.stringify(c.socials)})`).join('\n')}

Your generated content MUST emulate the tone, structure, and pacing typically used by these specific competitors in this exact industry. If they rely heavily on technical showcases, do the same. Analyze what these market leaders likely do to succeed, and adopt that exact posture for your posts.
`;
    } else if (strategy === "industry" && memory.socialFeed && memory.socialFeed.length > 0) {
      let focusText = "the macro trends, tone, and subjects that the industry leaders are currently posting about, and adopt that exact posture";
      if (industryFocus === "visuals") focusText = "the exact visual aesthetics, imagery choices, and formatting styles used by the industry leaders, and structure your visual descriptions to perfectly match them";
      if (industryFocus === "messaging") focusText = "the specific core messaging, primary hooks, and value propositions that industry leaders are emphasizing right now, and adopt that exact messaging posture";
      if (industryFocus === "format") focusText = "the content formats (e.g. fast-paced videos vs detailed text carousels) dominating the feed right now, and adapt your script/post structure to match the leading format";

      competitorContext = `
CRITICAL STRATEGY INSTRUCTION:
The user has requested to MIRROR INDUSTRY TRENDS based on their competitors' recent social media footprint.
Below is the recent social feed from top competitors in this specific industry:
${JSON.stringify(memory.socialFeed.slice(0, 15))}

Analyze ${focusText} for your posts.
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
    if (subTheme) {
      if (theme === "product") {
        const foundProduct = memory.offerings.products.find(p => p.name === subTheme || (typeof p === 'string' && p === subTheme));
        productFocusInstruction = `
CRITICAL PRODUCT FOCUS:
The user has explicitly requested that these posts focus on ONE SPECIFIC PRODUCT ONLY: "${subTheme}".
Do NOT write about general brand information or other products. Everything must revolve around this specific target product.
${foundProduct && typeof foundProduct === 'object' ? `Product Details to reference:
Description: ${foundProduct.description}
Key Features: ${foundProduct.keyFeatures?.join(', ')}
Technical Specs: ${JSON.stringify(foundProduct.technicalSpecs || {})}` : ''}
`;
      } else {
        productFocusInstruction = `
CRITICAL SUB-THEME FOCUS:
The user has explicitly requested that these posts focus specifically on: "${subTheme}".
Everything must revolve around this specific target subject. Do not deviate from this focus.
`;
      }
    }

    let trendingContext = "";
    if (trendingTopic && trendingTopic.title) {
      trendingContext = `
CRITICAL TRENDING TOPIC DIRECTIVE:
The user has selected the following topic that is TRENDING RIGHT NOW in this industry:
Trending Topic: "${trendingTopic.title}"
What it is: ${trendingTopic.description || "N/A"}
Why it matters to the business: ${trendingTopic.relevance || "N/A"}
This trend directly relates to the business's offering: ${trendingTopic.relatedProduct || "the business's products/services"}
Recommended content angle: ${trendingTopic.angle || "Connect this trend to the business's offerings"}
Source References: ${(trendingTopic.sources || []).join(", ")}

Your generated posts MUST be built around THIS trending topic as the primary subject and hook, and they MUST showcase the specific offering "${trendingTopic.relatedProduct || ""}" as the solution. Weave that product/service and the business's processes into the trend naturally — the trend is the hook, the business's "${trendingTopic.relatedProduct || "product"}" is the solution. Never produce generic content that ignores this topic. Every post must feel current, relevant, and timely because it rides this live trend.
`;
    }

    let customGoalInstruction = "";
    if (customGoal && customGoal.trim().length > 0) {
      customGoalInstruction = `
CRITICAL USER DIRECTIVE / GOAL:
The user has provided the following specific goal or context for these posts: "${customGoal}"
You MUST heavily bias the entire post narrative, structure, and focus to achieve this goal. Do not ignore this instruction!
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
      totalPosts = 5; // Always 5 variations for image
      formatInstructions = `
You must generate exactly ${totalPosts} highly engaging, deeply researched image post concepts for social media (LinkedIn/Instagram).
CRITICAL: Every single post MUST be radically unique. Do not use the same hook, the same format, or the same angle twice.

You MUST output your response as a valid JSON array containing exactly ${totalPosts} objects. Do not include any other text outside the JSON array.
Format each object in the array with the EXACT following keys:
[
  {
    "visualIdea": "[Describe a visually disruptive graphic, chart, or raw image idea. Avoid generic stock photo descriptions.]",
    "content": "[Write a precise, high-converting caption that starts *in media res*. NO 'Are you tired of...' or 'Welcome to...'.]",
    "heading": "[A punchy, scroll-stopping heading]",
    "subText": "[Supporting sub-text or secondary hook]",
    "body": "[The main detailed body of the post. Integrate specific data points, R&D insights, or company history from the memory.]",
    "elements": "[List specific graphical elements, icons, or data visualization pieces to include in the design]",
    "hashtags": "[5-7 highly specific B2B hashtags space separated]"
  }
]
`;
    }

    const prompt = `You are an elite Senior Content Writer with over 20 years of experience in B2B industrial/manufacturing copywriting.
Your goal is to generate extremely high-quality, technically accurate social media content based STRICTLY on the business's data.

BUSINESS MEMORY:
${memoryContext}

INSTRUCTIONS:
${formatInstructions}

IMPORTANT RULES & B2B TONAL OVERRIDE:
1. NO FEATURE DROPPING (ANSWER "SO WHAT?"): Never just list features like "IIoT integration" or "data analytics". Tie everything to hard business consequences: lower scrap rates, faster delivery times, zero defect recalls, strict compliance. Example: Do not say "Analytics optimize performance". DO say "Live telemetry detects thermal drift in the spindle, auto-adjusting tool offsets so you get zero rejected parts in a 50,000-unit run."
2. METRIC-DRIVEN ENGINEERING STANDARDS: Never state a standard or process without stating the operational metric it protects. Don't just say "DIN-5" -> say "reduced transmission NVH and tooth friction". Don't just say "Grain Flow" -> say "elimination of structural micro-cracks under load". Don't just say "IATF 16949" -> say "flawless PPAP sign-offs and zero line-stoppage risk".
3. BAN BUZZWORD SOUP & FLUFFY MARKETING: Industrial B2B buyers are immune to corporate slogans. Never use phrases like "Precision in Every Byte", "Crafting the Future", "redefine reliability", "unparalleled", or "where data meets craftsmanship". Replace high-level adjectives (visionary, intelligent, revolutionary) with hard engineering nouns and specs (micron tolerances, spindle vibration, heat dissipation, batch consistency, PPM defect rates).
4. NO ABSTRACT VISUAL CUES (SHOP-FLOOR PROOF ONLY): For visual ideas, do not use abstract sci-fi tropes like "Connectivity lines", "data hubs", or "Glowing networks". Ground visuals in harsh industrial reality: show actual machine cross-sections, real telemetry graphs (load curves, heat maps), tolerance boundary overlays, or live operator dashboards.
5. NO REPETITIVE MESSAGING: Across your posts, the core sentence structure and angle must change dramatically. Instead of 5 posts repeating the same abstract value prop, split the core topic into distinct, high-impact business angles. Examples of distinct angles: 1) Defect Prevention (e.g. thermal tracking eliminates scrap), 2) Predictive Maintenance (e.g. tool-wear telemetry prevents downtime), 3) Traceability & Audits, 4) Cost/Efficiency Comparisons (legacy vs new), 5) Tolerance Control (handling ambient plant shifts).
6. HEADLINES & HOOKS: Must be extremely catchy, punchy, and incredibly easy to read. Avoid dense jargon in the hook to maximize broad engagement before diving into technical depth in the body.
7. IN-MEDIA-RES HOOKS: Start immediately in the middle of the action or insight. No standard greetings or rhetorical questions like "Are you looking for...?".
8. AUTHORITATIVE YET ACCESSIBLE VOICE: The narrator persona must be a grounded expert, BUT the language must be easily understandable by a normal human with zero engineering knowledge. Strip out ALL exclamation marks. While you must surface specific hard metrics, you MUST explain their ultimate value in plain, non-technical language. Do not write dense walls of jargon; make the business impact instantly clear to anyone.
9. DEEP MEMORY INTEGRATION: You must heavily utilize the \`rdInsights\`, \`businessIdentity\`, and \`brandPositioning\` arrays. Weave the company's specific vision, history, and R&D gaps/opportunities into the narrative.
10. ALIGN WITH VISION & THEME: The content MUST implicitly reflect the core vision of the business AND strictly adhere to the following theme directive:
   >> ${themeInstruction}
11. You must generate EXACTLY ${totalPosts} posts.
12. CRITICAL LANGUAGE RULE: You must write the entire output (including scripts, captions, and visual descriptions) exclusively in the **${language}** language.

${customGoalInstruction}
${customInstructionsContext}
${competitorContext}
${productFocusInstruction}
${trendingContext}

Begin generating the posts now:`;

    try {
      const response = await llm.invoke(prompt);
      const content = typeof response.content === "string" ? response.content : "";
      let posts: string[] = [];
      if (type === "image") {
        try {
          const start = content.indexOf('[');
          const end = content.lastIndexOf(']');
          if (start !== -1 && end !== -1) {
             const parsed = JSON.parse(content.substring(start, end + 1));
             posts = parsed.map((p: any) => JSON.stringify(p));
          } else {
             logger.error("Failed to find JSON array in response.");
             posts = [];
          }
        } catch(e) {
          logger.error("Failed to parse JSON response.");
          posts = [];
        }
      } else {
        posts = content.split("---").map((p: string) => p.trim()).filter((p: string) => p.length > 20);
      }
      return posts.slice(0, totalPosts);
    } catch (e: any) {
      logger.error(`SMM generation failed: ${e.message}`);
      throw e;
    }
  }
}
