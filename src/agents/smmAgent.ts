import { createChatModel } from "../utils/llm.js";
import { createLogger } from "../utils/logger.js";
import type { StructuredMemory } from "../types.js";

const logger = createLogger("SmmAgent");

interface ContentArchetype {
  angle: string;
  role: string;
  objective: string;
  hookRule: string;
  visualRule: string;
  bodyStyle: string;
}

function getArchetypesForCampaign(
  totalPosts: number,
  theme: string,
  subTheme?: string,
  customGoal?: string,
  memory?: StructuredMemory
): ContentArchetype[] {
  const companyName = memory?.businessIdentity?.officialName || "The Company";
  const targetProduct = subTheme || "Core Offerings";

  let archetypes: ContentArchetype[] = [];

  if (theme === "product" || subTheme) {
    archetypes = [
      {
        angle: "Failure Mode & Engineering Solution",
        role: "The Diagnostic Forensic Metallurgist",
        objective: `Analyze an expensive mechanical or operational failure point in client machinery/assemblies (e.g. tooth root fatigue under cyclic torque, thermal wear, micro-cracks in castings, hydraulic seal blowouts). Detail the continuous grain flow, metallurgical integrity, and exact forged specifications of ${targetProduct} that eliminate this failure mode.`,
        hookRule: "Start immediately in media res with the exact failure point, machine breakdown risk, or costly downtime scenario. Zero generic intros.",
        visualRule: "Split-screen CAD diagram or macro teardown photo: cracked generic alternative vs continuous forged grain flow with stress-vector overlay.",
        bodyStyle: "Diagnostic cause-and-effect breakdown: Problem -> Metallurgical Root Cause -> Engineering Solution -> Client Machine Reliability."
      },
      {
        angle: "Technical Spec Teardown & Micron Precision",
        role: "The Chief Metrologist / Tooling Director",
        objective: `Unpack the raw engineering numbers from memory for ${targetProduct}: exact DIN tolerances, surface finish (e.g. Ra ≤ 0.8 µm), CNC multi-axis tooling, induction heating temperatures, and 3D CMM coordinate inspection. Zero fluff, pure engineering authority.`,
        hookRule: "Start with an unassailable engineering metric, tolerance threshold, or material grade from memory. Cite hard numbers immediately.",
        visualRule: "Exploded CAD schematic with dimensional tolerance callouts, surface roughness graph, or 3D CMM ruby coordinate probe measuring the component.",
        bodyStyle: "Data-dense specification sheet formatted with technical bullet points, machine verification stages, and material chemistry."
      },
      {
        angle: "Procurement ROI & Scrap Reduction",
        role: "The Supply Chain & Commercial Strategist",
        objective: `Address the OEM Procurement Director and Plant Manager's financial bottom-line: near-net shape forming reducing machining cycle times by 20-30%, 15% raw material savings, zero assembly rework, and guaranteed batch-to-batch traceability for global supply chains.`,
        hookRule: "Start with a hard commercial calculation: CNC machining hours wasted, raw billet scrap disposal costs, or supply-chain audit penalties.",
        visualRule: "Dynamic ROI dashboard, cycle-time comparison bar chart, or cost-per-part savings breakdown comparing near-net shape vs traditional machining.",
        bodyStyle: "Executive business case detailing machining cycle reduction, scrap cost savings, batch traceability, and Year-1 ROI."
      },
      {
        angle: "Technical Face-Off / Myth vs Engineering Reality",
        role: "The Industry Challenger",
        objective: `Directly challenge an accepted industry shortcut (e.g. 'Why Standard Castings Crack Under Dynamic Shock While Closed-Die Forgings Endure 10x Fatigue Life' or 'Standard Bar Machining vs Near-Net Broached Blanks'). Provide an unapologetic technical comparison.`,
        hookRule: "Start with a provocative comparative question or bold statement busting an industry compromise.",
        visualRule: "Side-by-side split comparison visual ('Standard Market Shortcut' vs 'Our Certified Engineering Standard').",
        bodyStyle: "Direct comparison table or side-by-side analysis contrasting material density, cycle life, and total cost of ownership."
      },
      {
        angle: "Shop-Floor Execution & Zero-Defect Quality Gate",
        role: "The Master Craftsman & Quality Director",
        objective: `Take the reader inside the actual manufacturing facility at the moment of truth: induction heating, 2000-ton forging impact, or optical emission spectro testing where any part off by 0.02mm is scrapped on the spot. Showcase true manufacturing pride and verifiable quality control.`,
        hookRule: "Start in the visceral heat of the action on the plant floor. The sound, temperature, or exact laser measurement.",
        visualRule: "Raw, dynamic photography: glowing red billet under the 2000T press, coolant flood in a CNC milling center, or laser-guided CMM inspection.",
        bodyStyle: "Step-by-step walkthrough of the internal inspection milestones: raw billet testing -> closed-die forming -> CNC finishing -> final coordinate metrology."
      }
    ];
  } else if (theme === "brand") {
    archetypes = [
      {
        angle: "Global Supply Chain Role & Mission Reliability",
        role: "The Executive Vice President of Global Operations",
        objective: `Position ${companyName} not just as a vendor, but as an indispensable engineering partner powering critical mobility, aerospace, and energy infrastructure across global supply networks.`,
        hookRule: "Start with the high-stakes reality of critical mechanical assemblies operating thousands of miles away.",
        visualRule: "Global supply chain map with interconnected logistics nodes and high-precision components highlighted in aerospace/automotive assemblies.",
        bodyStyle: "Strategic thought-leadership narrative connecting engineering precision to global infrastructure stability."
      },
      {
        angle: "Infrastructure & Heavy Machinery Investment",
        role: "The Director of Plant Modernization & IIoT",
        objective: `Showcase the sheer scale and technological firepower inside the facility: closed-die hammer lines, automated induction heating, multi-axis CNC cells, and digital quality monitoring.`,
        hookRule: "Start with a striking stat about plant capacity, press tonnage, or capital reinvestment in next-generation machinery.",
        visualRule: "Wide-angle architectural/industrial view of the plant floor featuring multi-ton presses and robotic automation.",
        bodyStyle: "Infrastructure spotlight detailing equipment specifications, daily capacity, and digital manufacturing capabilities."
      },
      {
        angle: "Zero-Defect Culture & Certified Standards",
        role: "The Head of Global Quality & Compliance",
        objective: `Highlight rigorous quality management (ISO, IATF 16949, DIN standards), transparent audit trails, and the uncompromising standard that governs every batch.`,
        hookRule: "Start with the threshold where other suppliers compromise, but ${companyName} draws the line.",
        visualRule: "Certified inspection report overlay on a finished component with quality stamps and dimensional verification checks.",
        bodyStyle: "Quality charter breaking down the testing protocols (ultrasonic, spectro, dimensional) that protect client reputation."
      },
      {
        angle: "Engineering Heritage Meets Modern IIoT",
        role: "The Chief Technology Evangelist",
        objective: "Contrast foundational manufacturing craftsmanship with modern Industry 4.0 data traceability—sensors on presses, automated tool wear tracking, and digital certificates.",
        hookRule: "Start with the evolution of precision manufacturing from art to predictive digital science.",
        visualRule: "Dual imagery showing classic forging fire seamlessly merging with digital telemetry overlays and sensor data.",
        bodyStyle: "Compelling narrative on modernizing manufacturing without losing physical metallurgical mastery."
      },
      {
        angle: "Client Partnership Proof & OEM Export Footprint",
        role: "The Global Accounts Director",
        objective: "Prove reliability through export performance: delivering to Tier-1 OEMs and demanding international markets with on-time predictability and zero line disruptions.",
        hookRule: "Start with a milestone metric: thousands of parts delivered across continents with zero assembly rejections.",
        visualRule: "Clean infographic showcasing export destinations, container shipments, and long-term partnership retention stats.",
        bodyStyle: "Case-study style summary of supplier reliability and long-term supply chain security for international buyers."
      }
    ];
  } else if (theme === "technical") {
    archetypes = [
      {
        angle: "Micro-Tolerances & 5-Axis CNC Precision",
        role: "The Chief Machinist",
        objective: "Deep-dive into CNC toolpaths, spindle dynamics, live tooling, and holding ±0.01mm across high-volume production batches.",
        hookRule: "Start with the physics of machining deflection and how proper tooling eliminates dimensional drift.",
        visualRule: "Close-up action macro: high-speed carbide endmill shaving hardened alloy steel with high-pressure coolant stream.",
        bodyStyle: "Machining case study: tooling selection, spindle speed, feeds, and surface finish metrics."
      },
      {
        angle: "Metallurgical Grain-Flow & Thermal Quenching",
        role: "The Senior Metallurgical Engineer",
        objective: "Explain how induction billet heating and closed-die forging align molecular grain flow along the component's contours to multiply fatigue life.",
        hookRule: "Start with the microscopic difference between cast crystalline structures and forged grain alignment under stress.",
        visualRule: "Etched metallurgical cross-section showing continuous grain flow lines under microscopic magnification.",
        bodyStyle: "Material science breakdown: heat-treatment curves, grain flow comparison, and Rockwell hardness consistency."
      },
      {
        angle: "Metrology Lab & Coordinate Measurement (CMM)",
        role: "The Quality Metrologist",
        objective: "Highlight non-destructive testing (NDT), 3D CMM coordinate inspection, optical emission spectrometry, and ultrasonic scanning.",
        hookRule: "Start with the exact micron threshold that separates an acceptable part from a scrapped part in the testing lab.",
        visualRule: "Ruby-tipped CMM touch probe making contact with an intricate machined surface with digital coordinate overlay.",
        bodyStyle: "Testing protocol breakdown: raw material verification -> in-process gauging -> final 3D coordinate mapping."
      },
      {
        angle: "Design for Manufacturability (DFM) & Tooling",
        role: "The Application Engineering Lead",
        objective: "Demonstrate how early engineering collaboration with clients refines part geometry to eliminate stress concentrations and reduce machining time.",
        hookRule: "Start with an engineering design tweak that saved 25% in cycle time without compromising strength.",
        visualRule: "CAD wireframe comparison highlighting draft angles, fillet radii, and near-net forging contours.",
        bodyStyle: "Collaborative engineering story: from client 2D/3D print to optimized tooling and rapid first-article inspection."
      },
      {
        angle: "Near-Net Shape Forming & Energy Efficiency",
        role: "The Process Optimization Engineer",
        objective: "Detail the near-net shape broaching and closed-die process that minimizes scrap steel and slashes final machining hours.",
        hookRule: "Start with the exact kilograms of steel saved per thousand components through near-net precision.",
        visualRule: "Step-by-step progressive forging stages from raw billet to finished broached blank.",
        bodyStyle: "Process efficiency breakdown: material utilization rates, energy optimization, and cycle-time savings."
      }
    ];
  } else if (theme === "educative") {
    archetypes = [
      {
        angle: "Industry Diagnostic: 3 Failure Signs in High-Torque Drivetrains",
        role: "The Senior Industry Consultant",
        objective: "Educate mechanical engineers on the early warning indicators of fatigue wear, micro-cracking, and backlash in heavy assemblies.",
        hookRule: "Start with a direct warning sign that mechanical designers frequently overlook until field failure occurs.",
        visualRule: "Technical diagnostic checklist graphic with illustrative component wear schematics.",
        bodyStyle: "Educational breakdown of symptom -> underlying physics -> component selection criteria."
      },
      {
        angle: "Grain Flow vs Porosity: The Metallurgist's Guide",
        role: "The Materials Science Educator",
        objective: "Demystify why internal porosity in castings causes catastrophic shear, while forged grain flow distributes load.",
        hookRule: "Start with the invisible flaw inside metal that ultrasonic testing reveals immediately.",
        visualRule: "High-contrast infographic comparing cast internal porosity vs forged dense molecular alignment.",
        bodyStyle: "Authoritative educational explanation breaking down fatigue thresholds and fracture mechanics."
      },
      {
        angle: "DIN-5 vs DIN-7: What Gear Accuracy Actually Costs in Energy Loss",
        role: "The Powertrain Efficiency Specialist",
        objective: "Showcase the mathematical link between gear tooth profile accuracy, friction heat, vibration, and total mechanical efficiency.",
        hookRule: "Start with the percentage of energy wasted when gear tooth accuracy drops by just two DIN classes.",
        visualRule: "Efficiency curve chart plotting transmission energy loss against gear tolerance classes.",
        bodyStyle: "Engineering analysis explaining tooth contact pattern, noise reduction, and lifetime energy savings."
      },
      {
        angle: "Near-Net Broaching Explained: Why Machining from Solid Bar Is Outdated",
        role: "The Modern Manufacturing Analyst",
        objective: "Educate procurement and engineering teams on how near-net shape blanks eliminate 70% of redundant machining passes.",
        hookRule: "Start with the hidden machine-hour cost of cutting away expensive alloy steel from solid billets.",
        visualRule: "Cross-sectional comparison showing solid bar machining waste vs near-net shape forging contours.",
        bodyStyle: "Educational guide comparing cycle times, tool wear, and material utilization."
      },
      {
        angle: "The 5-Point Quality Checklist Before Approving Custom Tooling",
        role: "The Tooling & Sourcing Auditor",
        objective: "Provide procurement managers and lead engineers with a practical audit checklist for evaluating component manufacturing partners.",
        hookRule: "Start with the 5 questions that protect your supply chain from delayed tooling and out-of-spec batches.",
        visualRule: "Numbered audit checklist card with clear verification icons and inspection milestones.",
        bodyStyle: "Actionable 5-point checklist covering raw material traceability, tooling draft angles, CMM inspection, and heat-treat certificates."
      }
    ];
  } else {
    // UGC / Behind-the-Scenes & Authentic
    archetypes = [
      {
        angle: "Behind the Controls: 5-Axis CNC Toolpaths with Zero Runout",
        role: "The Senior CNC Machinist",
        objective: "An authentic, first-person look at what it takes to dial in a high-speed milling setup for complex automotive components.",
        hookRule: "Start with the sound of the spindle spinning up to speed and the precision dial reading zero runout.",
        visualRule: "First-person perspective photo looking into the CNC enclosure: carbide cutter poised above component with digital readout.",
        bodyStyle: "Authentic craftsman story detailing tool calibration, surface finish pride, and zero tolerance for vibration."
      },
      {
        angle: "The Red-Hot Forge: 2000-Ton Press Strike at 850°C",
        role: "The Forge Master",
        objective: "Visceral, raw shop-floor authenticity: transferring white-hot induction-heated billets into the forging die under massive tonnage.",
        hookRule: "Start with the intense heat, the glowing orange billet, and the ground-shaking impact of the press.",
        visualRule: "Action shot with sparks flying as the closed-die hammer strikes the glowing steel billet.",
        bodyStyle: "First-person operational narrative on controlling billet temperature, die lubrication, and forging cadence."
      },
      {
        angle: "Inside the Metrology Room: Measuring Down to the Micron",
        role: "The Quality Metrologist",
        objective: "Showcase the quiet, temperature-controlled inspection laboratory where parts are measured with laser and ruby probes.",
        hookRule: "Start with the absolute stillness of the metrology lab where a 1-degree temperature change alters measurements.",
        visualRule: "Close-up photo of ruby CMM stylus touching a pristine machined ring with green tolerance check on screen.",
        bodyStyle: "Behind-the-scenes walkthrough of 100% dimensional verification before packing."
      },
      {
        angle: "The Metallurgist's Bench: Spectrometry Before Billet Release",
        role: "The Laboratory Chemist",
        objective: "Take readers into the chemical testing lab where raw steel melts undergo optical emission spectrometry to verify alloy composition.",
        hookRule: "Start with the test burn: a flash of electrical arc revealing the exact carbon and chromium percentages.",
        visualRule: "Photo of laboratory spectrometer spark stand with live spectral chemical readout on monitor.",
        bodyStyle: "Insider look at chemical certificate verification ensuring raw steel meets exact DIN/ASTM specifications."
      },
      {
        angle: "The Dispatch Bay: Crating Precision for International OEMs",
        role: "The Export Logistics Lead",
        objective: "Follow the final stage: corrosion-inhibiting packaging, ultrasonic batch certificates, and container loading for European OEMs.",
        hookRule: "Start with the final barcode scan that confirms an international batch is sealed, certified, and ready for transit.",
        visualRule: "Neatly crated, shrink-wrapped batches of precision components with international shipping labels and quality tags.",
        bodyStyle: "Operational pride in zero shipping damage, vacuum packaging, and guaranteed on-time port delivery."
      }
    ];
  }

  return archetypes.slice(0, Math.min(Math.max(totalPosts, 1), 5));
}

