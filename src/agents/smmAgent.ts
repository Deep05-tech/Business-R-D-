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

const MANUFACTURING_ARCHETYPES: Record<string, ContentArchetype[]> = {
  product: [
    {
      angle: "Failure Mode & Engineering Solution",
      role: "Problem-Solver",
      objective: "Highlight how ${companyName}'s product prevents a costly failure mode in the manufacturing process.",
      hookRule: "Start with a real-world failure scenario that ${companyName}'s product solves.",
      visualRule: "Show the failure first, then the solution with ${companyName}'s product.",
      bodyStyle: "Clear, punchy bullet points showing real-world results and quantifiable metrics. Never use labels like '**Before**' or '**After**'."
    },
    {
      angle: "Technical Spec Teardown & Micron Precision",
      role: "Technical Expert",
      objective: "Demonstrate ${companyName}'s product's micron-level precision and how it meets exacting specs.",
      hookRule: "Start with a challenging spec requirement that ${companyName}'s product meets.",
      visualRule: "Show CAD drawings, measurement tools, and inspection results.",
      bodyStyle: "Technical specification breakdown with visual proof."
    },
    {
      angle: "Procurement ROI & Scrap Reduction",
      role: "Cost-Saver",
      objective: "Show how ${companyName}'s product reduces procurement costs and scrap rates.",
      hookRule: "Start with a procurement challenge that ${companyName}'s product solves.",
      visualRule: "Show inventory management systems and cost comparison charts.",
      bodyStyle: "Cost-benefit analysis with ROI calculations."
    },
    {
      angle: "Technical Face-Off",
      role: "Competitive Analyst",
      objective: "Compare ${companyName}'s product to competitors' offerings in a technical showdown.",
      hookRule: "Start with a competitive advantage that ${companyName}'s product has.",
      visualRule: "Show side-by-side comparisons of ${companyName}'s product vs competitors.",
      bodyStyle: "Technical comparison table with key differentiators."
    },
    {
      angle: "Shop-Floor Execution",
      role: "Operations Expert",
      objective: "Show how ${companyName}'s product enables efficient shop-floor execution.",
      hookRule: "Start with a shop-floor challenge that ${companyName}'s product solves.",
      visualRule: "Show shop-floor workers using ${companyName}'s product in action.",
      bodyStyle: "Process flow diagram with time savings metrics."
    }
  ],
  brand: [
    {
      angle: "Company Mission & Market Category Leadership",
      role: "Brand Storyteller",
      objective: "Position ${companyName} as a leader in the manufacturing industry.",
      hookRule: "Start with ${companyName}'s mission statement or industry leadership claim.",
      visualRule: "Show ${companyName}'s facilities, employees, or industry awards.",
      bodyStyle: "Mission statement with supporting industry data."
    },
    {
      angle: "Technical Legacy & Innovation",
      role: "Innovation Advocate",
      objective: "Show ${companyName}'s history of technical innovation in manufacturing.",
      hookRule: "Start with ${companyName}'s founding story or first major innovation.",
      visualRule: "Show historical photos, patents, or product evolution timelines.",
      bodyStyle: "Historical timeline with key innovation milestones."
    },
    {
      angle: "Customer Success Stories",
      role: "Success Storyteller",
      objective: "Share a customer success story featuring ${companyName}'s products.",
      hookRule: "Start with a customer challenge that ${companyName} solved.",
      visualRule: "Show customer logos, quantified performance metrics, or testimonials.",
      bodyStyle: "Customer case study with quantifiable results."
    },
    {
      angle: "Industry Recognition",
      role: "Awards Champion",
      objective: "Highlight ${companyName}'s industry awards and recognitions.",
      hookRule: "Start with a recent award or recognition that ${companyName} received.",
      visualRule: "Show award certificates, trophies, or press releases.",
      bodyStyle: "List of awards with brief descriptions."
    },
    {
      angle: "Behind the Build",
      role: "Process Transparency Advocate",
      objective: "Show the manufacturing process behind ${companyName}'s products.",
      hookRule: "Start with a behind-the-scenes look at ${companyName}'s manufacturing process.",
      visualRule: "Show factory tours, process diagrams, or equipment in use.",
      bodyStyle: "Process flow diagram with key equipment and materials."
    }
  ],
  technical: [
    {
      angle: "API Design & Developer Experience",
      role: "Developer Advocate",
      objective: "Show how ${companyName}'s API enables seamless integration.",
      hookRule: "Start with a developer challenge that ${companyName}'s API solves.",
      visualRule: "Show code snippets, API documentation, or integration examples.",
      bodyStyle: "Technical API documentation with code examples."
    },
    {
      angle: "Data-Driven Manufacturing",
      role: "Data Scientist",
      objective: "Show how ${companyName} uses data to optimize manufacturing.",
      hookRule: "Start with a data challenge that ${companyName} solved.",
      visualRule: "Show data dashboards, analytics charts, or predictive models.",
      bodyStyle: "Data analysis with key insights and recommendations."
    },
    {
      angle: "IIoT & Smart Manufacturing",
      role: "Industrial IoT Expert",
      objective: "Show how ${companyName} uses IIoT to improve manufacturing.",
      hookRule: "Start with an IIoT challenge that ${companyName} solved.",
      visualRule: "Show IIoT sensors, data flows, or smart factory layouts.",
      bodyStyle: "IIoT architecture diagram with key components."
    },
    {
      angle: "Predictive Maintenance",
      role: "Maintenance Engineer",
      objective: "Show how ${companyName} uses predictive maintenance to reduce downtime.",
      hookRule: "Start with a maintenance challenge that ${companyName} solved.",
      visualRule: "Show predictive maintenance dashboards, alerts, or maintenance schedules.",
      bodyStyle: "Predictive maintenance workflow with key metrics."
    },
    {
      angle: "Quality Control & Certification",
      role: "Quality Assurance Expert",
      objective: "Show how ${companyName} ensures quality and compliance.",
      hookRule: "Start with a quality challenge that ${companyName} solved.",
      visualRule: "Show quality control processes, certifications, or inspection reports.",
      bodyStyle: "Quality control workflow with key metrics."
    }
  ],
  educative: [
    {
      angle: "Industry Diagnostic: Signs You've Outgrown Your Current Tool",
      role: "Industry Analyst",
      objective: "Help manufacturers identify when they need to upgrade their tools.",
      hookRule: "Start with a common manufacturing challenge that indicates a tool upgrade is needed.",
      visualRule: "Show outdated equipment, inefficient processes, or quality issues.",
      bodyStyle: "Industry diagnostic checklist with key warning signs."
    },
    {
      angle: "Technical Training & Certification",
      role: "Training Specialist",
      objective: "Show how ${companyName} provides technical training and certification.",
      hookRule: "Start with a technical skill gap that ${companyName}'s training addresses.",
      visualRule: "Show training programs, certifications, or training materials.",
      bodyStyle: "Training program overview with key benefits."
    },
    {
      angle: "Industry Trends & Future Outlook",
      role: "Industry Futurist",
      objective: "Share insights on the future of manufacturing and how ${companyName} is preparing.",
      hookRule: "Start with a current industry trend that ${companyName} is addressing.",
      visualRule: "Show industry reports, market forecasts, or technology roadmaps.",
      bodyStyle: "Industry trend analysis with key insights."
    },
    {
      angle: "Manufacturing Cost Optimization",
      role: "Cost Optimization Expert",
      objective: "Show how ${companyName} helps manufacturers optimize their costs.",
      hookRule: "Start with a cost challenge that ${companyName} solved.",
      visualRule: "Show cost comparison charts, savings reports, or cost optimization strategies.",
      bodyStyle: "Cost optimization workflow with key metrics."
    },
    {
      angle: "Sustainable Manufacturing",
      role: "Sustainability Advocate",
      objective: "Show how ${companyName} promotes sustainable manufacturing practices.",
      hookRule: "Start with a sustainability challenge that ${companyName} addressed.",
      visualRule: "Show sustainable manufacturing processes, certifications, or case studies.",
      bodyStyle: "Sustainability program overview with key benefits."
    }
  ],
  default: [
    {
      angle: "Behind the Build: How a Feature Ships",
      role: "Process Transparency Advocate",
      objective: "Show the manufacturing process behind ${companyName}'s products.",
      hookRule: "Start with a behind-the-scenes look at ${companyName}'s manufacturing process.",
      visualRule: "Show factory tours, process diagrams, or equipment in use.",
      bodyStyle: "Process flow diagram with key equipment and materials."
    },
    {
      angle: "Customer Success Stories",
      role: "Success Storyteller",
      objective: "Share a customer success story featuring ${companyName}'s products.",
      hookRule: "Start with a customer challenge that ${companyName} solved.",
      visualRule: "Show customer logos, quantified performance metrics, or testimonials.",
      bodyStyle: "Customer case study with quantifiable results."
    },
    {
      angle: "Industry Recognition",
      role: "Awards Champion",
      objective: "Highlight ${companyName}'s industry awards and recognitions.",
      hookRule: "Start with a recent award or recognition that ${companyName} received.",
      visualRule: "Show award certificates, trophies, or press releases.",
      bodyStyle: "List of awards with brief descriptions."
    },
    {
      angle: "Technical Legacy & Innovation",
      role: "Innovation Advocate",
      objective: "Show ${companyName}'s history of technical innovation in manufacturing.",
      hookRule: "Start with ${companyName}'s founding story or first major innovation.",
      visualRule: "Show historical photos, patents, or product evolution timelines.",
      bodyStyle: "Historical timeline with key innovation milestones."
    },
    {
      angle: "Company Mission & Market Category Leadership",
      role: "Brand Storyteller",
      objective: "Position ${companyName} as a leader in the manufacturing industry.",
      hookRule: "Start with ${companyName}'s mission statement or industry leadership claim.",
      visualRule: "Show ${companyName}'s facilities, employees, or industry awards.",
      bodyStyle: "Mission statement with supporting industry data."
    }
  ]
};

