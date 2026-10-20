import { createChatModel } from "../utils/llm.js";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory } from "../types.js";

const logger = createLogger("SmmAgent");

export class SmmAgent {
  readonly name = "smm-agent";
  readonly version = "1.0.0";

  async run(memory: StructuredMemory, type: "video" | "image", totalPosts: number, language: string = "English", strategy: string = "new", theme: string = "brand", subTheme?: string, mirrorCompetitor?: string, mirrorPost?: any, industryFocus?: string, customGoal?: string, trendingTopic?: any): Promise<string[]> {
    logger.info(`Generating ${totalPosts} SMM ${type} posts in ${language} for ${memory.input.websiteUrl} (Strategy: ${strategy}, Theme: ${theme}, SubTheme: ${subTheme || 'None'}, Industry Focus: ${industryFocus || 'all'}, Trending Topic: ${trendingTopic?.title || 'None'})...`);

    const llm = createChatModel({
      model: "gpt-4o",
      temperature: 0.85,
      maxTokens: 8192,
    });

    const ind = (memory.businessIdentity?.industry || memory.businessIdentity?.subIndustry || "").toLowerCase();
    const isMfg = /manufactur|forg|machin|casting|steel|metal|industrial|engineering|auto|component|bearing|valve/i.test(ind);
    const isTech = /software|technology|it|saas|cloud|data|platform/i.test(ind);
    const isAgri = /seed|agri|crop|farming|fertilizer/i.test(ind);
    const isAgency = /marketing|seo|advertising|digital|media|branding/i.test(ind);

    const memoryContext = JSON.stringify({
      businessIdentity: {
        officialName: memory.businessIdentity?.officialName,
        industry: memory.businessIdentity?.industry,
        subIndustry: memory.businessIdentity?.subIndustry,
        location: memory.businessIdentity?.location,
        vision: memory.businessIdentity?.vision,
        description: memory.businessIdentity?.description,
      },
      offerings: {
        products: (memory.offerings?.products || []).map(p => typeof p === 'string' ? { name: p } : {
          name: p.name,
          category: p.category,
          description: p.description,
          keyFeatures: p.keyFeatures,
          technicalSpecs: p.technicalSpecs,
          useCases: p.useCases,
          subProducts: p.subProducts
        }),
        services: (memory.offerings?.services || []).map(s => typeof s === 'string' ? { name: s } : {
          name: s.name,
          description: s.description,
          applications: s.applications,
          processes: s.processes
        }),
        valuePropositions: memory.offerings?.valuePropositions || []
      },
      targetAudience: {
        buyerPersonas: memory.audience?.buyerPersonas || [],
        targetIndustries: memory.audience?.targetIndustries || [],
        geographies: memory.audience?.geographies || []
      },
      brandPositioning: {
        tone: memory.brandPositioning?.tone,
        positioning: memory.brandPositioning?.positioning,
        usps: memory.brandPositioning?.usps || [],
        messagingStyle: memory.brandPositioning?.messagingStyle
      },
      processes: (memory.processes?.processes || []).map(pr => ({
        name: pr.name,
        description: pr.description,
        workflow: pr.workflow,
        machineryUsed: pr.machineryUsed,
        capacity: pr.capacity
      })),
      rdInsights: {
        opportunities: memory.rdInsights?.opportunities || [],
        gaps: memory.rdInsights?.gaps || [],
        improvements: memory.rdInsights?.improvements || []
      }
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
        themeInstruction = "THEME: BRAND. Focus heavily on the company's overarching vision, history, scale, certified standards, and core ethos. Build trust, credibility, and authority.";
        break;
      case "product":
        themeInstruction = "THEME: PRODUCT. Focus heavily on specific product features, exact specifications, direct operational benefits, and the problems they solve for buyers.";
        break;
      case "technical":
        themeInstruction = "THEME: TECHNICAL CAPABILITIES & SERVICES. Deep dive into execution precision. Highlight technical capabilities, tolerances, workflows, testing certifications, and R&D advantages.";
        break;
      case "educative":
        themeInstruction = "THEME: INFORMATIVE/EDUCATIVE. Act as a recognized industry authority. Demystify complex industry challenges, share selection/maintenance criteria, and educate target buyers.";
        break;
      case "ugc":
        themeInstruction = "THEME: AUTHENTIC / BEHIND-THE-SCENES. Showcase real operations, factory/office floor execution, employee expertise, customer delivery milestones, and authentic pride in quality.";
        break;
      default:
        themeInstruction = "THEME: BRAND. Focus heavily on the company's overarching vision, scale, and strategic value.";
    }

    let subThemeFocusInstruction = "";
    if (subTheme) {
      const trimmedSubTheme = subTheme.trim();
      const foundProduct = (memory.offerings?.products || []).find(p => (typeof p === 'string' ? p : p.name).toLowerCase() === trimmedSubTheme.toLowerCase());
      const foundService = (memory.offerings?.services || []).find(s => (typeof s === 'string' ? s : s.name).toLowerCase() === trimmedSubTheme.toLowerCase());
      const foundProcess = (memory.processes?.processes || []).find(pr => pr.name.toLowerCase() === trimmedSubTheme.toLowerCase());

      if (foundProduct) {
        const pObj = typeof foundProduct === 'object' ? foundProduct : { name: String(foundProduct), category: "Core Offering", description: "", keyFeatures: [] as string[], technicalSpecs: {}, useCases: [] as string[] };
        subThemeFocusInstruction = `
CRITICAL TARGET PRODUCT FOCUS:
The user explicitly chose to focus this entire campaign on ONE TARGET PRODUCT: "${pObj.name}".
Every post narrative, hook, body, and technical specs MUST spotlight this product!
Product Details to strictly base content on:
- Product Name: ${pObj.name}
- Category: ${pObj.category || 'Core Offering'}
- Description: ${pObj.description || 'Specialized product engineered for high performance'}
${pObj.keyFeatures && pObj.keyFeatures.length ? `- Key Features: ${pObj.keyFeatures.join(', ')}` : ''}
${pObj.technicalSpecs && Object.keys(pObj.technicalSpecs).length ? `- Technical Specs: ${JSON.stringify(pObj.technicalSpecs)}` : ''}
${pObj.useCases && pObj.useCases.length ? `- Practical Use Cases: ${pObj.useCases.join(', ')}` : ''}
`;
      } else if (foundService) {
        const sObj = typeof foundService === 'object' ? foundService : { name: foundService, description: "", applications: [], processes: [] };
        subThemeFocusInstruction = `
CRITICAL TARGET CAPABILITY / SERVICE FOCUS:
The user explicitly chose to focus this campaign on ONE TARGET SERVICE/CAPABILITY: "${sObj.name}".
Every post narrative, hook, body, and workflow MUST spotlight this capability!
Capability Details to strictly base content on:
- Capability Name: ${sObj.name}
- Description: ${sObj.description || 'Specialized professional capability'}
${sObj.applications && sObj.applications.length ? `- Target Applications: ${sObj.applications.join(', ')}` : ''}
${sObj.processes && sObj.processes.length ? `- Execution Workflow / Processes: ${sObj.processes.join(', ')}` : ''}
`;
      } else if (foundProcess) {
        subThemeFocusInstruction = `
CRITICAL MANUFACTURING / PROCESS FOCUS:
The user explicitly chose to focus this campaign on ONE TARGET PROCESS/WORKFLOW: "${foundProcess.name}".
- Description: ${foundProcess.description}
${foundProcess.workflow && foundProcess.workflow.length ? `- Workflow Stages: ${foundProcess.workflow.join(' -> ')}` : ''}
${foundProcess.machineryUsed && foundProcess.machineryUsed.length ? `- Machinery / Technology: ${foundProcess.machineryUsed.join(', ')}` : ''}
${foundProcess.capacity ? `- Operational Capacity: ${foundProcess.capacity}` : ''}
`;
      } else {
        subThemeFocusInstruction = `
CRITICAL SUB-THEME FOCUS:
The user explicitly requested that all posts focus specifically on: "${trimmedSubTheme}".
Anchor the narrative around this specific focus and connect it directly to the business's real offerings and capabilities.
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

Your generated posts MUST be built around THIS trending topic as the primary subject and hook, and they MUST showcase the specific offering "${trendingTopic.relatedProduct || ""}" as the solution. Weave that product/service and the business's processes into the trend naturally — the trend is the hook, the business's "${trendingTopic.relatedProduct || "product"}" is the solution. Never produce generic content that ignores this topic.
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
      const sfxGuide = isMfg
        ? "Heavy industrial sounds (e.g. hydraulic press strike, CNC spindle acceleration, metallic clink, furnace hum)"
        : isTech
        ? "Modern tech sound design (e.g. subtle digital pulse, UI haptic click, low ambient synth swell, data whoosh)"
        : isAgri
        ? "Grounded agricultural/natural audio (e.g. deep tractor engine rumble, breeze through dense crops, laboratory seed dispenser click)"
        : isAgency
        ? "Dynamic modern audio (e.g. upbeat beat drop, crisp transition whoosh, clean UI acoustic click)"
        : "Authoritative professional corporate sound design (e.g. crisp whoosh, confident ambient tone)";

      formatInstructions = `
You must act as a master video editor and director creating highly engaging, fast-paced cinematic short-form content (Reels/Shorts/TikToks/LinkedIn Video). 
Generate exactly ${totalPosts} short-form video scripts (30 seconds each).
CRITICAL: Every single script MUST focus on a completely DIFFERENT topic/angle from the company's memory. Do NOT repeat the same script.

Format each script explicitly as follows:
---
### Post [Number]: [Catchy Title]
**Topic Focus:** [State the specific product/service/capability this video focuses on]
**Target Persona:** [State which specific Buyer Persona from memory this video speaks to]

**Scene 1: The Hook (0-3s)** 
- **Visuals:** [Dynamic visual direction, extreme close-up, fast pan, or macro shot]
- **Sound Design SFX:** [${sfxGuide}]
- **Voiceover:** [High-stakes opening line addressing the exact cost of failure, delay, or low quality for the target persona. NO clichés.]

**Scene 2: Context / Problem (3-8s)** 
- **Visuals:** [Visuals establishing the operational challenge or application context]
- **Sound Design SFX:** [Ambient context audio]
- **Voiceover:** [Explaining the specific challenge faced in this industry]

**Scene 3: The Solution / Offering (8-15s)** 
- **Visuals:** [Cinematic reveal of the company's specific product or service execution]
- **Sound Design SFX:** [Punctual impact SFX]
- **Voiceover:** [Introducing the company's exact component/service by name. Surface hard metrics, specs, or proven advantages from memory.]

**Scene 4: Execution & Precision (15-22s)** 
- **Visuals:** [Close-up on craftsmanship, quality testing, CNC machining, software dashboard, or specialized process]
- **Sound Design SFX:** [Precision operational sound]
- **Voiceover:** [Highlighting exact technical specifications, certified tolerances, or delivery workflow from memory]

**Scene 5: Real-World Application (22-26s)** 
- **Visuals:** [Footage of the solution performing in its real-world assembly or business environment]
- **Sound Design SFX:** [Resonant deep audio swell]
- **Voiceover:** [Connecting this component/service to the client's bottom-line reliability and success]

**Scene 6: Call to Action (26-30s)** 
- **Visuals:** [High-contrast frame with clean typography overlay of "${memory.businessIdentity?.officialName || 'The Company'}" and headquarters location]
- **Sound Design SFX:** [Crisp concluding lock-in sound]
- **Voiceover:** [Authoritative, grounded B2B call to action inviting inquiries or consultations]
---
`;
    } else {
      totalPosts = 5; // Always 5 variations for image
      formatInstructions = `
You must generate exactly ${totalPosts} highly engaging, deeply researched image post concepts for social media (LinkedIn/Instagram).
CRITICAL: Every single post MUST be radically unique, exploring different products, services, value propositions, and buyer personas.

You MUST output your response as a valid JSON array containing exactly ${totalPosts} objects. Do not include any other text outside the JSON array.
Format each object in the array with the EXACT following keys:
[
  {
    "visualIdea": "[Describe a visually disruptive graphic, chart, schematic, or raw photography idea grounded in the company's real operations. Avoid generic corporate stock descriptions.]",
    "content": "[Write a precise, high-converting caption that starts *in media res* and addresses a specific operational reality of the target buyer persona.]",
    "heading": "[A punchy, scroll-stopping heading tailored to the company's offering]",
    "subText": "[Supporting sub-text or secondary hook containing a quantifiable fact or benefit]",
    "body": "[The main detailed body of the post. Integrate specific data points, technical specifications, USPs, or company vision from the memory.]",
    "elements": "[List specific graphical elements, callout boxes, diagrams, or typography to include in the visual design]",
    "hashtags": "[5-7 highly targeted B2B hashtags matching the company's industry and offering, space separated]"
  }
]
`;
    }

    let brandVoiceAndAntiRepetitionContext = "";
    const ownPosts = (memory.ownSocialFeed || []) as any[];
    const voice = memory.brandVoicePattern;

    if (ownPosts.length > 0 || voice) {
      const recentPostsList = ownPosts.slice(0, 15).map((p, idx) => {
        const plat = p.platform || "Social";
        const dt = p.date || p.published_date || "";
        const cap = (p.caption || p.content || "").slice(0, 200).replace(/\n+/g, " ");
        return `- [${plat}${dt ? ' ' + dt : ''}] ${cap}`;
      }).join("\n");

      const recentTopicsList = (voice?.recentPostTopics && voice.recentPostTopics.length > 0)
        ? voice.recentPostTopics.map(t => `- "${t}"`).join("\n")
        : ownPosts.slice(0, 10).map(p => `- "${(p.caption || p.content || "").slice(0, 80)}"`).join("\n");

      const voiceDirectives = voice ? `
COMPANY'S VERIFIED BRAND VOICE & POSTING PATTERN:
- Caption Style: ${voice.captionStyle || 'Professional and engaging'}
- Tone: ${voice.tone || 'Authoritative industry leader'}
- Signature Hashtags (include these naturally): ${(voice.signatureHashtags || []).join(' ')}
- Preferred Call-To-Action Style: ${(voice.preferredCTAs || []).join(' | ')}
- Typical Content Themes: ${(voice.frequentThemes || []).join(', ')}
- Formatting Habits: ${(voice.formattingPreferences || []).join(', ')}
` : "";

      brandVoiceAndAntiRepetitionContext = `
======================================================================
CRITICAL ANTI-REPETITION SHIELD & BRAND VOICE ALIGNMENT:
The company has already published the following posts on their official social accounts:
${recentPostsList || 'No raw posts available, but recent topics were indexed.'}

RECENT TOPICS ALREADY COVERED BY THE COMPANY:
${recentTopicsList}

${voiceDirectives}

MANDATORY RULES:
1. ANTI-REPETITION: You MUST NOT repeat, rehash, or clone the topics, headlines, or announcements listed above. Pick an untouched product/service, a different engineering process, an alternate buyer persona, or a complementary storyline.
2. VOICE ADOPTION: Emulate the company's verified caption style, tone, and formatting habits so the output feels like their authentic in-house marketing team wrote it.
======================================================================
`;
    }

    const personasList = (memory.audience?.buyerPersonas || []).join(", ") || "Industry Buyers & Decision Makers";

    const prompt = `You are a world-class Chief Content Strategist & B2B Copywriter.
Your goal is to generate extremely high-quality, technically accurate, and deeply compelling social media content based STRICTLY on the business's provided data.

==================== BUSINESS INTELLIGENCE MEMORY ====================
${memoryContext}
======================================================================

INSTRUCTIONS & FORMAT:
${formatInstructions}

CORE RULES FOR POWERFUL & GROUNDED CONTENT:
1. 100% GROUNDED IN REAL DATA:
   - Every post MUST be strictly based on the provided company memory (Official Name: ${memory.businessIdentity?.officialName || 'Business'}, Industry: ${memory.businessIdentity?.industry || ''}, Vision: "${memory.businessIdentity?.vision || ''}").
   - Directly feature the real products, real services, and real processes listed above. Do NOT make up fictitious products or irrelevant capabilities.
2. BUYER PERSONA TARGETING:
   - The company's real target buyer personas are: [${personasList}].
   - Every post must speak directly to the real-world priorities, headaches, and KPIs of these personas (e.g., zero defect tolerance, supply chain predictability, lower scrap rates, rapid turnaround, technical compliance).
3. "SO WHAT?" BENEFIT-DRIVEN COPYWRITING:
   - Never just drop technical features in isolation. Always answer "So what does this mean for the client?".
   - Connect precision tolerances to zero assembly rework; connect certified quality testing to eliminated line-stoppage risk; connect tailored services to accelerated time-to-market.
4. BAN BUZZWORD FLUFF:
   - Ban generic corporate clichés like "redefining excellence", "crafting the future", "unparalleled synergy", or "passion for quality".
   - Replace generic fluff with hard nouns, verifiable metrics, real materials, real use-cases, and concrete business outcomes.
5. GROUNDED VISUAL DIRECTION:
   - For image visual ideas and video scenes, ground them in real physical environments (actual machine cross-sections, real component close-ups, inspection reports, CAD wireframes, workflow schematics, or clean data overlays).
6. HOOKS & HEADLINES:
   - Start immediately *in media res* (in the middle of the action/insight). No boring rhetorical greetings like "Are you looking for...?" or "Welcome to...".
7. REFLECT CORE VISION & THEME:
   - Weave the company's overarching vision and description into the posts naturally.
   - Strictly adhere to the selected theme directive:
     >> ${themeInstruction}
8. EXACT COUNT: You must generate EXACTLY ${totalPosts} posts.
9. LANGUAGE REQUIREMENT: You must write the entire output exclusively in the **${language}** language.

${customGoalInstruction}
${customInstructionsContext}
${competitorContext}
${subThemeFocusInstruction}
${trendingContext}
${brandVoiceAndAntiRepetitionContext}

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
