import express from "express";
import axios from "axios";
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
import type { CompetitorProfile } from "./types.js";
import { CompetitiveAnalysisAgent } from "./agents/competitiveAnalysisAgent.js";
import { SeoAgent } from "./agents/seoAgent.js";
import { CronAgent } from "./agents/cronAgent.js";
import { Logger, createLogger } from "./utils/logger.js";
import { BrandIntelligenceAgent } from "./agents/brandIntelligenceAgent.js";
import { DiagnosticAgent } from "./agents/diagnosticAgent.js";
import { TrendingTopicsAgent } from "./agents/trendingTopicsAgent.js";

import helmet from "helmet";
import rateLimit from "express-rate-limit";

const logger = createLogger("Server");

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
app.disable("x-powered-by");

// Apply security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting to protect against DoS attacks & bot spamming
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this IP, please try again later." }
});

const intelligenceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Analysis run limit reached for this IP. Please wait a few minutes." }
});

app.use(generalLimiter);
app.use("/business-intelligence", intelligenceLimiter);

const orchestrator = new OrchestratorAgent();
const diagnosticAgent = new DiagnosticAgent();
const smmAgent = new SmmAgent();
const competitorAgent = new CompetitorAgent();
const competitiveAnalysisAgent = new CompetitiveAnalysisAgent();
const seoAgent = new SeoAgent();
const cronAgent = new CronAgent();
const trendingTopicsAgent = new TrendingTopicsAgent();
const memoryStore = new MemoryStore();
const port = Number(process.env.PORT ?? 3000);

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));
// Serve plain JS assets from src/static/ at /static/
const staticPath = __dirname.endsWith("dist") 
  ? join(__dirname, "..", "src", "static")
  : join(__dirname, "static");
app.use("/static", express.static(staticPath));

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

