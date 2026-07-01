/* eslint-disable @typescript-eslint/no-explicit-any */
import { createWriteStream } from "fs";
import { createLogger } from "./logger.js";
import type { BusinessIntelligenceProfile, StructuredMemory, ProductDetailed, ServiceDetailed, ProcessDetailed } from "../types.js";

const logger = createLogger("PDF Generator");

/**
 * Dynamically import pdfmake internals (ESM‑safe).
 */
async function loadPdfmakeInternals(): Promise<{ PdfPrinter: any; virtualFs: any; URLResolver: any }> {
  // @ts-ignore
  const printerMod = await import("pdfmake/js/Printer.js");
  // @ts-ignore
  const vfsMod = await import("pdfmake/js/virtual-fs.js");
  // @ts-ignore
  const urlResolverMod = await import("pdfmake/js/URLResolver.js");
  return {
    PdfPrinter: printerMod.default ?? printerMod,
    virtualFs: vfsMod.default ?? vfsMod,
    URLResolver: urlResolverMod.default ?? urlResolverMod,
  };
}

const FONT_DESCRIPTORS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function heading(text: string): any {
  return { text, style: "sectionHeader", margin: [0, 20, 0, 10] };
}

function parseMarkdownBold(text: string | undefined): any {
  if (!text) return { text: "Pending", italics: true };
  
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map(part => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return { text: part.slice(2, -2), bold: true };
    }
    return { text: part };
  });
}

function subHeading(text: string): any {
  return { text, style: "subHeader", margin: [0, 15, 0, 5] };
}

function bulletList(items: string[] | undefined, emptyText = "N/A"): any {
  if (!items || items.length === 0) return { text: emptyText, italics: true, color: "#888", margin: [0, 0, 0, 10] };
  return { ul: [...items], margin: [0, 0, 0, 14] };
}

function labelValue(label: string, value: string | number | undefined | null): any {
  return {
    text: [
      { text: `${label}: `, bold: true },
      { text: String(value ?? "N/A") },
    ],
    margin: [0, 2, 0, 2] as [number, number, number, number],
  };
}

function hasData(val: any): boolean {
  if (!val) return false;
  if (Array.isArray(val)) {
    if (val.length === 0) return false;
    const allNa = val.every(v => typeof v === "string" && (v.trim().toUpperCase() === "N/A" || v.trim().toUpperCase() === "NONE" || v.toLowerCase().includes("no spec") || v === ""));
    if (allNa) return false;
    return true;
  }
  if (typeof val === "object") {
    if (Object.keys(val).length === 0) return false;
    const allNa = Object.values(val).every(v => typeof v === "string" && (v.trim().toUpperCase() === "N/A" || v.trim().toUpperCase() === "NONE" || v.toLowerCase().includes("no spec") || v === ""));
    if (allNa) return false;
    return true;
  }
  if (typeof val === "string") {
    const v = val.trim().toUpperCase();
    return v !== "N/A" && v !== "NONE" && v !== "" && !val.toLowerCase().includes("no spec");
  }
  return true;
}

function renderTable(obj: Record<string, string> | undefined): any {
  if (!hasData(obj)) return null;
  const body = Object.entries(obj!).filter(([k, v]) => hasData(v)).map(([k, v]) => [{ text: k, bold: true }, { text: v }]);
  if (body.length === 0) return null;
  return {
    table: {
      headerRows: 0,
      widths: ["30%", "70%"],
      body: body
    },
    layout: 'lightHorizontalLines',
    margin: [0, 5, 0, 15]
  };
}

// ---------------------------------------------------------------------------
// PdfReportGenerator
// ---------------------------------------------------------------------------