const TECHNOLOGY_ARCHETYPES: Record<string, ContentArchetype[]> = {
  product: [
    {
      angle: "Problem-Solution Deep Dive",
      role: "Problem-Solver",
      objective: "Show how ${companyName}'s product solves a specific problem in the technology industry.",
      hookRule: "Start with a real-world problem that ${companyName}'s product solves.",
      visualRule: "Show the problem first, then the solution with ${companyName}'s product.",
      bodyStyle: "Clear, punchy bullet points showing real-world results and quantifiable metrics. Never use labels like '**Before**' or '**After**'."
    },
    {
      angle: "Feature Technical Teardown",
      role: "Technical Expert",
      objective: "Demonstrate ${companyName}'s product's key features and technical specifications.",
      hookRule: "Start with a challenging technical requirement that ${companyName}'s product meets.",
      visualRule: "Show technical diagrams, specifications, and feature demonstrations.",
      bodyStyle: "Technical specification breakdown with visual proof."
    },
    {
      angle: "ROI & Cost Savings Analysis",
      role: "Cost-Saver",
      objective: "Show how ${companyName}'s product reduces costs and increases ROI.",
      hookRule: "Start with a cost challenge that ${companyName}'s product solves.",
      visualRule: "Show cost comparison charts and savings reports.",
      bodyStyle: "Cost-benefit analysis with ROI calculations."
    },
    {
      angle: "Competitive Comparison",
      role: "Competitive Analyst",
      objective: "Compare ${companyName}'s product to competitors' offerings.",
      hookRule: "Start with a competitive advantage that ${companyName}'s product has.",
      visualRule: "Show side-by-side comparisons of ${companyName}'s product vs competitors.",
      bodyStyle: "Technical comparison table with key differentiators."
    },
    {
      angle: "Implementation & Onboarding Success",
      role: "Implementation Expert",
      objective: "Show how ${companyName}'s product enables successful implementation.",
      hookRule: "Start with an implementation challenge that ${companyName}'s product solves.",
      visualRule: "Show implementation workflows, training materials, or success stories.",
      bodyStyle: "Implementation workflow with key metrics."
    }
  ],
  brand: [
    {
      angle: "Company Mission & Market Category Leadership",
      role: "Brand Storyteller",
      objective: "Position ${companyName} as a leader in the technology industry.",
      hookRule: "Start with ${companyName}'s mission statement or industry leadership claim.",
      visualRule: "Show ${companyName}'s facilities, employees, or industry awards.",
      bodyStyle: "Mission statement with supporting industry data."
    },
    {
      angle: "Technical Legacy & Innovation",
      role: "Innovation Advocate",
      objective: "Show ${companyName}'s history of technical innovation in technology.",
      hookRule: "Start with ${companyName}'s founding story or first major innovation.",
      visualRule: "Show historical photos, patents, or product evolution timelines.",
      bodyStyle: "Historical timeline with key innovation milestones."
    },
    {
      angle: "Customer Success Stories",
      role: "Success Storyteller",
      objective: "Share a customer success story featuring ${companyName}'s products.",
      hookRule: "Start with a customer challenge that ${companyName} solved.",
      visualRule: "Show customer logos, quantified performance metrics, or testimonials.",
      bodyStyle: "Customer case study with quantifiable results."
    },
    {
      angle: "Industry Recognition",
      role: "Awards Champion",
      objective: "Highlight ${companyName}'s industry awards and recognitions.",
      hookRule: "Start with a recent award or recognition that ${companyName} received.",
      visualRule: "Show award certificates, trophies, or press releases.",
      bodyStyle: "List of awards with brief descriptions."
    },
    {
      angle: "Behind the Build",
      role: "Process Transparency Advocate",
      objective: "Show the development process behind ${companyName}'s products.",
      hookRule: "Start with a behind-the-scenes look at ${companyName}'s development process.",
      visualRule: "Show development workflows, code reviews, or feature demos.",
      bodyStyle: "Development process diagram with key milestones."
    }
  ],
  technical: [
    {
      angle: "API Design & Developer Experience",
      role: "Developer Advocate",
      objective: "Show how ${companyName}'s API enables seamless integration.",
      hookRule: "Start with a developer challenge that ${companyName}'s API solves.",
      visualRule: "Show code snippets, API documentation, or integration examples.",
      bodyStyle: "Technical API documentation with code examples."
    },
    {
      angle: "Data-Driven Development",
      role: "Data Scientist",
      objective: "Show how ${companyName} uses data to optimize development.",
      hookRule: "Start with a data challenge that ${companyName} solved.",
      visualRule: "Show data dashboards, analytics charts, or predictive models.",
      bodyStyle: "Data analysis with key insights and recommendations."
    },
    {
      angle: "DevOps & Continuous Integration",
      role: "DevOps Engineer",
      objective: "Show how ${companyName} uses DevOps to improve development.",
      hookRule: "Start with a DevOps challenge that ${companyName} solved.",
      visualRule: "Show CI/CD pipelines, deployment workflows, or monitoring dashboards.",
      bodyStyle: "DevOps workflow with key metrics."
    },
    {
      angle: "Security & Compliance",
      role: "Security Expert",
      objective: "Show how ${companyName} ensures security and compliance.",
      hookRule: "Start with a security challenge that ${companyName} solved.",
      visualRule: "Show security processes, certifications, or compliance reports.",
      bodyStyle: "Security workflow with key metrics."
    },
    {
      angle: "Scalability & Performance Optimization",
      role: "Performance Engineer",
      objective: "Show how ${companyName} optimizes performance and scalability.",
      hookRule: "Start with a performance challenge that ${companyName} solved.",
      visualRule: "Show performance benchmarks, load tests, or optimization strategies.",
      bodyStyle: "Performance optimization workflow with key metrics."
    }
  ],
  educative: [
    {
      angle: "Industry Diagnostic: Signs You've Outgrown Your Current Tool",
      role: "Industry Analyst",
      objective: "Help technology companies identify when they need to upgrade their tools.",
      hookRule: "Start with a common technology challenge that indicates a tool upgrade is needed.",
      visualRule: "Show outdated tools, inefficient processes, or quality issues.",
      bodyStyle: "Industry diagnostic checklist with key warning signs."
    },
    {
      angle: "Technical Training & Certification",
      role: "Training Specialist",
      objective: "Show how ${companyName} provides technical training and certification.",
      hookRule: "Start with a technical skill gap that ${companyName}'s training addresses.",
      visualRule: "Show training programs, certifications, or training materials.",
      bodyStyle: "Training program overview with key benefits."
    },
    {
      angle: "Industry Trends & Future Outlook",
      role: "Industry Futurist",
      objective: "Share insights on the future of technology and how ${companyName} is preparing.",
      hookRule: "Start with a current industry trend that ${companyName} is addressing.",
      visualRule: "Show industry reports, market forecasts, or technology roadmaps.",
      bodyStyle: "Industry trend analysis with key insights."
    },
    {
      angle: "Technology Cost Optimization",
      role: "Cost Optimization Expert",
      objective: "Show how ${companyName} helps technology companies optimize their costs.",
      hookRule: "Start with a cost challenge that ${companyName} solved.",
      visualRule: "Show cost comparison charts, savings reports, or cost optimization strategies.",
      bodyStyle: "Cost optimization workflow with key metrics."
    },
    {
      angle: "Sustainable Technology",
      role: "Sustainability Advocate",
      objective: "Show how ${companyName} promotes sustainable technology practices.",
      hookRule: "Start with a sustainability challenge that ${companyName} addressed.",
      visualRule: "Show sustainable technology processes, certifications, or case studies.",
      bodyStyle: "Sustainability program overview with key benefits."
    }
  ],
  default: [
    {
      angle: "Behind the Build: How a Feature Ships",
      role: "Process Transparency Advocate",
      objective: "Show the development process behind ${companyName}'s products.",
      hookRule: "Start with a behind-the-scenes look at ${companyName}'s development process.",
      visualRule: "Show development workflows, code reviews, or feature demos.",
      bodyStyle: "Development process diagram with key milestones."
    },
    {
      angle: "Customer Success Stories",
      role: "Success Storyteller",
      objective: "Share a customer success story featuring ${companyName}'s products.",
      hookRule: "Start with a customer challenge that ${companyName} solved.",
      visualRule: "Show customer logos, quantified performance metrics, or testimonials.",
      bodyStyle: "Customer case study with quantifiable results."
    },
    {
      angle: "Industry Recognition",
      role: "Awards Champion",
      objective: "Highlight ${companyName}'s industry awards and recognitions.",
      hookRule: "Start with a recent award or recognition that ${companyName} received.",
      visualRule: "Show award certificates, trophies, or press releases.",
      bodyStyle: "List of awards with brief descriptions."
    },
    {
      angle: "Technical Legacy & Innovation",
      role: "Innovation Advocate",
      objective: "Show ${companyName}'s history of technical innovation in technology.",
      hookRule: "Start with ${companyName}'s founding story or first major innovation.",
      visualRule: "Show historical photos, patents, or product evolution timelines.",
      bodyStyle: "Historical timeline with key innovation milestones."
    },
    {
      angle: "Company Mission & Market Category Leadership",
      role: "Brand Storyteller",
      objective: "Position ${companyName} as a leader in the technology industry.",
      hookRule: "Start with ${companyName}'s mission statement or industry leadership claim.",
      visualRule: "Show ${companyName}'s facilities, employees, or industry awards.",
      bodyStyle: "Mission statement with supporting industry data."
    }
  ]
};