export class SmmAgent {
  readonly name = "smm-agent";
  readonly version = "2.0.0";

  async run(
    memory: StructuredMemory,
    type: "video" | "image",
    totalPosts: number,
    language: string = "English",
    strategy: string = "new",
    theme: string = "brand",
    subTheme?: string,
    mirrorCompetitor?: string,
    mirrorPost?: any,
    industryFocus?: string,
    customGoal?: string,
    trendingTopic?: any,
    targetPersona?: string,
    targetPlatform?: string
  ): Promise<string[]> {
    logger.info(`Generating ${totalPosts} SMM ${type} posts in ${language} for ${memory.input.websiteUrl} (Strategy: ${strategy}, Theme: ${theme}, SubTheme: ${subTheme || 'None'}, Platform: ${targetPlatform || 'All'}, Persona: ${targetPersona || 'all'}, Industry Focus: ${industryFocus || 'all'}, Trending Topic: ${trendingTopic?.title || 'None'})...`);

    const postCount = Math.min(Math.max(totalPosts || 3, 1), 5);
    const calculatedMaxTokens = type === "video"
      ? Math.min(Math.max(postCount * 900 + 600, 2400), 3800)
      : Math.min(Math.max(postCount * 800 + 600, 2400), 3800);

    const llm = createChatModel({
      model: "gpt-4o",
      temperature: 0.85,
      maxTokens: calculatedMaxTokens,
    });

    const ind = (memory.businessIdentity?.industry || memory.businessIdentity?.subIndustry || "").toLowerCase();
    const isMfg = /manufactur|forg|machin|casting|steel|metal|industrial|engineering|auto|component|bearing|valve/i.test(ind);
    const isTech = /software|technology|it|saas|cloud|data|platform/i.test(ind);
    const isAgri = /seed|agri|crop|farming|fertilizer/i.test(ind);

    const subThemeLower = (subTheme || "").toLowerCase().trim();

    // Select targeted products (prioritize selected subTheme, max 4 total to keep context punchy)
    const allRawProducts = memory.offerings?.products || [];
    const matchedProduct = allRawProducts.find(p => (typeof p === 'string' ? p : p.name).toLowerCase() === subThemeLower);
    const otherProducts = allRawProducts.filter(p => (typeof p === 'string' ? p : p.name).toLowerCase() !== subThemeLower).slice(0, 3);
    const selectedProducts = matchedProduct ? [matchedProduct, ...otherProducts] : allRawProducts.slice(0, 4);

    // Select targeted services (max 3)
    const allRawServices = (memory.offerings?.services || []).slice(0, 3);

    const memoryContext = JSON.stringify({
      businessIdentity: {
        officialName: memory.businessIdentity?.officialName,
        industry: memory.businessIdentity?.industry,
        subIndustry: memory.businessIdentity?.subIndustry,
        location: memory.businessIdentity?.location,
        vision: memory.businessIdentity?.vision,
        description: (memory.businessIdentity?.description || "").slice(0, 450),
      },
      offerings: {
        products: selectedProducts.map(p => typeof p === 'string' ? { name: p } : {
          name: p.name,
          category: p.category,
          description: p.description?.slice(0, 250),
          summary: p.aiLaymanSummary?.slice(0, 350),
          keyFeatures: (p.keyFeatures || []).slice(0, 4),
          technicalSpecs: p.technicalSpecs || {},
          useCases: (p.useCases || []).slice(0, 3)
        }),
        services: allRawServices.map(s => typeof s === 'string' ? { name: s } : {
          name: s.name,
          description: s.description?.slice(0, 200),
          applications: (s.applications || []).slice(0, 2)
        }),
        valuePropositions: (memory.offerings?.valuePropositions || []).slice(0, 4)
      },
      targetAudience: {
        buyerPersonas: memory.audience?.buyerPersonas || [],
        targetIndustries: (memory.audience?.targetIndustries || []).slice(0, 4)
      },
      brandPositioning: {
        tone: memory.brandPositioning?.tone,
        usps: (memory.brandPositioning?.usps || []).slice(0, 4)
      },
      processes: (memory.processes?.processes || []).slice(0, 3).map(pr => ({
        name: pr.name,
        description: pr.description?.slice(0, 150),
        machineryUsed: (pr.machineryUsed || []).slice(0, 3)
      }))
    }, null, 2);

    let competitorContext = "";
    if (strategy === "mirror" && mirrorPost && !mirrorPost.strategyOnly && (mirrorPost.content || mirrorPost.caption)) {
      competitorContext = `
CRITICAL STRATEGY INSTRUCTION: 
The user has requested to MIRROR a specific competitor's post.
Competitor: ${mirrorCompetitor}
Original Post Platform: ${mirrorPost.platform || 'Social Media'}
Original Post Content: 
"${mirrorPost.content || mirrorPost.caption}"

Adopt the structural hook and strategic framing used in this competitor's post, but adapt it 100% to the verified technical strengths and capabilities of ${memory.businessIdentity?.officialName || 'the current business'}.
`;
    } else if (strategy === "mirror" && mirrorCompetitor) {
      const matchedComp = (memory.competitors || []).find(c => c.name.toLowerCase() === mirrorCompetitor.toLowerCase());
      competitorContext = `
CRITICAL STRATEGY INSTRUCTION: 
The user has requested to MIRROR the market authority of competitor: "${mirrorCompetitor}".
Competitor Profile:
- Name: ${mirrorCompetitor}
${matchedComp?.location ? `- Location: ${matchedComp.location}` : ''}
${matchedComp?.whyCompetitor ? `- Competitive Overlap: ${matchedComp.whyCompetitor}` : ''}

Position ${memory.businessIdentity?.officialName || 'the target company'} as the superior, technically advanced alternative with tighter tolerances and better delivery reliability.
`;
    } else if (strategy === "industry") {
      let focusText = "the macro trends, tone, and subjects that the industry leaders are currently posting about";
      if (industryFocus === "visuals") focusText = "the visual aesthetics, schematics, and formatting styles used by industry leaders";
      if (industryFocus === "messaging") focusText = "the specific core messaging, primary hooks, and ROI propositions emphasized by industry leaders";
      if (industryFocus === "format") focusText = "the leading content formats (e.g. data-dense carousels, spec teardowns) dominating the industry";

      competitorContext = `
CRITICAL STRATEGY INSTRUCTION:
The user has requested to MIRROR INDUSTRY TRENDS (${focusText}).
Anchor your posts around these market leadership standards while highlighting the business's real offerings.
`;
    }

    const customInstructionsContext = memory.input.customInstructions ? `
USER INSTRUCTIONS / REVIEWS: 
${memory.input.customInstructions}
Strictly follow the user instructions above.
` : "";

    let customGoalInstruction = "";
    if (customGoal && customGoal.trim().length > 0) {
      customGoalInstruction = `
======================================================================
PRIMARY CAMPAIGN DIRECTIVE (HIGHEST PRIORITY):
User's Explicit Directive: "${customGoal}"
MANDATE: Every single post MUST weave this directive into its specific strategic angle!
- For Failure Mode / Problem: Show how achieving this goal prevents failures for these specific target clients.
- For Technical Specs: Detail the exact tolerances and standards demanded by this goal.
- For Procurement ROI: Present the commercial and supply chain benefits aligned with this goal.
======================================================================
`;
    }

    let subThemeFocusInstruction = "";
    if (subTheme && subTheme.trim().length > 0) {
      const trimmedSubTheme = subTheme.trim();
      const foundProduct = (memory.offerings?.products || []).find(p => (typeof p === 'string' ? p : p.name).toLowerCase() === trimmedSubTheme.toLowerCase());
      const pObj = typeof foundProduct === 'object' ? foundProduct : null;

      subThemeFocusInstruction = `
======================================================================
TARGET OFFERING SPOTLIGHT: "${trimmedSubTheme}"
The user explicitly specified that all generated posts MUST focus on: "${trimmedSubTheme}".
${pObj?.description ? `- Description: ${pObj.description}` : ''}
${pObj?.keyFeatures && pObj.keyFeatures.length ? `- Key Features: ${pObj.keyFeatures.join(', ')}` : ''}
${pObj?.technicalSpecs && Object.keys(pObj.technicalSpecs).length ? `- Technical Specs: ${JSON.stringify(pObj.technicalSpecs)}` : ''}
${pObj?.useCases && pObj.useCases.length ? `- Practical Use Cases: ${pObj.useCases.join(', ')}` : ''}

CRITICAL ANTI-SAMENESS RULE FOR THIS TARGET OFFERING:
Do NOT write repetitive variations of the same product pitch!
Instead, explore THIS SPECIFIC OFFERING from radically different strategic dimensions across each assigned post (Failure Mode, Spec Teardown, Procurement ROI, Technical Comparison, Shop-Floor Quality Gate).
======================================================================
`;
    }

    let personaDirective = "";
    if (targetPersona && targetPersona !== "all" && targetPersona.trim().length > 0) {
      personaDirective = `
TARGET BUYER PERSONA DIRECTIVE:
The user explicitly specified the target buyer persona: "${targetPersona}".
Every post hook, body, and CTA must speak directly to this specific persona's day-to-day stakes, risk factors, and KPIs.
`;
    }

    let platformDirective = "";
    if (targetPlatform && targetPlatform !== "All") {
      switch (targetPlatform.toLowerCase()) {
        case "linkedin":
          platformDirective = `
TARGET PLATFORM DIRECTIVE: LINKEDIN (B2B Thought Leadership & Executive Decision-Making)
- Tone: Highly professional, authoritative, strategic, and data-driven.
- Structure: Start with a crisp insight hook. Use single-line spacing between short paragraphs. Integrate hard facts, specifications, or proven business ROI.
- Call-to-action: Professional invite for technical drawing review, RFQ, or consultative engineering discussion.
- Hashtags: 4-6 high-impact B2B and engineering hashtags.
`;
          break;
        case "instagram":
          platformDirective = `
TARGET PLATFORM DIRECTIVE: INSTAGRAM (Visual-First & High Engagement)
- Tone: Visually descriptive, punchy, credible, highlighting raw craftsmanship and precision engineering.
- Structure: Punchy first sentence before the fold. Use bullet points with emojis for readability. 
- Visual Idea: Describe bold, high-contrast imagery (red-hot forging, macro component finish, CAD cross-sections).
- Hashtags: 6-9 targeted niche and industry hashtags.
`;
          break;
        case "facebook":
          platformDirective = `
TARGET PLATFORM DIRECTIVE: FACEBOOK (Community, Trust & Storytelling)
- Tone: Relatable, customer-centric, emphasizing long-term partnership, trust, and local/global heritage.
- Structure: Clear narrative arc demonstrating how the company solves real problems.
`;
          break;
        case "twitter":
        case "x":
          platformDirective = `
TARGET PLATFORM DIRECTIVE: TWITTER / X (Punchy & High Signal)
- Tone: Fast, concise, high signal-to-noise ratio. Maximum insight per word.
`;
          break;
        case "youtube":
          platformDirective = `
TARGET PLATFORM DIRECTIVE: YOUTUBE / SHORTS / REELS (Cinematic & Fast-Paced Video)
- Tone: Engaging cinematic hook within 0-3s, clear visual cuts, sound design cues, and dynamic delivery.
`;
          break;
      }
    }

    const assignedArchetypes = getArchetypesForCampaign(postCount, theme, subTheme, customGoal, memory);

    let formatInstructions = "";

    if (type === "video") {
      const sfxGuide = isMfg
        ? "Heavy industrial sounds (e.g. 2000-ton hydraulic press strike, CNC spindle acceleration, metallic clink, furnace hum)"
        : isTech
        ? "Modern tech sound design (e.g. subtle digital pulse, UI haptic click, data whoosh)"
        : isAgri
        ? "Grounded agricultural/natural audio (deep tractor engine rumble, breeze through crops, seed dispenser click)"
        : "Authoritative professional corporate sound design (crisp whoosh, confident ambient tone)";

      const videoTreatments = [
        {
          title: "The Failure Teardown (Problem-First Forensic Diagnostic)",
          hook: "Extreme macro lens on cracked/sheared component under torque. High-stakes opening line exposing why standard parts fail in client assemblies.",
          focus: "Problem -> Root Cause in metallurgy/porosity -> Closed-die forged solution -> Zero defect reliability"
        },
        {
          title: "Inside the 2000-Degree Forge (High-Octane Shop Floor)",
          hook: "Glowing red steel billet pulled from induction heater and struck by the forging hammer in slow motion. Sparks shower the frame.",
          focus: "Visceral manufacturing energy -> Near-net forming -> 5-axis CNC machining pass -> 3D CMM laser verification"
        },
        {
          title: "The 0.01mm Dilemma (Assembly Line Uptime Case Study)",
          hook: "An automated assembly line robotic arm halts mid-air. Yellow warning light flashes.",
          focus: "The real cost of loose tolerances (scrap, delayed delivery) -> Metallic Technoforge DIN-5 broached solution -> Perfect plug-and-play fit"
        },
        {
          title: "Technical Face-Off: Casting vs Forging (Lab Teardown)",
          hook: "Side-by-side stress test in a hydraulic testing rig. Cast piece snaps at 400 MPa, forged piece endures past 1200 MPa.",
          focus: "Porosity in castings vs dense aligned grain flow -> Why critical applications cannot gamble with castings"
        },
        {
          title: "Zero-Defect Quality Gate (Metrology & Inspection)",
          hook: "Absolute silence inside the metrology lab. Ruby stylus touches pristine machined surface, digital readout locks in green.",
          focus: "The exact moment of truth where parts off by 0.02mm are scrapped -> Traceability reports -> Peace of mind for European OEMs"
        }
      ];

      formatInstructions = `
You must act as a master video editor and director creating highly engaging, fast-paced cinematic short-form video scripts (Reels/Shorts/TikTok/LinkedIn Video, 30 seconds each).
Generate EXACTLY ${postCount} short-form video scripts.

CRITICAL DIVERSITY MANDATE FOR VIDEO SCRIPTS:
Every script MUST follow a completely DIFFERENT directorial treatment and narrative pacing! Do NOT repeat the same script template.
${assignedArchetypes.map((arch, i) => {
  const treatment = videoTreatments[i % videoTreatments.length];
  return `
--- SCRIPT ${i + 1} MANDATE (${treatment.title}) ---
- Narrative Treatment: ${treatment.title}
- Hook Style: ${treatment.hook}
- Storyline Progression: ${treatment.focus}
- Core Product/Focus: ${subTheme || 'Target Components from Memory'}
- Sound Design Palette: [${sfxGuide}]
------------------------------------------------------`;
}).join('\n')}

Format each script explicitly as follows (keep visual directions and voiceover punchy and direct, 1-2 lines per scene, to match a true 30-second pacing):
---
### Post [Number]: [Catchy Title]
**Strategy Angle:** [State the assigned narrative treatment]
**Topic Focus:** [State the specific product/service/capability this video focuses on]
**Target Persona:** [State which specific Buyer Persona from memory this video speaks to]

**Scene 1: The Hook (0-3s)** 
- **Visuals:** [Dynamic visual direction, extreme close-up, fast pan, or macro shot matching the script's treatment]
- **Sound Design SFX:** [Specific impactful sound effect]
- **Voiceover:** [High-stakes opening line addressing the exact cost of failure, delay, or low quality. NO clichés.]

**Scene 2: Context / Problem (3-8s)** 
- **Visuals:** [Visuals establishing the operational challenge, assembly line, or metallurgical stress]
- **Sound Design SFX:** [Ambient context audio]
- **Voiceover:** [Explaining the specific challenge faced in this industry]

**Scene 3: The Solution / Offering (8-15s)** 
- **Visuals:** [Cinematic reveal of the company's specific product or service execution by name]
- **Sound Design SFX:** [Punctual impact SFX]
- **Voiceover:** [Introducing the exact component by name with hard metrics from memory]

**Scene 4: Execution & Precision (15-22s)** 
- **Visuals:** [Close-up on craftsmanship, CNC machining, or 3D CMM inspection]
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
      formatInstructions = `
You must generate EXACTLY ${postCount} highly engaging, deeply researched, and radically unique image post concepts for social media.

CRITICAL ANTI-SAMENESS MANDATE:
Under NO circumstances may any two posts share the same opening structure, rhetorical pattern, or theme!
Do NOT just swap words in a template. Each post MUST use its assigned strategic angle and creative role below:

${assignedArchetypes.map((arch, i) => `
======================================================================
POST ${i + 1} MANDATE:
- Strategy Angle: "${arch.angle}"
- Creative Role: ${arch.role}
- Objective: ${arch.objective}
- Hook Requirement: ${arch.hookRule}
- Visual Direction: ${arch.visualRule}
- Body Formatting Style: ${arch.bodyStyle}
======================================================================
`).join('\n')}

OUTPUT FORMAT REQUIREMENT:
You MUST output your response as a valid JSON array containing EXACTLY ${postCount} objects (one for each Post Mandate above).
Output ONLY the raw JSON array. Do not include markdown codeblocks or extra text outside the JSON array.

[
${assignedArchetypes.map((arch, i) => `  {
    "angle": "${arch.angle}",
    "heading": "[Scroll-stopping headline strictly matching Post ${i + 1} angle: ${arch.angle}]",
    "subText": "[Quantified supporting metric or benefit for Post ${i + 1}]",
    "visualIdea": "[Detailed visual concept adhering to Post ${i + 1} visual direction]",
    "content": "[Short punchy caption hook that starts in media res adhering to Post ${i + 1} hook requirement]",
    "body": "[Concise yet information-dense post copy (~120-180 words) with real data points, specs, and metrics from memory adhering to Post ${i + 1} body style]",
    "elements": "[Specific design elements, callout boxes, CAD schematics, diagrams]",
    "hashtags": "[5-7 targeted B2B hashtags matching the company and industry, space separated]"
  }`).join(',\n')}
]
`;
    }

    let brandVoiceAndAntiRepetitionContext = "";
    const ownPosts = (memory.ownSocialFeed || []) as any[];
    const voice = memory.brandVoicePattern;

    if (ownPosts.length > 0 || voice) {
      const recentPostsList = ownPosts.slice(0, 10).map((p, idx) => {
        const plat = p.platform || "Social";
        const cap = (p.caption || p.content || "").slice(0, 140).replace(/\n+/g, " ");
        return `- [${plat}] ${cap}`;
      }).join("\n");

      brandVoiceAndAntiRepetitionContext = `
======================================================================
ANTI-REPETITION SHIELD:
Recent company posts already published:
${recentPostsList || 'No raw posts available, but recent topics were indexed.'}

MANDATORY RULES:
1. ANTI-REPETITION: Do NOT repeat, rehash, or clone recent announcements above. Pick untouched technical dimensions or different buyer perspectives.
2. VOICE ADOPTION: Emulate the company's verified caption style (${voice?.captionStyle || 'authoritative B2B'}) and tone (${voice?.tone || 'professional'}).
======================================================================
`;
    }

    const personasList = (memory.audience?.buyerPersonas || []).join(", ") || "Industry Buyers & Decision Makers";

    const prompt = `You are a world-class Chief Content Strategist & B2B Technical Copywriter.
Your goal is to generate extremely high-quality, technically accurate, and deeply compelling social media content based STRICTLY on the business's provided data.

==================== BUSINESS INTELLIGENCE MEMORY ====================
${memoryContext}
======================================================================

INSTRUCTIONS & FORMAT:
${formatInstructions}

CORE RULES FOR POWERFUL & GROUNDED CONTENT:
1. 100% GROUNDED IN REAL DATA:
   - Every post MUST be strictly based on the provided company memory (Official Name: ${memory.businessIdentity?.officialName || 'Business'}, Industry: ${memory.businessIdentity?.industry || ''}, Vision: "${memory.businessIdentity?.vision || ''}").
   - Directly feature the real products, real services, real specifications, and real processes listed above. Do NOT invent fictitious products or irrelevant capabilities.
2. VARY THE SENTENCE STRUCTURE & RHYTHM:
   - NEVER start multiple posts with the same grammatical structure or phrasing.
   - Post 1 must start with an operational challenge / failure point.
   - Post 2 must start with an exact engineering metric / spec.
   - Post 3 must start with a commercial / procurement calculation.
   - Post 4 must start with a provocative comparative question or bold statement.
   - Post 5 must start in the middle of shop-floor action.
3. BAN BUZZWORD FLUFF:
   - Ban generic corporate clichés like "redefining excellence", "crafting the future", "unparalleled synergy", or "passion for quality".
   - Replace generic fluff with hard nouns, verifiable metrics, real materials, real use-cases, and concrete business outcomes.
4. EXACT COUNT: You must generate EXACTLY ${postCount} posts.
5. LANGUAGE REQUIREMENT: You must write the entire output exclusively in the **${language}** language.
${language === "Hinglish" ? `
   HINGLISH RULES:
   - Write in a natural conversational mix of Hindi (Devanagari script) and English.
   - Use English for technical terms, product names, specifications, metrics, hashtags, and industry jargon (e.g., "CNC machining", "tolerance", "ISO certified").
   - Use Hindi (Devanagari) for connective words, verbs, emotions, hooks, and everyday phrasing (e.g., "हमारी precision engineering ने बदल दी इस industry की कहानी").
   - The tone should feel like an Indian engineer or founder speaking confidently on LinkedIn — professional yet culturally grounded.
   - Do NOT write pure Hindi or pure English. Every post must blend both naturally.` : ""}${language === "Gujlish" ? `
   GUJLISH RULES:
   - Write in a natural conversational mix of Gujarati (Gujarati script) and English.
   - Use English for technical terms, product names, specifications, metrics, hashtags, and industry jargon (e.g., "forged components", "surface finish", "DIN standards").
   - Use Gujarati (ગુજરાતી) for connective words, verbs, emotions, hooks, and everyday phrasing (e.g., "અમારી forging technology એ global market માં નવો standard સેટ કર્યો").
   - The tone should feel like a Gujarati business owner or engineer speaking proudly and professionally — blending local warmth with global engineering authority.
   - Do NOT write pure Gujarati or pure English. Every post must blend both naturally.` : ""}

${personaDirective}
${platformDirective}
${customGoalInstruction}
${subThemeFocusInstruction}
${competitorContext}
${customInstructionsContext}
${brandVoiceAndAntiRepetitionContext}

Begin generating the posts now:`;

    try {
      const response = await llm.invoke(prompt);
      const content = typeof response.content === "string" ? response.content : "";
      let posts: string[] = [];

      if (type === "image") {
        try {
          let cleaned = content.trim();
          if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
          }
          const start = cleaned.indexOf('[');
          const end = cleaned.lastIndexOf(']');
          if (start !== -1) {
            const rawArray = (end > start) ? cleaned.substring(start, end + 1) : cleaned.substring(start) + "]";
            let parsed: any[] = [];

            const tryParse = (text: string): any[] | null => {
              try {
                const res = JSON.parse(text);
                return Array.isArray(res) ? res : [res];
              } catch {
                return null;
              }
            };

            // Attempt 1: direct parse
            let attempt = tryParse(rawArray);
            if (attempt && attempt.length > 0) {
              parsed = attempt;
            } else {
              // Attempt 2: sanitize unescaped newlines/tabs inside string values & trailing commas
              const sanitized = rawArray
                .replace(/"((?:[^"\\]|\\.)*)"/gs, (_, inner) => {
                  return "\"" + inner.replace(/\r?\n/g, "\\n").replace(/\r/g, "\\n").replace(/\t/g, "\\t") + "\"";
                })
                .replace(/,\s*([\]}])/g, '$1');

              attempt = tryParse(sanitized);
              if (attempt && attempt.length > 0) {
                parsed = attempt;
              } else {
                // Attempt 3: recover individual complete JSON objects
                const objectRegex = /\{[\s\S]*?\}(?=\s*,\s*\{|\s*\]|$)/g;
                const matches = sanitized.match(objectRegex);
                if (matches && matches.length > 0) {
                  for (const m of matches) {
                    try {
                      parsed.push(JSON.parse(m));
                    } catch {
                      try {
                        const fixedM = m.replace(/"((?:[^"\\]|\\.)*)"/gs, (_, inner) => {
                          return "\"" + inner.replace(/\r?\n/g, "\\n").replace(/\r/g, "\\n").replace(/\t/g, "\\t") + "\"";
                        }).replace(/,\s*\}/g, '}');
                        parsed.push(JSON.parse(fixedM));
                      } catch (_) {}
                    }
                  }
                }
              }
            }

            if (Array.isArray(parsed) && parsed.length > 0) {
              posts = parsed.map((p: any) => JSON.stringify(p));
            } else {
              logger.error(`Parsed JSON was empty. Length: ${content.length}. Preview: ${content.slice(0, 300)}`);
              posts = [];
            }
          } else {
            logger.error(`Failed to find JSON array in response. Length: ${content.length}. Preview: ${content.slice(0, 300)}`);
            posts = [];
          }
        } catch(e: any) {
          logger.error(`Failed to parse JSON response: ${e?.message}. Preview: ${content.slice(0, 300)}`);
          posts = [];
        }
      } else {
        posts = content.split("---").map((p: string) => p.trim()).filter((p: string) => p.length > 20);
      }
      return posts.slice(0, postCount);
    } catch (e: any) {
      logger.error(`SMM generation failed: ${e.message}`);
      throw e;
    }
  }
}
