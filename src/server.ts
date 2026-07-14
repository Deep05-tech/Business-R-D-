import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ZodError } from "zod";
import multer from "multer";
import { QcFailureError } from "./errors.js";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import { promises as fs } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

const execAsync = promisify(exec);
import { parseBusinessInput } from "./input.js";
import { knowledgeIndex } from "./memory/knowledgeIndex.js";
import { MemoryStore } from "./memory/memoryStore.js";
import { OrchestratorAgent } from "./orchestrator.js";
import { QueryMemoryAgent } from "./agents/queryMemoryAgent.js";
import { SmmAgent } from "./agents/smmAgent.js";
import { CompetitorAgent } from "./agents/competitorAgent.js";
import { CompetitiveAnalysisAgent } from "./agents/competitiveAnalysisAgent.js";
import { SeoAgent } from "./agents/seoAgent.js";
import { CronAgent } from "./agents/cronAgent.js";
import { Logger, createLogger } from "./utils/logger.js";
import { DiagnosticAgent } from "./agents/diagnosticAgent.js";

const logger = createLogger("Server");

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
const orchestrator = new OrchestratorAgent();
const diagnosticAgent = new DiagnosticAgent();
const smmAgent = new SmmAgent();
const competitorAgent = new CompetitorAgent();
const competitiveAnalysisAgent = new CompetitiveAnalysisAgent();
const seoAgent = new SeoAgent();
const cronAgent = new CronAgent();
const memoryStore = new MemoryStore();
const port = Number(process.env.PORT ?? 3000);

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: "32kb" }));
// Serve plain JS assets from src/static/ at /static/
const staticPath = __dirname.endsWith("dist") 
  ? join(__dirname, "..", "src", "static")
  : join(__dirname, "static");
app.use("/static", express.static(staticPath));

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