const AGRICULTURE_ARCHETYPES: Record<string, ContentArchetype[]> = {
  product: [
    {
      angle: "Crop Problem & Solution",
      role: "Agricultural Expert",
      objective: "Show how ${companyName}'s product solves a specific crop problem.",
      hookRule: "Start with a real-world crop problem that ${companyName}'s product solves.",
      visualRule: "Show the crop problem first, then the solution with ${companyName}'s product.",
      bodyStyle: "Clear, punchy bullet points showing real-world results and quantifiable metrics. Never use labels like '**Before**' or '**After**'."
    },
    {
      angle: "Product Specification & Application",
      role: "Technical Expert",
      objective: "Demonstrate ${companyName}'s product's specifications and application.",
      hookRule: "Start with a challenging application requirement that ${companyName}'s product meets.",
      visualRule: "Show product specifications, application diagrams, and usage examples.",
      bodyStyle: "Technical specification breakdown with visual proof."
    },
    {
      angle: "ROI & Yield Improvement",
      role: "Farm Manager",
      objective: "Show how ${companyName}'s product improves yields and ROI.",
      hookRule: "Start with a yield challenge that ${companyName}'s product solves.",
      visualRule: "Show yield comparison charts and savings reports.",
      bodyStyle: "Cost-benefit analysis with ROI calculations."
    },
    {
      angle: "Product Comparison",
      role: "Competitive Analyst",
      objective: "Compare ${companyName}'s product to competitors' offerings.",
      hookRule: "Start with a competitive advantage that ${companyName}'s product has.",
      visualRule: "Show side-by-side comparisons of ${companyName}'s product vs competitors.",
      bodyStyle: "Technical comparison table with key differentiators."
    },
    {
      angle: "Field Application & Best Practices",
      role: "Field Specialist",
      objective: "Show how ${companyName}'s product enables successful field application.",
      hookRule: "Start with a field application challenge that ${companyName}'s product solves.",
      visualRule: "Show field application workflows, training materials, or success stories.",
      bodyStyle: "Field application workflow with key metrics."
    }
  ],
  brand: [
    {
      angle: "Company Mission & Market Category Leadership",
      role: "Brand Storyteller",
      objective: "Position ${companyName} as a leader in the agriculture industry.",
      hookRule: "Start with ${companyName}'s mission statement or industry leadership claim.",
      visualRule: "Show ${companyName}'s facilities, employees, or industry awards.",
      bodyStyle: "Mission statement with supporting industry data."
    },
    {
      angle: "Technical Legacy & Innovation",
      role: "Innovation Advocate",
      objective: "Show ${companyName}'s history of technical innovation in agriculture.",
      hookRule: "Start with ${companyName}'s founding story or first major innovation.",
      visualRule: "Show historical photos, patents, or product evolution timelines.",
      bodyStyle: "Historical timeline with key innovation milestones."
    },
    {
      angle: "Customer Success Stories",
      role: "Success Storyteller",
      objective: "Share a customer success story featuring ${companyName}'s products.",
      hookRule: "Start with a customer challenge that ${companyName} solved.",
      visualRule: "Show customer logos, quantified performance metrics, or testimonials.",
      bodyStyle: "Customer case study with quantifiable results."
    },
    {
      angle: "Industry Recognition",
      role: "Awards Champion",
      objective: "Highlight ${companyName}'s industry awards and recognitions.",
      hookRule: "Start with a recent award or recognition that ${companyName} received.",
      visualRule: "Show award certificates, trophies, or press releases.",
      bodyStyle: "List of awards with brief descriptions."
    },
    {
      angle: "Behind the Build",
      role: "Process Transparency Advocate",
      objective: "Show the development process behind ${companyName}'s products.",
      hookRule: "Start with a behind-the-scenes look at ${companyName}'s development process.",
      visualRule: "Show development workflows, quality control processes, or product demos.",
      bodyStyle: "Development process diagram with key milestones."
    }
  ],
  technical: [
    {
      angle: "Product Formulation & Application",
      role: "Formulation Scientist",
      objective: "Show how ${companyName}'s product is formulated and applied.",
      hookRule: "Start with a formulation challenge that ${companyName}'s product solves.",
      visualRule: "Show formulation processes, application diagrams, or usage examples.",
      bodyStyle: "Technical formulation breakdown with visual proof."
    },
    {
      angle: "Data-Driven Agriculture",
      role: "Data Scientist",
      objective: "Show how ${companyName} uses data to optimize agriculture.",
      hookRule: "Start with a data challenge that ${companyName} solved.",
      visualRule: "Show data dashboards, analytics charts, or predictive models.",
      bodyStyle: "Data analysis with key insights and recommendations."
    },
    {
      angle: "Precision Agriculture",
      role: "Precision Agriculture Expert",
      objective: "Show how ${companyName} uses precision agriculture to improve yields.",
      hookRule: "Start with a precision agriculture challenge that ${companyName} solved.",
      visualRule: "Show precision agriculture tools, data flows, or field layouts.",
      bodyStyle: "Precision agriculture workflow with key metrics."
    },
    {
      angle: "Quality Control & Certification",
      role: "Quality Assurance Expert",
      objective: "Show how ${companyName} ensures quality and compliance.",
      hookRule: "Start with a quality challenge that ${companyName} solved.",
      visualRule: "Show quality control processes, certifications, or inspection reports.",
      bodyStyle: "Quality control workflow with key metrics."
    },
    {
      angle: "Sustainable Agriculture",
      role: "Sustainability Advocate",
      objective: "Show how ${companyName} promotes sustainable agriculture practices.",
      hookRule: "Start with a sustainability challenge that ${companyName} addressed.",
      visualRule: "Show sustainable agriculture processes, certifications, or case studies.",
      bodyStyle: "Sustainability program overview with key benefits."
    }
  ],
  educative: [
    {
      angle: "Industry Diagnostic: Signs You've Outgrown Your Current Tool",
      role: "Industry Analyst",
      objective: "Help farmers identify when they need to upgrade their tools.",
      hookRule: "Start with a common agriculture challenge that indicates a tool upgrade is needed.",
      visualRule: "Show outdated tools, inefficient processes, or quality issues.",
      bodyStyle: "Industry diagnostic checklist with key warning signs."
    },
    {
      angle: "Technical Training & Certification",
      role: "Training Specialist",
      objective: "Show how ${companyName} provides technical training and certification.",
      hookRule: "Start with a technical skill gap that ${companyName}'s training addresses.",
      visualRule: "Show training programs, certifications, or training materials.",
      bodyStyle: "Training program overview with key benefits."
    },
    {
      angle: "Industry Trends & Future Outlook",
      role: "Industry Futurist",
      objective: "Share insights on the future of agriculture and how ${companyName} is preparing.",
      hookRule: "Start with a current industry trend that ${companyName} is addressing.",
      visualRule: "Show industry reports, market forecasts, or technology roadmaps.",
      bodyStyle: "Industry trend analysis with key insights."
    },
    {
      angle: "Agriculture Cost Optimization",
      role: "Cost Optimization Expert",
      objective: "Show how ${companyName} helps farmers optimize their costs.",
      hookRule: "Start with a cost challenge that ${companyName} solved.",
      visualRule: "Show cost comparison charts, savings reports, or cost optimization strategies.",
      bodyStyle: "Cost optimization workflow with key metrics."
    },
    {
      angle: "Sustainable Agriculture",
      role: "Sustainability Advocate",
      objective: "Show how ${companyName} promotes sustainable agriculture practices.",
      hookRule: "Start with a sustainability challenge that ${companyName} addressed.",
      visualRule: "Show sustainable agriculture processes, certifications, or case studies.",
      bodyStyle: "Sustainability program overview with key benefits."
    }
  ],
  default: [
    {
      angle: "Behind the Build: How a Product is Made",
      role: "Process Transparency Advocate",
      objective: "Show the development process behind ${companyName}'s products.",
      hookRule: "Start with a behind-the-scenes look at ${companyName}'s development process.",
      visualRule: "Show development workflows, quality control processes, or product demos.",
      bodyStyle: "Development process diagram with key milestones."
    },
    {
      angle: "Customer Success Stories",
      role: "Success Storyteller",
      objective: "Share a customer success story featuring ${companyName}'s products.",
      hookRule: "Start with a customer challenge that ${companyName} solved.",
      visualRule: "Show customer logos, quantified performance metrics, or testimonials.",
      bodyStyle: "Customer case study with quantifiable results."
    },
    {
      angle: "Industry Recognition",
      role: "Awards Champion",
      objective: "Highlight ${companyName}'s industry awards and recognitions.",
      hookRule: "Start with a recent award or recognition that ${companyName} received.",
      visualRule: "Show award certificates, trophies, or press releases.",
      bodyStyle: "List of awards with brief descriptions."
    },
    {
      angle: "Technical Legacy & Innovation",
      role: "Innovation Advocate",
      objective: "Show ${companyName}'s history of technical innovation in agriculture.",
      hookRule: "Start with ${companyName}'s founding story or first major innovation.",
      visualRule: "Show historical photos, patents, or product evolution timelines.",
      bodyStyle: "Historical timeline with key innovation milestones."
    },
    {
      angle: "Company Mission & Market Category Leadership",
      role: "Brand Storyteller",
      objective: "Position ${companyName} as a leader in the agriculture industry.",
      hookRule: "Start with ${companyName}'s mission statement or industry leadership claim.",
      visualRule: "Show ${companyName}'s facilities, employees, or industry awards.",
      bodyStyle: "Mission statement with supporting industry data."
    }
  ]
};

