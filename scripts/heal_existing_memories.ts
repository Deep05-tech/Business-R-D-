import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryStore } from "../src/memory/memoryStore.js";
import type { StructuredMemory } from "../src/types.js";

async function main() {
  console.log("=== Healing Existing Project Memories ===");
  const memoryStore = new MemoryStore("data/memory");
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
    let modified = false;

    const indLower = (mem.businessIdentity?.industry || mem.businessIdentity?.subIndustry || "").toLowerCase();

    // 1. Check and heal Buyer Personas
    if (!mem.audience) {
      mem.audience = { buyerPersonas: [], geographies: [], targetIndustries: [] };
      modified = true;
    }
    if (!mem.audience.buyerPersonas || mem.audience.buyerPersonas.length === 0) {
      if (/manufactur|forg|machin|casting|steel|metal|industrial|engineering|auto/i.test(indLower)) {
        mem.audience.buyerPersonas = [
          "Procurement Managers",
          "VP of Supply Chain",
          "Plant Operations Directors",
          "Chief Mechanical Engineers",
          "Tier-1 OEM Sourcing Leads"
        ];
      } else if (/software|technology|it|saas|cloud/i.test(indLower)) {
        mem.audience.buyerPersonas = [
          "Chief Technology Officers (CTOs)",
          "VP of Engineering",
          "IT Directors",
          "Enterprise Architects",
          "Product Managers"
        ];
      } else if (/marketing|seo|advertising|digital|media|branding/i.test(indLower)) {
        mem.audience.buyerPersonas = [
          "Chief Marketing Officers (CMOs)",
          "Brand Directors",
          "Marketing Operations Leads",
          "E-Commerce Growth Managers"
        ];
      } else if (/seed|agri|crop|farming/i.test(indLower)) {
        mem.audience.buyerPersonas = [
          "Commercial Farm Owners",
          "Agri-Input Distributors",
          "Agricultural Procurement Heads",
          "Agronomists"
        ];
      } else {
        mem.audience.buyerPersonas = [
          "Business Owners",
          "Managing Directors",
          "Procurement & Sourcing Heads",
          "Operations Directors"
        ];
      }
      modified = true;
      console.log(`[Healed] ${mem.businessIdentity?.officialName || file}: Injected ${mem.audience.buyerPersonas.length} buyer personas`);
    }

    // 2. Check and heal Core Services
    if (!mem.offerings) {
      mem.offerings = { products: [], services: [], valuePropositions: [] };
      modified = true;
    }
    if (!mem.offerings.services || mem.offerings.services.length === 0) {
      if (/forg|machin|casting|foundry|valve|gear|bearing|steel|metal|manufacturing|industrial/i.test(indLower)) {
        mem.offerings.services = [
          {
            name: "Custom Component Manufacturing & Forging",
            description: "Precision manufacturing and forging tailored to customer CAD models, technical drawings, and metallurgical requirements.",
            applications: ["Automotive", "Heavy Engineering", "Industrial Assemblies"],
            processes: ["Hot/Warm Forging", "Die Design", "Quality Inspection"]
          },
          {
            name: "CNC Precision Machining & Turning",
            description: "High-precision CNC turning, milling, and fine-tolerance machining for mission-critical parts.",
            applications: ["Power Transmission", "Aerospace", "Capital Equipment"],
            processes: ["CNC Turning", "VMC Milling", "Grinding"]
          },
          {
            name: "Heat Treatment & Surface Processing",
            description: "Complete heat treatment cycles including annealing, normalizing, hardening, and stress relieving.",
            applications: ["High-Load Applications", "Wear Resistance"],
            processes: ["Controlled Atmosphere Furnaces", "Quenching"]
          },
          {
            name: "Quality Assurance & Metallurgical Lab Testing",
            description: "Comprehensive testing including CMM 3D inspection, spectrometry, microstructure analysis, and ultrasonic NDT.",
            applications: ["Zero-Defect Mandates", "PPAP Submissions"],
            processes: ["CMM", "Spectrometry", "NDT Testing"]
          }
        ];
      } else if (/seed|agri|crop|farming/i.test(indLower)) {
        mem.offerings.services = [
          {
            name: "Seed Processing & Quality Conditioning",
            description: "Advanced seed cleaning, grading, gravity separation, and seed treatment for high germination rates.",
            applications: ["Commercial Agriculture", "Farmer Support"],
            processes: ["Grading", "Cleaning", "Treatment"]
          },
          {
            name: "Agronomic Advisory & Field Consulting",
            description: "Technical consulting on soil prep, sowing density, irrigation, and pest management.",
            applications: ["Crop Yield Optimization"],
            processes: ["Field Demonstrations", "Agronomy Support"]
          },
          {
            name: "Germination & Genetic Purity Testing",
            description: "Rigorous laboratory testing certifying high physical and genetic seed purity.",
            applications: ["Quality Assurance"],
            processes: ["Lab Germination Tests", "DNA Testing"]
          }
        ];
      } else {
        mem.offerings.services = [
          {
            name: "Custom Solutions & Technical Advisory",
            description: "Tailored enterprise solutions engineered to meet client operational requirements.",
            applications: ["Enterprise Operations"],
            processes: ["Requirements Analysis", "Solution Architecture", "Deployment"]
          },
          {
            name: "Quality Support & Ongoing Maintenance",
            description: "Dedicated client support, SLA maintenance, and continuous quality assurance.",
            applications: ["Operational Excellence"],
            processes: ["Helpdesk", "Scheduled Maintenance", "Performance Reviews"]
          }
        ];
      }
      modified = true;
      console.log(`[Healed] ${mem.businessIdentity?.officialName || file}: Injected ${mem.offerings.services.length} core services`);
    }

    // 3. Check and heal Vision & Description
    if (!mem.businessIdentity?.vision || mem.businessIdentity.vision.trim().length < 5) {
      if (!mem.businessIdentity) mem.businessIdentity = {} as any;
      const indTitle = mem.businessIdentity.subIndustry || mem.businessIdentity.industry || "engineering & commercial solutions";
      mem.businessIdentity.vision = `To be an industry-leading, globally trusted partner in ${indTitle}, delivering exceptional quality, operational precision, and sustainable value for our clients.`;
      modified = true;
      console.log(`[Healed] ${mem.businessIdentity?.officialName || file}: Injected vision statement`);
    }
    if (!mem.businessIdentity?.description || mem.businessIdentity.description.trim().length < 15) {
      if (!mem.businessIdentity) mem.businessIdentity = {} as any;
      const coName = mem.businessIdentity.officialName || "The company";
      const indTitle = mem.businessIdentity.subIndustry || mem.businessIdentity.industry || "specialized engineering and commercial solutions";
      mem.businessIdentity.description = `${coName} is an established provider specializing in ${indTitle}, dedicated to high standards of quality, reliability, and customer-centric delivery.`;
      modified = true;
      console.log(`[Healed] ${mem.businessIdentity?.officialName || file}: Injected description`);
    }

    if (modified) {
      await memoryStore.save(mem);
      console.log(`[Saved & Synced] ${mem.businessIdentity?.officialName || file}`);
    }
  }

  console.log("=== All Existing Project Memories Healed Successfully ===");
}

main().catch(err => {
  console.error("Healing failed:", err);
  process.exit(1);
});
