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
import { createLogger } from "./utils/logger.js";

const logger = createLogger("Server");

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
const orchestrator = new OrchestratorAgent();
const smmAgent = new SmmAgent();
const competitorAgent = new CompetitorAgent();
const competitiveAnalysisAgent = new CompetitiveAnalysisAgent();
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
  response.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Business R&D Agent Console</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
    <style>
      :root {
        --bg: #0a0e1a;
        --surface: #111827;
        --surface2: #1a2236;
        --border: #1e2d47;
        --accent: #3b82f6;
        --accent-glow: rgba(59, 130, 246, 0.25);
        --text: #e2e8f0;
        --text-muted: #64748b;
        --text-dim: #94a3b8;
        --success: #10b981;
        --warning: #f59e0b;
        --error: #ef4444;
        --radius: 12px;
        --radius-sm: 8px;
        font-family: 'Inter', system-ui, sans-serif;
        background: var(--bg);
        color: var(--text);
        color-scheme: dark;
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      body {
        min-height: 100vh;
        background:
          radial-gradient(ellipse 80% 50% at 10% 0%, rgba(59,130,246,0.08) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 90% 100%, rgba(139,92,246,0.06) 0%, transparent 60%),
          var(--bg);
      }

      main {
        width: min(1160px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 48px 0 80px;
      }

      /* ---- Header ---- */
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 40px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--accent);
        background: rgba(59,130,246,0.12);
        border: 1px solid rgba(59,130,246,0.25);
        border-radius: 100px;
        padding: 4px 12px;
        margin-bottom: 16px;
      }
      .badge::before { content: "●"; font-size: 8px; }
      h1 {
        font-size: clamp(28px, 4vw, 48px);
        font-weight: 800;
        line-height: 1.1;
        letter-spacing: -0.03em;
        background: linear-gradient(135deg, #e2e8f0 0%, #94a3b8 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .subtitle {
        margin-top: 10px;
        color: var(--text-muted);
        font-size: 15px;
        line-height: 1.6;
        max-width: 560px;
      }

      /* ---- Tabs ---- */
      .tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--border);
        margin-bottom: 28px;
      }
      .tab {
        padding: 10px 20px;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-muted);
        border: none;
        background: none;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.2s;
        border-radius: 8px 8px 0 0;
      }
      .tab:hover { color: var(--text); }
      .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

      .tab-panel { display: none; }
      .tab-panel.active { display: block; }

      /* ---- Card ---- */
      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 28px;
        margin-bottom: 20px;
      }

      /* ---- Form ---- */
      label { display: grid; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
      label + label { margin-top: 16px; }
      input, textarea {
        width: 100%;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 12px 16px;
        font: 500 14px 'Inter', sans-serif;
        color: var(--text);
        background: var(--surface2);
        transition: border-color 0.2s, box-shadow 0.2s;
        outline: none;
      }
      input:focus, textarea:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px var(--accent-glow);
      }
      textarea { min-height: 88px; resize: vertical; }

      /* ---- Buttons ---- */
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: none;
        border-radius: var(--radius-sm);
        padding: 12px 22px;
        font: 700 14px 'Inter', sans-serif;
        cursor: pointer;
        transition: all 0.2s;
      }
      .btn-primary {
        background: var(--accent);
        color: #fff;
        box-shadow: 0 4px 16px rgba(59,130,246,0.35);
      }
      .btn-primary:hover:not(:disabled) {
        background: #2563eb;
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(59,130,246,0.45);
      }
      .btn-primary:disabled { opacity: 0.55; cursor: wait; transform: none; }

      .btn-secondary {
        background: var(--surface2);
        color: var(--text);
        border: 1px solid var(--border);
      }
      .btn-secondary:hover { background: var(--border); }

      .btn-row { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; align-items: center; }

      /* ---- Status bar ---- */
      .status-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        border-radius: var(--radius-sm);
        font-size: 13px;
        font-weight: 600;
        margin-top: 16px;
        min-height: 44px;
        background: var(--surface2);
        border: 1px solid var(--border);
        color: var(--text-muted);
        transition: all 0.3s;
      }
      .status-bar.running { color: var(--accent); border-color: rgba(59,130,246,0.4); }
      .status-bar.done    { color: var(--success); border-color: rgba(16,185,129,0.4); }
      .status-bar.error   { color: var(--error);   border-color: rgba(239,68,68,0.4); }

      .spinner {
        width: 16px; height: 16px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        flex-shrink: 0;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* ---- Progress pills ---- */
      .progress-pills {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 10px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        padding: 3px 10px;
        border-radius: 100px;
        background: var(--surface2);
        border: 1px solid var(--border);
        color: var(--text-muted);
      }
      .pill.done  { background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.3); color: var(--success); }
      .pill.error { background: rgba(239,68,68,0.1);   border-color: rgba(239,68,68,0.3);  color: var(--error); }

      /* ---- QC bar ---- */
      .qc-row {
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 14px 18px;
        background: var(--surface2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        margin-bottom: 14px;
        font-size: 13px;
      }
      .qc-score {
        font-size: 22px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .qc-score.pass { color: var(--success); }
      .qc-score.fail { color: var(--error); }

      .progress-track {
        flex: 1;
        height: 6px;
        background: var(--border);
        border-radius: 100px;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        border-radius: 100px;
        transition: width 0.6s ease;
      }
      .progress-fill.pass { background: linear-gradient(90deg, #10b981, #34d399); }
      .progress-fill.pass-warn { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
      .progress-fill.fail { background: linear-gradient(90deg, #ef4444, #f87171); }

      /* ---- Output ---- */
      pre {
        padding: 20px;
        background: #070c14;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        color: #a8c4e8;
        font: 13px/1.65 'JetBrains Mono', 'Fira Code', monospace;
        white-space: pre-wrap;
        overflow: auto;
        max-height: 600px;
      }

      /* ---- Memory query ---- */
      .query-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: end; }
      .query-answer {
        margin-top: 16px;
        padding: 16px;
        background: var(--surface2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        font-size: 14px;
        line-height: 1.7;
        display: none;
      }
      .query-answer.visible { display: block; }
      .answer-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-muted);
        margin-bottom: 6px;
      }
      .answer-text { color: var(--text); }
      .conf-badge {
        display: inline-block;
        margin-left: 8px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        padding: 2px 8px;
        border-radius: 100px;
      }
      .conf-high   { background: rgba(16,185,129,0.15); color: var(--success); }
      .conf-medium { background: rgba(245,158,11,0.15); color: var(--warning); }
      .conf-low    { background: rgba(239,68,68,0.12);  color: var(--error); }

      /* ---- Index stats ---- */
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
        margin-top: 20px;
      }
      .stat-card {
        background: var(--surface2);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 18px;
      }
      .stat-value { font-size: 28px; font-weight: 800; color: var(--accent); }
      .stat-label { font-size: 12px; color: var(--text-muted); margin-top: 4px; }

      @media (max-width: 720px) {
        .header { flex-direction: column; }
        .query-row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="header">
        <div>
          <div class="badge">Production System</div>
          <h1>Business R&D Agent Console</h1>
          <p class="subtitle">Enter any website URL to generate a QC-validated, fully-crawled business intelligence profile with queryable memory.</p>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        <button type="button" class="tab active" id="tab-analyse" onclick="switchTab('analyse')">🔍 Analyse</button>
        <button type="button" class="tab" id="tab-query"   onclick="switchTab('query')">💬 Query Memory</button>
        <button type="button" class="tab" id="tab-index"   onclick="switchTab('index')">📚 Index Stats</button>
        <button type="button" class="tab" id="tab-competitor" onclick="switchTab('competitor')">🎯 Competitors</button>
        <button type="button" class="tab" id="tab-analysis" onclick="switchTab('analysis')">⚔️ Gap Analysis</button>
      </div>

      <!-- ===== ANALYSE TAB ===== -->
      <div class="tab-panel active" id="panel-analyse">
        <div class="card">
          <form id="business-form" onsubmit="event.preventDefault(); return false;">
            <label>
              Website URL <span style="font-weight:400;color:var(--text-danger)">*</span>
              <input id="website-url" name="websiteUrl" type="url" placeholder="https://example.com" required />
            </label>

            <label>
              Brochure <span style="font-weight:400;color:var(--text-muted)">(optional PDF)</span>
              <input id="brochure-file" name="brochureFile" type="file" accept="application/pdf" />
            </label>
            <div class="btn-row">
              <button id="submit-button" class="btn btn-primary" type="submit">
                <span id="btn-icon">⚡</span> Run Intelligence
              </button>
            </div>
          </form>
        </div>

        <div id="status" class="status-bar">Ready to analyse a website.</div>

        <div id="progress-pills" class="progress-pills" style="display:none"></div>

        <!-- QC row (shown after result) -->
        <div id="qc-row" class="qc-row" style="display:none; margin-top:16px;">
          <div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);">QC Score</div>
            <div id="qc-score" class="qc-score">—</div>
          </div>
          <div class="progress-track">
            <div id="qc-fill" class="progress-fill" style="width:0%"></div>
          </div>
          <div id="qc-status" style="font-size:13px;font-weight:600;min-width:60px;text-align:right;"></div>
        </div>

        <div style="margin-top:16px;">
          <pre id="output">{}</pre>
        </div>
      </div>

      <!-- ===== QUERY TAB ===== -->
      <div class="tab-panel" id="panel-query">
        <div class="card">
          <p style="color:var(--text-dim);font-size:14px;margin-bottom:20px;">Query previously analysed business memories. Examples: <em>"Does this business manufacture pumps?"</em>, <em>"What industry is this?"</em></p>
          <label>
            Website URL (previously analysed)
            <input id="query-site" type="url" placeholder="https://example.com" />
          </label>
          <label style="margin-top:16px;">
            Question
            <input id="query-text" type="text" placeholder="Does this business offer consulting services?" />
          </label>
          <div class="btn-row">
            <button id="query-btn" class="btn btn-primary" onclick="runQuery()">Ask Question</button>
          </div>
          <div id="query-answer" class="query-answer">
            <div class="answer-label">Answer</div>
            <div id="answer-text" class="answer-text"></div>
          </div>
        </div>

        <div class="card" style="margin-top:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h2 style="font-size:18px;font-weight:700;">Social Media Marketing (SMM) Generation</h2>
          </div>
          <p style="color:var(--text-dim);font-size:14px;margin-bottom:20px;">Generate high-converting social media content directly from the highly structured memory core of this business.</p>
          <div style="display:flex;gap:12px;margin-bottom:16px;">
            <label style="flex:1;">
              Business Memory
              <select id="smm-site" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);margin-top:6px;">
                <option value="">Loading businesses...</option>
              </select>
            </label>
            <label style="flex:1;">
              Language
              <select id="smm-language" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);margin-top:6px;">
                <option value="English">English</option>
                <option value="Gujarati">Gujarati (ગુજરાતી)</option>
                <option value="Hindi">Hindi (हिन्दी)</option>
              </select>
            </label>
          </div>
          <div style="display:flex;gap:12px;margin-bottom:16px;">
            <label style="flex:1;">
              Content Type
              <select id="smm-type" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);margin-top:6px;">
                <option value="video">Video (Reel / TikTok Script)</option>
                <option value="image">Image (Concept & Caption)</option>
              </select>
            </label>
            <label style="flex:1;">
              Total Posts
              <input id="smm-total" type="number" min="1" max="50" value="3" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);margin-top:6px;" />
            </label>
          </div>
          <div class="btn-row">
            <button id="smm-btn" class="btn btn-primary" onclick="generateSMM()">Generate SMM Content</button>
          </div>
          <div id="smm-answer" class="query-answer" style="display:none;margin-top:20px;">
            <div class="answer-label">Generated Content</div>
            <div id="smm-text" class="answer-text" style="white-space:pre-wrap;"></div>
          </div>
        </div>
      </div>

      <!-- ===== INDEX TAB ===== -->
      <div class="tab-panel" id="panel-index">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h2 style="font-size:18px;font-weight:700;">Knowledge Index</h2>
            <button class="btn btn-secondary" style="font-size:12px;padding:8px 14px;" onclick="loadStats()">Refresh</button>
          </div>
          <div id="stats-area" class="stats-grid" style="margin-top:20px;">
            <div class="stat-card"><div class="stat-value" id="stat-sites">—</div><div class="stat-label">Sites Analysed</div></div>
            <div class="stat-card"><div class="stat-value" id="stat-named">—</div><div class="stat-label">Named Businesses</div></div>
          </div>
          <div id="industry-breakdown" style="margin-top:20px;"></div>
        </div>
      </div>

      <!-- ===== COMPETITORS TAB ===== -->
      <div class="tab-panel" id="panel-competitor">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h2 style="font-size:18px;font-weight:700;">Competitor Intelligence</h2>
          </div>
          <p style="color:var(--text-dim);font-size:14px;margin-bottom:20px;">Identify the top 10 local and global competitors using live web searches driven by this business's memory footprint.</p>
          <div style="display:flex;gap:12px;margin-bottom:16px;">
            <label style="flex:1;">
              Business Memory
              <select id="competitor-site" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);margin-top:6px;">
                <option value="">Loading businesses...</option>
              </select>
            </label>
          </div>
          <div class="btn-row">
            <button id="competitor-btn" class="btn btn-primary" onclick="findCompetitors()">Find Competitors</button>
          </div>
          <div id="competitor-answer" class="query-answer" style="display:none;margin-top:20px;">
            <div class="answer-label">Competitor Analysis</div>
            <div id="competitor-text" class="answer-text" style="white-space:pre-wrap;"></div>
          </div>
      </div>
      </div>

      <!-- ===== GAP ANALYSIS TAB ===== -->
      <div class="tab-panel" id="panel-analysis">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h2 style="font-size:18px;font-weight:700;">Competitive Gap Analysis</h2>
          </div>
          <p style="color:var(--text-dim);font-size:14px;margin-bottom:20px;">Crawl competitor websites and generate a strategic roadmap scoped strictly to your current product lines.</p>
          <div style="display:flex;gap:12px;margin-bottom:16px;">
            <label style="flex:1;">
              Business Memory
              <select id="analysis-site" style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);margin-top:6px;">
                <option value="">Loading businesses...</option>
              </select>
            </label>
          </div>
          <div class="btn-row">
            <button id="analysis-btn" class="btn btn-primary" onclick="runAnalysis()">Run Gap Analysis</button>
          </div>
          <div id="analysis-answer" class="query-answer" style="display:none;margin-top:20px;">
            <div class="answer-label">Strategy Report</div>
            <div id="analysis-text" class="answer-text" style="white-space:pre-wrap;"></div>
          </div>
        </div>
      </div>
    </main>

    <script src="/static/app.js"></script>
  </body>