function getArchetypesForCampaign(totalPosts: number, theme: string, subTheme?: string, customGoal?: string, memory?: StructuredMemory): ContentArchetype[] {
  const ind = memory?.businessIdentity?.industry || "";
  const companyName = memory?.businessIdentity?.officialName || "The Company";
  const targetProduct = subTheme || memory?.offerings?.products?.[0]?.name || "our product";

  const isMfg = /manufactur|forg|machin|casting|steel|metal|industrial|engineering|auto|component|bearing|valve/i.test(ind);
  const isTech = /software|technology|it|saas|cloud|data|platform/i.test(ind);
  const isAgri = /seed|agri|crop|farming|fertilizer/i.test(ind);

  let archetypeSet: Record<string, ContentArchetype[]>;
  if (isMfg) {
    archetypeSet = MANUFACTURING_ARCHETYPES;
  } else if (isTech) {
    archetypeSet = TECHNOLOGY_ARCHETYPES;
  } else if (isAgri) {
    archetypeSet = AGRICULTURE_ARCHETYPES;
  } else {
    // Default to manufacturing if industry is unclear
    if (/industrial|engineering|mechanical|precision/i.test(ind)) {
      archetypeSet = MANUFACTURING_ARCHETYPES;
    } else {
      archetypeSet = TECHNOLOGY_ARCHETYPES;
    }
  }

  let archetypes = archetypeSet[theme] || archetypeSet.default;

  // Replace placeholders with actual values
  archetypes = archetypes.map(a => ({
    ...a,
    objective: a.objective.replace(/\$\{targetProduct\}/g, targetProduct).replace(/\$\{companyName\}/g, companyName),
    hookRule: a.hookRule.replace(/\$\{targetProduct\}/g, targetProduct).replace(/\$\{companyName\}/g, companyName),
    visualRule: a.visualRule.replace(/\$\{targetProduct\}/g, targetProduct).replace(/\$\{companyName\}/g, companyName),
    bodyStyle: a.bodyStyle.replace(/\$\{targetProduct\}/g, targetProduct).replace(/\$\{companyName\}/g, companyName)
  }));

  // Ensure we have enough archetypes
  if (archetypes.length < totalPosts) {
    archetypes = [...archetypes, ...archetypeSet.default.slice(0, totalPosts - archetypes.length)];
  }

  return archetypes.slice(0, Math.min(Math.max(totalPosts, 1), 5));
}