export class PdfReportGenerator {
  async generateReport(
    profile: BusinessIntelligenceProfile,
    summaryText: string,
    outputPath: string,
  ): Promise<void> {
    const profileClone = JSON.parse(JSON.stringify(profile));
    const mem = profileClone.structuredJsonMemoryObject;
    const name = mem.businessIdentity.officialName || "Unknown Business";

    logger.info(`Composing long-form document for "${name}"...`);

    const docDefinition = this.buildDocDefinition(mem, name, summaryText);

    const { PdfPrinter, virtualFs, URLResolver } = await loadPdfmakeInternals();
    const urlResolver = new URLResolver(virtualFs);
    const printer = new PdfPrinter(FONT_DESCRIPTORS, virtualFs, urlResolver);
    const pdfDoc = await printer.createPdfKitDocument(docDefinition);

    return new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(outputPath);
      pdfDoc.pipe(stream);
      pdfDoc.end();
      stream.on("finish", () => {
        logger.success(`PDF written to ${outputPath}`);
        resolve();
      });
      stream.on("error", (err: Error) => reject(err));
    });
  }

  // ---------------------------------------------------------------------------
  // Document definition
  // ---------------------------------------------------------------------------

  private buildDocDefinition(mem: StructuredMemory, name: string, summaryText: string): any {
    const content: any[] = [];

    // Title Page
    content.push({ text: name, style: "title" });
    content.push({ text: "Deep Intelligence Report", style: "subtitle", margin: [0, 5, 0, 5] });
    content.push({ text: mem.input.websiteUrl, style: "subtitle", color: "#0066cc", margin: [0, 2, 0, 40] });

    // Executive Summary
    content.push(heading("Executive Summary"));
    content.push({ text: summaryText, margin: [0, 0, 0, 16] });

    // Business Identity
    content.push(heading("Business Identity"));
    content.push(labelValue("Official Name", mem.businessIdentity.officialName));
    content.push(labelValue("Industry", mem.businessIdentity.industry));
    content.push(labelValue("Sub-Industry", mem.businessIdentity.subIndustry));
    content.push(labelValue("Business Model", mem.businessIdentity.businessModel));
    content.push({ text: "", margin: [0, 0, 0, 20] });

    // Products
    if (mem.offerings.products && mem.offerings.products.length > 0) {
      content.push({ text: "Product Catalog", style: "chapterHeader", pageBreak: "before" });
      for (const product of mem.offerings.products) {
        const headerStack: any[] = [];
        headerStack.push(subHeading(product.name));
        if (product.category && product.category !== "General") {
          headerStack.push({ text: `Category: ${product.category}`, italics: true, color: "#666", margin: [0, 0, 0, 5] });
        }
        headerStack.push({ text: product.description, margin: [0, 0, 0, 10] });
        
        content.push({ unbreakable: true, stack: headerStack });
        
        if (hasData(product.keyFeatures)) {
          content.push({ text: "Key Features:", bold: true });
          content.push(bulletList(product.keyFeatures));
        }

        if (hasData(product.technicalSpecs)) {
          content.push({ text: "Technical Specifications:", bold: true });
          content.push(renderTable(product.technicalSpecs));
        }

        if (hasData(product.useCases)) {
          content.push({ text: "Use Cases:", bold: true });
          content.push(bulletList(product.useCases));
        }

        if (hasData(product.exportMarkets)) {
          content.push({ text: "Export Markets:", bold: true });
          content.push(bulletList(product.exportMarkets));
        }

        if (hasData(product.subProducts)) {
          content.push({ text: "Sub-Products / Variations:", bold: true, margin: [0, 10, 0, 5] });
          
          const maxToRender = 10;
          const displaySubs = product.subProducts!.slice(0, maxToRender);
          
          const subList = displaySubs.map(sub => {
            if (sub.description) return `${sub.name}: ${sub.description}`;
            return sub.name;
          });
          content.push(bulletList(subList));
          
          if (product.subProducts!.length > maxToRender) {
            const hiddenCount = product.subProducts!.length - maxToRender;
            content.push({ 
              text: `*(+ ${hiddenCount} more specific variations recorded in internal database)*`, 
              italics: true, 
              color: "#888", 
              margin: [0, -5, 0, 10] 
            });
          }
        }

        content.push({ text: `${product.name} Summary:`, bold: true, color: "#006600", margin: [0, 10, 0, 5] });
        content.push({ text: parseMarkdownBold(product.aiLaymanSummary), italics: true, margin: [0, 0, 0, 10] });
      }
    }

    // Services
    if (mem.offerings.services && mem.offerings.services.length > 0) {
      content.push({ text: "Services Offered", style: "chapterHeader", pageBreak: "before" });
      for (const service of mem.offerings.services) {
        content.push({
          unbreakable: true,
          stack: [
            subHeading(service.name),
            { text: service.description, margin: [0, 0, 0, 10] }
          ]
        });

        if (hasData(service.applications)) {
          content.push({ text: "Applications:", bold: true });
          content.push(bulletList(service.applications));
        }

        if (hasData(service.processes)) {
          content.push({ text: "Processes Involved:", bold: true });
          content.push(bulletList(service.processes));
        }

        content.push({ text: `${service.name} Summary:`, bold: true, color: "#006600", margin: [0, 10, 0, 5] });
        content.push({ text: parseMarkdownBold(service.aiLaymanSummary), italics: true, margin: [0, 0, 0, 10] });
      }
    }

    // Processes & Capabilities
    if (mem.processes?.processes && mem.processes.processes.length > 0) {
      content.push({ text: "Manufacturing & R&D Processes", style: "chapterHeader", pageBreak: "before" });
      for (const process of mem.processes.processes) {
        content.push({
          unbreakable: true,
          stack: [
            subHeading(process.name),
            { text: process.description, margin: [0, 0, 0, 10] }
          ]
        });

        if (hasData(process.capacity)) {
          content.push(labelValue("Capacity", process.capacity));
        }
        
        if (hasData(process.workflow)) {
          content.push({ text: "Workflow / Steps:", bold: true, margin: [0, 10, 0, 5] });
          content.push({ ol: process.workflow ? [...process.workflow] : [], margin: [0, 0, 0, 10] });
        }

        if (hasData(process.machineryUsed)) {
          content.push({ text: "Machinery Used:", bold: true });
          content.push(bulletList(process.machineryUsed));
        }
      }
    }

    // Audience & Positioning
    content.push({ text: "Audience & Market", style: "chapterHeader", pageBreak: "before" });
    content.push(heading("Target Buyer Personas"));
    content.push(bulletList(mem.audience.buyerPersonas));
    content.push(heading("Target Industries"));
    content.push(bulletList(mem.audience.targetIndustries));
    content.push(heading("Value Propositions (USPs)"));
    content.push(bulletList(mem.offerings.valuePropositions));
    content.push(heading("Brand Tone"));
    content.push({ text: mem.brandPositioning.tone || "N/A", margin: [0, 0, 0, 20] });

    // Digital Maturity
    content.push(heading("Digital Maturity & SEO Observations"));
    content.push(labelValue("Overall Maturity Score", `${mem.digitalMaturity.score}/100`));
    content.push(labelValue("Website Quality Score", `${mem.digitalMaturity.websiteQuality.score}/100`));
    content.push(labelValue("SEO Readiness Score", `${mem.digitalMaturity.seoReadiness.score}/100`));
    
    content.push({ text: "SEO Gaps & Opportunities:", bold: true, margin: [0, 10, 0, 5] });
    content.push(bulletList(mem.digitalMaturity.seoReadiness.gaps));

    content.push(heading("R&D Insights & Recommendations"));
    content.push(bulletList(mem.rdInsights.opportunities));

    // Marketing & Sales Intelligence
    if (mem.marketingSales) {
      content.push({ text: "Marketing & Sales Strategy", style: "chapterHeader", pageBreak: "before" });
      
      content.push(heading("Content Strategy"));
      content.push(labelValue("Platforms", mem.marketingSales.contentStrategy.platforms.join(", ")));
      content.push(labelValue("Post Types", mem.marketingSales.contentStrategy.postTypes.join(", ")));
      content.push({ text: "Core Themes:", bold: true, margin: [0, 5, 0, 5] });
      content.push(bulletList(mem.marketingSales.contentStrategy.themes));
      
      content.push(heading("Creative Concepts"));
      if (mem.marketingSales.creativeConcepts && mem.marketingSales.creativeConcepts.length > 0) {
        for (const concept of mem.marketingSales.creativeConcepts) {
          content.push(subHeading(`${concept.type} - ${concept.targetAudience}`));
          content.push({ text: concept.concept, italics: true, margin: [0, 2, 0, 5] });
          content.push({ text: concept.description, margin: [0, 0, 0, 10] });
        }
      }

      content.push(heading("Competitor Landscape"));
      if (mem.marketingSales.competitors && mem.marketingSales.competitors.length > 0) {
         content.push({
           layout: 'lightHorizontalLines',
           table: {
             headerRows: 1,
             widths: ['*', 'auto', 'auto', '*'],
             body: [
               [ {text:'Competitor', bold:true, fontSize: 10}, {text:'Region', bold:true, fontSize: 10}, {text:'Threat', bold:true, fontSize: 10}, {text:'Differentiator', bold:true, fontSize: 10} ],
               ...mem.marketingSales.competitors.map(c => [
                 { text: c.name, fontSize: 9 }, 
                 { text: c.region, fontSize: 9 }, 
                 { text: c.threatLevel, fontSize: 9 }, 
                 { text: c.differentiator, fontSize: 9 }
               ])
             ]
           },
           margin: [0, 0, 0, 15]
         });
      }

      content.push({ text: "LinkedIn Outreach Playbook", style: "chapterHeader", pageBreak: "before" });
      content.push({ text: "50 Targeted pitch messages to convert customers, categorized by persona.", margin: [0, 0, 0, 15], italics: true, color: "#666" });
      
      if (mem.marketingSales.linkedinOutreach && mem.marketingSales.linkedinOutreach.length > 0) {
        for (const personaGroup of mem.marketingSales.linkedinOutreach) {
           content.push(heading(`Persona: ${personaGroup.persona}`));
           if (personaGroup.messages && personaGroup.messages.length > 0) {
             const messageList = personaGroup.messages.map(m => ({ text: m, margin: [0, 0, 0, 8] }));
             content.push({ ul: messageList, margin: [10, 0, 0, 15], fontSize: 9 });
           }
        }
      }
    }

    // Source Tracking removed as requested

    return {
      defaultStyle: { font: "Helvetica", fontSize: 10, lineHeight: 1.35 },
      pageSize: "A4",
      pageMargins: [50, 60, 50, 60] as [number, number, number, number],

      header: (currentPage: number, pageCount: number) => ({
        columns: [
          { text: "Deep Intelligence Report", fontSize: 8, color: "#999", margin: [50, 20, 0, 0] },
          { text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: "#999", alignment: "right", margin: [0, 20, 50, 0] },
        ],
      }),

      footer: () => ({
        text: `Generated on ${new Date().toLocaleDateString("en-US")} by Vispan Solutions`,
        fontSize: 7,
        color: "#aaa",
        alignment: "center",
        margin: [0, 0, 0, 20],
      }),

      styles: {
        title: { fontSize: 24, bold: true, margin: [0, 0, 0, 8] },
        subtitle: { fontSize: 14, color: "#666", margin: [0, 0, 0, 12] },
        chapterHeader: { fontSize: 18, bold: true, color: "#333", margin: [0, 10, 0, 15] },
        sectionHeader: { fontSize: 14, bold: true, color: "#444", margin: [0, 15, 0, 8] },
        subHeader: { fontSize: 12, bold: true, color: "#222", margin: [0, 10, 0, 5] },
      },
      content,
    };
  }
}