</html>`);
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
    const input = { websiteUrl: finalUrl, socialUrls, brochureText };
    const profile = await orchestrator.run(input, (stepName) => {
      response.write(`data: ${JSON.stringify({ type: 'progress', step: stepName })}\n\n`);
    });
    response.write(`data: ${JSON.stringify({ type: 'complete', profile })}\n\n`);
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
// SMM Generation endpoint
// ---------------------------------------------------------------------------

app.post("/api/generate-smm", async (request, response) => {
  try {
    const { websiteUrl, type, totalPosts, language } = request.body;
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

    const posts = await smmAgent.run(memory, type as "video" | "image", Number(totalPosts), language || "English");
    response.json({ posts });
  } catch (error: any) {
    logger.error(`SMM Generation error: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Competitors endpoint
// ---------------------------------------------------------------------------

app.post("/api/competitors", async (request, response) => {
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

    const report = await competitorAgent.run(memory);
    response.json({ report });
  } catch (error: any) {
    logger.error(`Competitor Intelligence error: ${error.message}`);
    response.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Gap Analysis endpoint
// ---------------------------------------------------------------------------

app.post("/api/gap-analysis", async (request, response) => {
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
    
    logger.info(`Running competitor extraction for gap analysis...`);
    const compRes = await competitorAgent.run(memory);
    
    const urlRegex = /\-\s*\*\*Website:\*\*\s*(https?:\/\/[^\s\)]+)/g;
    const urls: string[] = [];
    let match;
    while ((match = urlRegex.exec(compRes)) !== null) {
      urls.push(match[1]);
    }
    
    if (urls.length === 0) {
       response.json({ report: "No competitor URLs found to analyze." });
       return;
    }

    logger.info(`Extracted ${urls.length} URLs. Running deep analysis...`);
    const report = await competitiveAnalysisAgent.run(memory, urls);
    response.json({ report });
  } catch (error: any) {
    logger.error(`Gap Analysis error: ${error.message}`);
    response.status(500).json({ error: error.message });
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