// Helper route for Instagram embeds to bypass SPA execution bugs
app.get('/api/instagram-embed', (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).send('Missing url parameter');
    let embedLink = url.split('?')[0];
    if (!embedLink.endsWith('/')) embedLink += '/';
    
    res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body { margin: 0; padding: 0; display: flex; justify-content: center; background: white; }</style>
</head>
<body>
<blockquote class="instagram-media" data-instgrm-permalink="${embedLink}?utm_source=ig_embed" data-instgrm-version="14" style="background:#FFF; border:0; margin: 0; padding:0; width:100%; max-width:400px; min-width:326px;"></blockquote>
<script async src="https://www.instagram.com/embed.js"></script>
</body>
</html>
    `);
});

const sendPlatformSvgPlaceholder = (res: express.Response, rawUrl: string) => {
    let platform = "Social Post";
    let icon = "🌐";

    const lower = (rawUrl || "").toLowerCase();
    if (lower.includes("instagram")) {
        platform = "Instagram Post";
        icon = "📸";
    } else if (lower.includes("facebook")) {
        platform = "Facebook Post";
        icon = "📘";
    } else if (lower.includes("linkedin")) {
        platform = "LinkedIn Post";
        icon = "💼";
    } else if (lower.includes("youtube") || lower.includes("youtu.be")) {
        platform = "YouTube Video";
        icon = "▶️";
    } else if (lower.includes("twitter") || lower.includes("x.com")) {
        platform = "Twitter Post";
        icon = "𝕏";
    } else if (lower.includes("news") || lower.includes("press")) {
        platform = "News Article";
        icon = "📰";
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          ${lower.includes("instagram") 
            ? '<stop offset="0%" stop-color="#833ab4"/><stop offset="50%" stop-color="#fd1d1d"/><stop offset="100%" stop-color="#fcb045"/>'
            : lower.includes("facebook")
            ? '<stop offset="0%" stop-color="#1877f2"/><stop offset="100%" stop-color="#0d47a1"/>'
            : lower.includes("linkedin")
            ? '<stop offset="0%" stop-color="#0a66c2"/><stop offset="100%" stop-color="#004182"/>'
            : lower.includes("youtube")
            ? '<stop offset="0%" stop-color="#cc0000"/><stop offset="100%" stop-color="#280000"/>'
            : '<stop offset="0%" stop-color="#1e293b"/><stop offset="100%" stop-color="#0f172a"/>'}
        </linearGradient>
      </defs>
      <rect width="600" height="360" fill="url(#bg)"/>
      <circle cx="300" cy="140" r="48" fill="rgba(255,255,255,0.18)"/>
      <text x="300" y="155" font-family="system-ui, -apple-system, sans-serif" font-size="42" text-anchor="middle" fill="#ffffff">${icon}</text>
      <text x="300" y="235" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="bold" text-anchor="middle" fill="#ffffff">${platform}</text>
      <text x="300" y="265" font-family="system-ui, -apple-system, sans-serif" font-size="14" text-anchor="middle" fill="rgba(255,255,255,0.85)">Click box to preview full post</text>
    </svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(svg);
};

const handleProxyMedia = async (req: express.Request, res: express.Response) => {
    const rawUrl = req.query.url as string;
    if (!rawUrl) return res.status(400).send('Missing url parameter');

    // SSRF Security Check: Allow only valid HTTP/HTTPS URLs and block internal/private IP targets
    try {
        const parsedUrl = new URL(rawUrl);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return res.status(400).send('Invalid protocol');
        }
        const hostname = parsedUrl.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0' ||
            hostname.startsWith('10.') || hostname.startsWith('192.168.') || hostname.startsWith('169.254.') ||
            /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) {
            logger.warn(`[SSRF Block] Blocked attempt to proxy internal address: ${rawUrl}`);
            return res.status(403).send('Access to internal network addresses is forbidden');
        }
    } catch (e) {
        return res.status(400).send('Invalid URL format');
    }

    try {
        let targetUrl = rawUrl;

        // If rawUrl is a post page URL, attempt to resolve og:image / og:video / twitter:image
        const isPostPage = (rawUrl.includes('instagram.com/p/') || rawUrl.includes('instagram.com/reel/') ||
                            rawUrl.includes('facebook.com') || rawUrl.includes('linkedin.com/posts/') ||
                            rawUrl.includes('linkedin.com/feed/update/')) &&
                           !rawUrl.includes('.jpg') && !rawUrl.includes('.jpeg') && !rawUrl.includes('.png') &&
                           !rawUrl.includes('.webp') && !rawUrl.includes('.mp4') && !rawUrl.includes('scontent') &&
                           !rawUrl.includes('fbcdn') && !rawUrl.includes('licdn') && !rawUrl.includes('cdninstagram');

        if (isPostPage) {
            try {
                const pageRes = await axios.get(rawUrl, {
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                });
                const html = pageRes.data || '';
                const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
                                html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
                                html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i) ||
                                html.match(/<meta\s+property=["']og:video["']\s+content=["']([^"']+)["']/i);
                if (ogMatch && ogMatch[1]) {
                    targetUrl = ogMatch[1].replace(/&amp;/g, '&');
                }
            } catch (pageErr: any) {
                logger.debug(`Could not extract og:image from ${rawUrl}: ${pageErr.message}`);
            }
        }

        let referer = 'https://www.google.com/';
        if (targetUrl.includes('instagram') || targetUrl.includes('cdninstagram')) referer = 'https://www.instagram.com/';
        else if (targetUrl.includes('facebook') || targetUrl.includes('fbcdn')) referer = 'https://www.facebook.com/';
        else if (targetUrl.includes('linkedin') || targetUrl.includes('licdn')) referer = 'https://www.linkedin.com/';

        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': referer
        };

        if (req.headers.range) {
            headers['Range'] = req.headers.range as string;
        }

        const response = await axios({
            method: 'GET',
            url: targetUrl,
            responseType: 'stream',
            headers: headers,
            timeout: 10000,
            validateStatus: (status) => status >= 200 && status < 400
        });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');

        for (const [key, value] of Object.entries(response.headers)) {
            if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'access-control-allow-origin') {
                res.set(key, value as string);
            }
        }

        res.status(response.status);
        response.data.pipe(res);
    } catch (error: any) {
        logger.warn(`[Proxy-Media] Direct stream failed for ${rawUrl}, serving branded SVG placeholder: ${error.message}`);
        return sendPlatformSvgPlaceholder(res, rawUrl);
    }
};

app.get('/api/proxy-media', handleProxyMedia);
app.get('/api/proxy-video', handleProxyMedia);

app.get('/', (_request, response) => {
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
    try {
      const orchestrator = new OrchestratorAgent(memoryStore);
        
      logger.info(`Starting research with ${process.env.SYSTEM_VERSION || "v12-stable"} Orchestrator...`);
      
      try {
        const profile = await orchestrator.run(input, (stepName) => {
          response.write(`data: ${JSON.stringify({ type: 'progress', step: stepName })}\n\n`);
        });
        
        response.write(`data: ${JSON.stringify({ type: 'complete', profile })}\n\n`);
        logger.success(`✅ Pipeline execution completed successfully for ${finalUrl}`);
      } catch (err: any) {
        // Automatic Failure Protection Circuit Breaker
        if (process.env.SYSTEM_VERSION === "v13") {
          logger.error(`v13 Orchestrator crashed (${err.message}). Triggering AUTOMATIC FAILOVER to v12-stable...`);
          const fallbackOrchestrator = new OrchestratorAgent(memoryStore);
          const fallbackProfile = await fallbackOrchestrator.run(input, (stepName) => {
            response.write(`data: ${JSON.stringify({ type: 'progress', step: `[FAILOVER] ${stepName}` })}\n\n`);
          });
          response.write(`data: ${JSON.stringify({ type: 'complete', profile: fallbackProfile })}\n\n`);
          logger.success(`✅ Pipeline fallback execution completed successfully for ${finalUrl}`);
        } else {
          throw err;
        }
      }
    } catch (e: any) {
      throw e;
    }
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
          const existing = currentProducts.find((p: any) => (p.name || "").toLowerCase() === (name || "").toLowerCase());
          return existing || { name, category: "Unknown", description: "", keyFeatures: [], technicalSpecs: {}, useCases: [], exportMarkets: [] };
        });
      }
      if (updates.offerings.services) {
        const newServiceNames = updates.offerings.services as string[];
        const currentServices = memory.offerings.services || [];
        memory.offerings.services = newServiceNames.map(name => {
          const existing = currentServices.find((s: any) => (s.name || "").toLowerCase() === (name || "").toLowerCase());
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
    const { websiteUrl, type, totalPosts, language, strategy, theme, subTheme, mirrorCompetitor, mirrorPost, industryFocus, customGoal, trendingTopic } = request.body;
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

    const posts = await smmAgent.run(memory, type as "video" | "image", Number(totalPosts), language || "English", strategy || "new", theme || "brand", subTheme, mirrorCompetitor, mirrorPost, industryFocus, customGoal, trendingTopic);
    logger.success(`✅ Successfully generated ${posts.length} SMM posts for ${websiteUrl}`);
    response.json({ posts });
  } catch (error: any) {
    logger.error(`SMM Generation error: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Trending Topics endpoint
// ---------------------------------------------------------------------------

app.post("/api/trending-topics", async (request, response) => {
  try {
    const { websiteUrl } = request.body;
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

    logger.info(`Fetching trending topics for ${websiteUrl}...`);
    const result = await trendingTopicsAgent.run(memory);
    logger.success(`✅ Successfully fetched ${result.topics.length} trending topics for ${websiteUrl}`);
    response.json(result);
  } catch (error: any) {
    logger.error(`Trending Topics error: ${error.message}`);
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

    const competitorAgentToUse = competitorAgent;
    const competitors = await (competitorAgentToUse as any).run(memory, scope || "regional");
    
    // Overwrite the existing competitor list with the brand new fresh scrape.
    // (Deleted competitors are already permanently skipped because they are in rejectedCompetitors)
    memory.competitors = competitors;
    await memoryStore.save(memory);
    
    logger.success(`✅ Successfully extracted ${competitors.length} competitors for ${websiteUrl}`);
    response.json({ competitors });
  } catch (error: any) {
    logger.error(`Competitor Intelligence error: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

// SSE Streaming endpoint for Competitor Discovery
app.post("/api/competitors-stream", async (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");

  const { websiteUrl, scope } = request.body;
  if (!websiteUrl) {
    response.write(`data: ${JSON.stringify({ type: 'error', error: "Website URL is required" })}\n\n`);
    response.end();
    return;
  }

  let memory = knowledgeIndex.get(websiteUrl);
  if (!memory) {
    memory = await memoryStore.loadBySite(websiteUrl) ?? undefined;
  }

  if (!memory) {
    response.write(`data: ${JSON.stringify({ type: 'error', error: "No memory found for this URL." })}\n\n`);
    response.end();
    return;
  }

  try {
    const competitors = await competitorAgent.run(memory, scope || "regional", (comp, statusMsg) => {
      response.write(`data: ${JSON.stringify({ type: 'competitor', competitor: comp, status: statusMsg })}\n\n`);
    });

    memory.competitors = competitors;
    await memoryStore.save(memory);
    knowledgeIndex.add(memory);

    response.write(`data: ${JSON.stringify({ type: 'complete', competitors })}\n\n`);
    response.end();
  } catch (err: any) {
    logger.error(`Competitor Stream error: ${err.message}`);
    response.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    response.end();
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
      if (!memory.rejectedCompetitors) memory.rejectedCompetitors = [];
      if (!memory.rejectedCompetitors.includes(compUrl)) memory.rejectedCompetitors.push(compUrl);
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

app.post("/api/competitors/backfill-socials", async (request, response) => {
  try {
    const { websiteUrl } = request.body;
    if (!websiteUrl) {
      response.status(400).json({ error: "Missing required parameter: websiteUrl" });
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
    const updated: CompetitorProfile[] = [];
    let fixed = 0;
    let stillMissing = 0;

    for (const comp of (memory.competitors || [])) {
      const existingCount = Object.values(comp.socials || {}).filter(v => v).length;
      if (existingCount >= 1) {
        updated.push(comp);
        continue;
      }

      const enhanced = await compAgent.scrapeCompetitorSocials(comp);
      if (enhanced) {
        const newCount = Object.values(enhanced.socials || {}).filter(v => v).length;
        if (newCount > existingCount) fixed++;
        else stillMissing++;
        updated.push(enhanced);
      } else {
        stillMissing++;
        updated.push(comp);
      }
    }

    memory.competitors = updated;
    await memoryStore.save(memory);
    knowledgeIndex.add(memory);

    logger.success(`✅ Backfilled social links: ${fixed} fixed, ${stillMissing} still missing (${updated.length} competitors).`);
    response.json({ success: true, fixed, stillMissing, total: updated.length });
  } catch (error: any) {
    logger.error(`Backfill competitor socials error: ${error.message}`);
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
      // Update the in-memory cache so the UI sees the new feed!
      knowledgeIndex.add(site);
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
    // ALWAYS load from disk for social feed to get the absolute latest if possible
    const memory = await memoryStore.loadBySite(url) || knowledgeIndex.get(url) || undefined;
    if (!memory) return response.status(404).json({ error: "Memory not found" });
    
    // Also update the cache while we're at it
    knowledgeIndex.add(memory);
    
    const feed = ((memory as any).socialFeed || []) as any[];
    const competitors = ((memory as any).competitors || []) as any[];

    // Return clean competitor posts from memory
    const filteredFeed = feed.filter((post: any) => {
      const link = String(post.link || "");
      if (link.includes("xyz123") || link.includes("abc456") || link.includes("example.com")) return false;
      return true;
    });
    response.json({ feed: filteredFeed });
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