// Rest of the file will continue with the SmmAgent class...

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

    // Select targeted products (prioritize selected subTheme, max 5)
    const allRawProducts = memory.offerings?.products || [];
    const matchedProduct = allRawProducts.find(p => (typeof p === 'string' ? p : p.name).toLowerCase() === subThemeLower);
    const otherProducts = allRawProducts.filter(p => (typeof p === 'string' ? p : p.name).toLowerCase() !== subThemeLower).slice(0, 4);
    const selectedProducts = matchedProduct ? [matchedProduct, ...otherProducts] : allRawProducts.slice(0, 5);

    // Select targeted services (max 4)
    const allRawServices = (memory.offerings?.services || []).slice(0, 4);

    const memoryContext = JSON.stringify({
      businessIdentity: {
        officialName: memory.businessIdentity?.officialName,
        industry: memory.businessIdentity?.industry,
        subIndustry: memory.businessIdentity?.subIndustry,
        location: memory.businessIdentity?.location,
        vision: memory.businessIdentity?.vision,
        description: memory.businessIdentity?.description || "",
      },
      offerings: {
        products: selectedProducts.map(p => typeof p === 'string' ? { name: p } : {
          name: p.name,
          category: p.category,
          description: p.description || "",
          summary: p.aiLaymanSummary || p.aiSocialSummary || "",
          keyFeatures: p.keyFeatures || [],
          technicalSpecs: p.technicalSpecs || {},
          useCases: p.useCases || [],
          exportMarkets: p.exportMarkets || [],
          subProducts: (p.subProducts || []).map(sp => ({ name: sp.name, description: sp.description }))
        }),
        services: allRawServices.map(s => typeof s === 'string' ? { name: s } : {
          name: s.name,
          description: s.description || "",
          applications: s.applications || [],
          processes: s.processes || []
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
        messagingStyle: memory.brandPositioning?.messagingStyle,
        usps: memory.brandPositioning?.usps || []
      },
      processes: (memory.processes?.processes || []).slice(0, 5).map(pr => ({
        name: pr.name,
        description: pr.description || "",
        workflow: pr.workflow || [],
        capacity: pr.capacity || "",
        machineryUsed: pr.machineryUsed || []
      })),
      rdInsights: {
        improvements: memory.rdInsights?.improvements || [],
        opportunities: memory.rdInsights?.opportunities || []
      }
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
- Copywriting Framework: Modern HVC (Hook - Value - CTA).
- Hook Rule: First 1-2 lines MUST be a pattern-interrupt hook (Curiosity Gap, Contrarian Claim, or High-Stakes Business Metric) that stops the scroll before "...see more". Zero corporate pleasantries or greetings.
- Body Rule: 1-3 line micro-paragraphs with double line spacing. Use bullet points with emojis (🔹, 📊, ⚙️, 💡) for high-density value. Weave technical specifications and natural social SEO keywords naturally.
- Visual Banner: 3-tier visual hierarchy with 5-8 word bold headline and single metric proof pill.
- Call-to-action: Strictly ONE outcome (Single-Outcome Rule) e.g. "Save this for your next technical review", "Drop your component specs in comments", or "DM for our engineering teardown".
- Hashtags: Strictly 3 to 5 hyper-relevant B2B niche hashtags at the bottom.
`;
          break;
        case "instagram":
          platformDirective = `
TARGET PLATFORM DIRECTIVE: INSTAGRAM (Visual-First & High Save-Rate Engagement)
- Copywriting Framework: Modern HVC (Hook - Value - CTA).
- Hook Rule: Punchy, curiosity-driven opening sentence that interrupts feed scrolling immediately.
- Body Rule: Crisp micro-paragraphs with clean spacing and bullet points. Zero unbroken walls of text.
- Visual Direction: 3-tier visual hierarchy for 1:1 square feed graphic passing the 3-second squint test.
- Call-to-action: Single clear outcome (e.g. "Save this breakdown for your next project", "Tap the link in bio for full specs", or "Drop a comment below").
- Hashtags: Strictly 3 to 5 targeted niche hashtags. Zero hashtag stuffing.
`;
          break;
        case "facebook":
          platformDirective = `
TARGET PLATFORM DIRECTIVE: FACEBOOK (Community, Trust & Practical Case Studies)
- Copywriting Framework: Modern HVC (Hook - Value - CTA).
- Hook Rule: High-relatability operational challenge or customer dilemma.
- Body Rule: Conversational storytelling showing how real challenges were solved with specific engineering data.
- Call-to-action: Single conversation-starting prompt.
- Hashtags: Strictly 3 to 5 relevant industry hashtags.
`;
          break;
        case "twitter":
        case "x":
          platformDirective = `
TARGET PLATFORM DIRECTIVE: TWITTER / X (Punchy & High Signal)
- Copywriting Framework: High-density HVC.
- Hook Rule: Sharp, contrarian or provocative one-liner pattern interrupt.
- Body Rule: Maximum insight per word. Micro-sentences.
- Call-to-action: Single reply or bookmark prompt.
- Hashtags: Strictly 1 to 2 targeted tags.
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
You must generate EXACTLY ${postCount} crisp, high-performing, and authoritative text-first social media posts for platforms like LinkedIn, X, and Instagram.

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
- Caption Body Style: ${arch.bodyStyle}
======================================================================
`).join('\n')}

OUTPUT FORMAT REQUIREMENT:
You MUST output your response as a valid JSON array containing EXACTLY ${postCount} objects (one for each Post Mandate above).
Output ONLY the raw JSON array. Do not include markdown codeblocks or extra text outside the JSON array.

[
${assignedArchetypes.map((arch, i) => `  {
    "angle": "${arch.angle}",
    "hookType": "[Operational Challenge | Contrarian Insight | Direct Metric / Spec | Problem-Solver]",
    "heading": "[Crisp 4 to 7 word core takeaway headline summarizing the insight]",
    "subText": "[Single quantified proof point or metric e.g. '+42% Throughput' or 'DIN-5 Verified']",
    "hook": "[HVC Step 1 - Pattern Interrupt Hook: Exactly 1 sharp, compelling line (15-20 words max) that immediately stops the scroll with a real operational challenge, costly failure point, or surprising engineering truth. Zero greetings, zero pleasantries, zero fluff]",
    "body": "[HVC Step 2 - The Value Delivery: Exactly 2 to 3 crisp, punchy bullet points starting with emojis (🔹, ⚙️, 💡, 📊). Each bullet must be 1 concise sentence stating a concrete fact, spec, or measurable result. Never use paragraphs longer than 2 lines. Zero fluff]",
    "callToAction": "[HVC Step 3 - Single-Outcome Rule: Exactly ONE clear, direct, professional next step (e.g. 'Send us a DM with your CAD drawings for a free tolerance review' or 'Save this post for your next project cycle')]",
    "fullPost": "[THE COMPLETE, READY-TO-PUBLISH SOCIAL POST: Impeccably formatted copy combining Hook + blank line + Body + blank line + Call to Action + blank line + Hashtags. 100% self-contained for 1-click publishing directly to LinkedIn or Instagram without manual editing]",
    "hashtags": "[Strictly 3 to 4 hyper-relevant niche hashtags, space separated]"
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
3. CRYSTAL-CLEAR, CONCISE, AND ON-POINT COPYWRITING:
   - Make every caption razor-sharp, concise, and straight to the point. No rambling, no filler words, and absolutely no childish metaphors (NO baking bread, NO school cafeterias, NO 10-year-old analogies).
   - Write with the authoritative clarity of a senior technical director speaking directly to prospective clients, engineers, or procurement heads.
   - High information density with zero fluff: state the operational problem, state the precise engineering/technical solution, and state the quantified business outcome.
   - Ban dense academic/corporate jargon walls ('synergistic paradigm', 'sub-surface micro-porosity'). Keep language crisp, professional, and directly actionable.
4. STRICT NEGATIVE CONSTRAINT - NEVER USE RAW LABELS OR MARKDOWN ASTERISKS:
   - NEVER write raw labels like '**Before**', '**After**', '**Problem:**', '**Solution:**', '**Result:**', or '**Challenge:**'.
   - NEVER output unrendered markdown asterisks like \`**text\` or \`*text*\` inside bullet points. Social platforms display these as literal asterisks, which looks broken.
   - Express comparisons and results naturally without artificial label tags. For example:
     * NEVER WRITE: '• **Before:** 14-day turnaround. • **After:** 48-hour delivery.'
     * WRITE INSTEAD: '🔹 Cut component turnaround from 14 days down to 48 hours with automated CNC scheduling.'
     * NEVER WRITE: '• **Problem:** High thermal wear on standard valves.'
     * WRITE INSTEAD: '⚙️ Standard valves fail under 600°C thermal shock within 3 months; our inconel alloys run 24+ months continuous.'
5. EXACT COUNT: You must generate EXACTLY ${postCount} posts.
6. LANGUAGE REQUIREMENT: You must write the entire output exclusively in the **${language}** language.
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
7. MATHEMATICAL AND LOGICAL SANITY:
   - Metric improvements or percentage INCREASES must NEVER have a minus sign (e.g. write "+320% increase" or "jumped by 320%", NEVER "-320%").
   - Negative signs or "cut by / reduced by" should ONLY be used for cost, downtime, or defect reductions (e.g. "reduced CPC by 58%").
   - Ensure all percentages and calculations are mathematically coherent and realistic.
8. MODERN HVC COPYWRITING ARCHITECTURE (HOOK - VALUE - CTA):
   - Hook: Exactly 1 sharp, compelling line (15-20 words max). Operational challenge, counter-intuitive truth, or key metric. Zero preamble, zero greeting ('Hello connections', 'Hope you are well'). Must act as a pattern interrupt before '...see more'.
   - Value (Body): Exactly 2 to 3 concise, high-impact bullet points with clean emojis (🔹, ⚙️, 💡, 📊). Each bullet must be 1 clear sentence with real facts, specs, or metrics. No text walls.
   - Call to Action: The Single-Outcome Rule. Exactly ONE direct, professional action (e.g. 'Send us a DM with your drawings for a free tolerance review' or 'Save this post for your next project cycle'). Never dilute with multiple conflicting calls to action.
   - Hashtag Discipline: Strictly 3 to 4 clean, targeted niche hashtags at the bottom.
9. READY-TO-PUBLISH FULL POST INTEGRITY:
   - The 'fullPost' field must be completely self-contained, seamless, and flawless, combining Hook + Body + CTA + Hashtags, ready for the user to copy with 1-click and publish directly to LinkedIn, Instagram, or Facebook without any manual editing.

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
              const sanitizeMath = (str: string): string => {
                if (!str || typeof str !== 'string') return str || '';
                return str.replace(/\b(jumped|increased|rose|boosted|grew|surged|improved|up to)\s+([^\n.]+?)\s*\(-(\d+(?:\.\d+)?%)\s*(?:change|increase)?\)/gi, '$1 $2 (+$3)');
              };

              const cleanRawLabels = (str: string): string => {
                if (!str || typeof str !== 'string') return str || '';
                return str
                  .replace(/(^|[\n\r]+|\s*[•\-–*🔹⚙️💡📊🚀]\s*)\*\*(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome|Metric|Status|Benefit|Takeaway):\*\*\s*/gi, '$1')
                  .replace(/(^|[\n\r]+|\s*[•\-–*🔹⚙️💡📊🚀]\s*)(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome):\s*/gi, '$1')
                  .replace(/\*\*(?:Before|After|Problem|Solution|Result|Challenge|Impact|Outcome)\*\*/gi, '')
                  .replace(/\*\*([^*]+)\*\*/g, '$1')
                  .replace(/^[ \t]*[•\-–*][ \t]*[•\-–*][ \t]*/gm, '🔹 ')
                  .trim();
              };

              posts = parsed.map((p: any) => {
                const heading = cleanRawLabels(p.heading || p.title || '').trim();
                const subText = cleanRawLabels(p.subText || p.subtitle || '').trim();
                const hookType = (p.hookType || 'Operational Challenge').trim();
                const hook = cleanRawLabels(sanitizeMath((p.hook || p.content || '').trim()));
                const rawBody = cleanRawLabels(sanitizeMath((p.body || '').trim()));
                const cta = cleanRawLabels((p.callToAction || p.cta || '').trim());

                // Normalize hashtags: strictly 3-4 tags
                let rawTags = (p.hashtags || '').trim();
                let tagArray = rawTags.split(/\s+/).filter((t: string) => t.length > 0).map((t: string) => t.startsWith('#') ? t : `#${t}`);
                if (tagArray.length > 4) tagArray = tagArray.slice(0, 4);
                const hashtags = tagArray.join(' ');

                const angle = (p.angle || '').trim();
                const visualIdea = cleanRawLabels(p.visualIdea || p.visual_idea || p.concept || '').trim();
                const elements = cleanRawLabels(p.elements || p.designElements || p.design_elements || '').trim();
                const aspectRatio = p.aspectRatio || '1:1 Square (Feed)';
                
                let fullPost = p.fullPost ? cleanRawLabels(sanitizeMath(p.fullPost.trim())) : '';
                if (!fullPost) {
                  const parts: string[] = [];
                  if (hook) parts.push(hook);
                  if (rawBody) parts.push(rawBody);
                  if (cta && !rawBody.toLowerCase().includes(cta.toLowerCase())) {
                    parts.push(cta);
                  }
                  if (hashtags && !rawBody.includes(hashtags)) {
                    parts.push(hashtags);
                  }
                  fullPost = parts.join('\n\n').trim();
                } else {
                  // Ensure fullPost is cleanly sanitized
                  fullPost = cleanRawLabels(fullPost);
                }

                return JSON.stringify({
                  ...p,
                  angle,
                  hookType,
                  heading,
                  subText,
                  simpleExplanation: "",
                  hook,
                  content: hook, // for backwards-compatibility
                  body: rawBody,
                  callToAction: cta,
                  fullPost,
                  visualIdea,
                  elements,
                  aspectRatio,
                  imagePrompt: "",
                  imageUrl: "",
                  fallbackImageUrl: "",
                  hashtags
                });
              });
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