app.get("/", (_request, response) => {
  response.sendFile(join(staticPath, 'index.html'));
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

app.get("/health", (_request, response) => {
  response.json({ status: "ok", indexedSites: knowledgeIndex.listSites().length });
});

// ---------------------------------------------------------------------------
// Business Intelligence endpoint
// ---------------------------------------------------------------------------

app.post("/business-intelligence", async (request, response) => {
  try {
    const input = parseBusinessInput(request.body);
    const profile = await orchestrator.run(input);
    response.json(profile);
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({
        error: "Invalid input. Only websiteUrl and socialUrls are accepted.",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
      return;
    }
    if (error instanceof QcFailureError) {
      response.status(422).json({ error: error.message, qc: error.qc });
      return;
    }
    logger.error("Business intelligence run failed:", error);
    response.status(500).json({ error: "Business intelligence run failed." });
  }
});

// ---------------------------------------------------------------------------
// Server-Sent Events (SSE) Progress endpoint
// ---------------------------------------------------------------------------
app.post("/api/analyze-stream", upload.single("brochureFile"), async (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");

  const url = request.body.websiteUrl as string;
  const socialUrls = (request.body.socialUrls as string || "").split(",").map(s => s.trim()).filter(Boolean);
  const customInstructions = request.body.customInstructions as string | undefined;
  
  if (!url) {
    response.write(`data: ${JSON.stringify({ type: 'error', error: "Website URL is required" })}\n\n`);
    response.end();
    return;
  }
  const finalUrl = url;

  try {
    let brochureText: string | undefined = undefined;
    if (request.file) {
      const instance = new PDFParse({ data: request.file.buffer });
      const pdfData = await instance.getText();
      brochureText = pdfData.text;

      // If pdf-parse failed to extract meaningful text, it's likely an image-based PDF. Run OCR fallback.
      // We must strip common pagination markers from pdf-parse before checking length.
      const cleanedPdfText = (brochureText || "").replace(/-- \d+ of \d+ --/g, "").trim();
      if (cleanedPdfText.length < 100) {
        logger.info("PDF appears to be image-based. Falling back to OCR using pdftoppm and GPT-4o Vision...");
        response.write(`data: ${JSON.stringify({ type: 'progress', step: 'OCR processing brochure' })}\n\n`);
        
        const tmpPdf = `/tmp/brochure_${Date.now()}.pdf`;
        const tmpImgPrefix = `/tmp/brochure_page_${Date.now()}`;
        
        await fs.writeFile(tmpPdf, request.file.buffer);
        
        try {
          await execAsync(`pdftoppm -jpeg ${tmpPdf} ${tmpImgPrefix}`);
          
          const files = await fs.readdir('/tmp');
          const pageImages = files
            .filter(f => f.startsWith(tmpImgPrefix.replace('/tmp/', '')) && f.endsWith('.jpg'))
            .sort();
            
          const visionModel = new ChatOpenAI({
            modelName: "gpt-4o",
            temperature: 0,
          });

          let ocrText = "";
          for (let i = 0; i < pageImages.length; i++) {
            const imgPath = `/tmp/${pageImages[i]}`;
            logger.info(`Running GPT-4o Vision OCR on page ${i + 1}/${pageImages.length}...`);
            
            const imageBuffer = await fs.readFile(imgPath);
            const base64Image = imageBuffer.toString("base64");
            
            const message = new HumanMessage({
              content: [
                {
                  type: "text",
                  text: "Extract all text, product names, technical specifications, tables, and descriptions from this brochure page exactly as they appear. Do not summarize. Maintain logical structure. Return ONLY the extracted text, and nothing else."
                },
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${base64Image}` }
                }
              ]
            });
            
            const aiResponse = await visionModel.invoke([message]);
            ocrText += `\n\n--- PAGE ${i + 1} ---\n\n${aiResponse.content}`;
            await fs.unlink(imgPath);
          }
          
          brochureText = ocrText;
          logger.info(`OCR complete. Extracted ${brochureText.length} characters.`);
        } catch (ocrErr) {
          logger.error(`OCR failed: ${ocrErr}`);
        } finally {
          await fs.unlink(tmpPdf).catch(() => {});
        }
      }
    }

    // Pass everything into the validator/orchestrator
    const input = { websiteUrl: finalUrl, socialUrls, brochureText, customInstructions };
    const profile = await orchestrator.run(input, (stepName) => {
      response.write(`data: ${JSON.stringify({ type: 'progress', step: stepName })}\n\n`);
    });
    response.write(`data: ${JSON.stringify({ type: 'complete', profile })}\n\n`);
    logger.success(`✅ Pipeline execution completed successfully for ${finalUrl}`);
  } catch (error: any) {
    if (error instanceof ZodError) {
      response.write(`data: ${JSON.stringify({ type: 'error', error: "Invalid input." })}\n\n`);
    } else if (error instanceof QcFailureError) {
      response.write(`data: ${JSON.stringify({ type: 'error', error: error.message, qc: error.qc })}\n\n`);
    } else {
      logger.error("Business intelligence stream failed:", error);
      response.write(`data: ${JSON.stringify({ type: 'error', error: "Business intelligence run failed." })}\n\n`);
    }
  } finally {
    try {
      const logs = Logger.getLogs();
      if (logs) {
        // Run diagnostics in background
        diagnosticAgent.run(logs).catch(e => logger.error(`Diagnostic agent background failure: ${e}`));
      }
      Logger.clearLogs();
    } catch (e) {
      logger.error(`Failed to handle logs: ${e}`);
    }
    response.end();
  }
});

// ---------------------------------------------------------------------------
// Memory query endpoint
// ---------------------------------------------------------------------------

app.get("/memory/query", async (request, response) => {
  const siteParam = request.query["site"];
  const questionParam = request.query["q"];

  if (typeof siteParam !== "string" || typeof questionParam !== "string") {
    response.status(400).json({ error: "Query params 'site' and 'q' are required." });
    return;
  }

  // Try in-process index first (fastest)
  let memory = knowledgeIndex.get(siteParam);

  // Fall back to disk if not in memory (e.g. after server restart)
  if (!memory) {
    memory = await memoryStore.loadBySite(siteParam) ?? undefined;
    if (memory) knowledgeIndex.add(memory); // warm the cache
  }

  if (!memory) {
    response.status(404).json({ error: `No stored memory found for "${siteParam}". Run analysis first.` });
    return;
  }

  const rawResult = await memoryStore.query(memory, questionParam);
  
  const queryAgent = new QueryMemoryAgent();
  const finalResult = await queryAgent.run(questionParam, rawResult);

  response.json(finalResult);
});

// ---------------------------------------------------------------------------
// Memory Update and Fetch endpoints
// ---------------------------------------------------------------------------
app.get("/api/memory", async (request, response) => {
  try {
    const url = request.query.url as string;
    if (!url) return response.status(400).json({ error: "Missing url param" });

    const memory = knowledgeIndex.get(url) || await memoryStore.loadBySite(url);
    if (!memory) return response.status(404).json({ error: "Memory not found" });

    response.json({ memory });
  } catch (e: any) {
    response.status(500).json({ error: e.message });
  }
});

app.post("/api/memory/update", async (request, response) => {
  try {
    const { url, updates } = request.body;
    if (!url || !updates) return response.status(400).json({ error: "Missing url or updates param" });

    let memory = knowledgeIndex.get(url) || await memoryStore.loadBySite(url);
    if (!memory) return response.status(404).json({ error: "Memory not found" });

    // Deep merge updates into memory
    if (updates.businessIdentity) {
      memory.businessIdentity = { ...memory.businessIdentity, ...updates.businessIdentity };
    }
    if (updates.brandPositioning) {
      memory.brandPositioning = { ...memory.brandPositioning, ...updates.brandPositioning };
    }
    if (updates.offerings) {
      if (updates.offerings.products) {
        const newProductNames = updates.offerings.products as string[];
        const currentProducts = memory.offerings.products || [];
        memory.offerings.products = newProductNames.map(name => {
          const existing = currentProducts.find((p: any) => p.name.toLowerCase() === name.toLowerCase());
          return existing || { name, category: "Unknown", description: "", keyFeatures: [], technicalSpecs: {}, useCases: [], exportMarkets: [] };
        });
      }
      if (updates.offerings.services) {
        const newServiceNames = updates.offerings.services as string[];
        const currentServices = memory.offerings.services || [];
        memory.offerings.services = newServiceNames.map(name => {
          const existing = currentServices.find((s: any) => s.name.toLowerCase() === name.toLowerCase());
          return existing || { name, description: "", applications: [], processes: [] };
        });
      }
    }
    if (updates.audience) {
      memory.audience = { ...memory.audience, ...updates.audience };
    }

    await memoryStore.save(memory);
    knowledgeIndex.add(memory); // Update the cache

    response.json({ success: true, memory });
  } catch (e: any) {
    logger.error(`Memory Update error: ${e.message}`);
    response.status(500).json({ error: e.message });
  }
});

app.delete("/api/memory", async (request, response) => {
  try {
    const url = request.query.url as string;
    if (!url) return response.status(400).json({ error: "Missing url param" });

    const deleted = await memoryStore.deleteBySite(url);
    if (deleted) {
      knowledgeIndex.remove(url);
      response.json({ success: true });
    } else {
      response.status(404).json({ error: "Memory not found to delete" });
    }
  } catch (e: any) {
    logger.error(`Memory Delete error: ${e.message}`);
    response.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// SMM Generation endpoint
// ---------------------------------------------------------------------------

app.post("/api/generate-smm", async (request, response) => {
  try {
    const { websiteUrl, type, totalPosts, language, strategy, theme, targetProduct } = request.body;
    if (!websiteUrl || !type || !totalPosts) {
      response.status(400).json({ error: "Missing required parameters." });
      return;
    }

    let memory = knowledgeIndex.get(websiteUrl);
    if (!memory) {
      memory = await memoryStore.loadBySite(websiteUrl) ?? undefined;
    }

    if (!memory) {
      response.status(404).json({ error: "No memory found for this URL. Please run the Intelligence Pipeline first." });
      return;
    }

    const posts = await smmAgent.run(memory, type as "video" | "image", Number(totalPosts), language || "English", strategy || "new", theme || "brand", targetProduct);
    logger.success(`✅ Successfully generated ${posts.length} SMM posts for ${websiteUrl}`);
    response.json({ posts });
  } catch (error: any) {
    logger.error(`SMM Generation error: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Competitors endpoint
// ---------------------------------------------------------------------------

app.get("/api/competitors", async (request, response) => {
  try {
    const url = request.query.url as string;
    if (!url) return response.status(400).json({ error: "Missing url param" });

    const memory = knowledgeIndex.get(url) || await memoryStore.loadBySite(url);
    if (!memory) return response.status(404).json({ error: "Memory not found" });

    response.json({ competitors: memory.competitors || [] });
  } catch (e: any) {
    response.status(500).json({ error: e.message });
  }
});

app.post("/api/competitors", async (request, response) => {
  try {
    const { websiteUrl, scope } = request.body;
    if (!websiteUrl) {
      response.status(400).json({ error: "Missing required parameter: websiteUrl" });
      return;
    }

    let memory = knowledgeIndex.get(websiteUrl);
    if (!memory) {
      memory = await memoryStore.loadBySite(websiteUrl) ?? undefined;
    }

    if (!memory) {
      response.status(404).json({ error: "No memory found for this URL. Please run the Intelligence Pipeline first." });
      return;
    }

    const competitors = await competitorAgent.run(memory, scope || "regional");
    
    // Save to memory so we don't have to fetch again
    memory.competitors = competitors;
    await memoryStore.save(memory);
    
    logger.success(`✅ Successfully extracted ${competitors.length} competitors for ${websiteUrl}`);
    response.json({ competitors });
  } catch (error: any) {
    logger.error(`Competitor Intelligence error: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

app.delete("/api/competitors/single", async (request, response) => {
  try {
    const { websiteUrl, compUrl } = request.body;
    if (!websiteUrl || !compUrl) {
      response.status(400).json({ error: "Missing required parameters" });
      return;
    }

    let memory = knowledgeIndex.get(websiteUrl);
    if (!memory) {
      memory = await memoryStore.loadBySite(websiteUrl) ?? undefined;
    }

    if (!memory) {
      response.status(404).json({ error: "No memory found for this URL." });
      return;
    }

    if (memory.competitors) {
      memory.competitors = memory.competitors.filter((c) => c.url !== compUrl);
      await memoryStore.save(memory);
    }

    response.json({ success: true });
  } catch (error: any) {
    logger.error(`Delete competitor error: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

app.post("/api/competitors/add", async (request, response) => {
  try {
    const { websiteUrl, compName, compUrl } = request.body;
    if (!websiteUrl || !compName || !compUrl) {
      response.status(400).json({ error: "Missing required parameters" });
      return;
    }

    let memory = knowledgeIndex.get(websiteUrl);
    if (!memory) {
      memory = await memoryStore.loadBySite(websiteUrl) ?? undefined;
    }

    if (!memory) {
      response.status(404).json({ error: "No memory found for this URL." });
      return;
    }

    const compAgent = new CompetitorAgent();
    // Use forceKeep to ensure it gets added even if socials aren't found initially
    const newComp = await compAgent.scrapeCompetitorSocials({
      name: compName,
      url: compUrl,
      type: "local",
      location: memory.businessIdentity?.location || "Unknown",
      forceKeep: true
    });

    if (newComp) {
      if (!memory.competitors) memory.competitors = [];
      memory.competitors.push(newComp);
      await memoryStore.save(memory);
      knowledgeIndex.add(memory);
    }

    logger.success(`✅ Successfully scraped and added manual competitor: ${compName}`);
    response.json({ success: true });
  } catch (error: any) {
    logger.error(`Add competitor error: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Gap Analysis endpoint
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SEO & Google Presence endpoint
// ---------------------------------------------------------------------------

app.post("/api/seo", async (request, response) => {
  try {
    const { websiteUrl } = request.body;
    let memory = knowledgeIndex.get(websiteUrl) || await memoryStore.loadBySite(websiteUrl) || undefined;
    if (!memory) return response.status(404).json({ error: "Memory not found" });
    const report = await seoAgent.run(memory);
    logger.success(`✅ Successfully generated SEO strategy for ${websiteUrl}`);
    response.json({ report });
  } catch (e: any) {
    response.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Social Feed (Cron) endpoints
// ---------------------------------------------------------------------------

app.post("/api/cron/run", async (request, response) => {
  try {
    const url = request.query.url as string;
    
    if (url) {
      const site = await memoryStore.loadBySite(url);
      if (!site) return response.status(404).json({ error: "Memory not found for this site." });
      await cronAgent.run(site, memoryStore);
    } else {
      // Fallback for legacy calls (runs for all)
      const sites = await memoryStore.loadAll();
      for (const site of sites) {
        await cronAgent.run(site, memoryStore);
      }
    }
    response.json({ status: "ok" });
  } catch (e: any) {
    response.status(500).json({ error: e.message });
  }
});

app.get("/api/social-feed", async (request, response) => {
  try {
    const url = request.query.url as string;
    const memory = knowledgeIndex.get(url) || await memoryStore.loadBySite(url) || undefined;
    if (!memory) return response.status(404).json({ error: "Memory not found" });
    response.json({ feed: (memory as any).socialFeed || [] });
  } catch (e: any) {
    response.status(500).json({ error: e.message });
  }
});


// ---------------------------------------------------------------------------
// Index stats endpoint
// ---------------------------------------------------------------------------

app.get("/memory/stats", async (_request, response) => {
  // Merge in-process index with anything on disk not yet loaded
  const onDisk = await memoryStore.loadAll();
  for (const m of onDisk) knowledgeIndex.add(m);

  response.json(knowledgeIndex.stats());
});

app.get("/api/sites", async (_request, response) => {
  const onDisk = await memoryStore.loadAll();
  const sites = onDisk.map(m => ({
    url: m.input.websiteUrl,
    name: m.businessIdentity?.officialName || m.input.websiteUrl
  }));
  response.json(sites);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(port, () => {
  logger.success(`Business R&D Agent System v2.0`);
  logger.info(`Listening on http://localhost:${port}`);
  logger.info(`Endpoints:`);
  logger.info(`  POST /business-intelligence`);
  logger.info(`  POST /api/generate-smm`);
  logger.info(`  GET  /memory/query?site=<url>&q=<question>`);
  logger.info(`  GET  /memory/stats`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(`Port ${port} is already in use.`);
    logger.error(`Run this to free it:  fuser -k ${port}/tcp`);
    logger.error(`Or set a different port:  PORT=3001 npm run dev`);
    process.exit(1);
  } else {
    throw err;
  }
});
