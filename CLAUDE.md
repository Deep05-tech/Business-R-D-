# Business R&D Agent System — CLAUDE.md

> **Persistent System Memory for Future Claude Code Instances**
> This document captures the complete architecture, conventions, and modification patterns so any Claude instance can make surgical, bug-free changes.

---

## 🏗️ System Overview

A hierarchical multi-agent business intelligence system that transforms a website/social URL into a comprehensive `BusinessIntelligenceProfile` (JSON + PDF + Vector KB). 

**Core Pipeline**: 7 phases, 20+ specialized agents, orchestrated by `OrchestratorAgent` with cascading QC retries and real-time SSE streaming.

---

## 📁 Repository Structure (Canonical)

```
/home/uday/Agents/Business R&D/
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env                          # API keys (never commit)
├── PROJECT_CONTEXT.md            # Architecture docs + known issues
├── runAgent.ts                   # CLI test harness
├── CLAUDE.md                     # THIS FILE
├── dist/                         # Compiled output (gitignored)
├── data/
│   └── memory/                   # Local JSON persistence (auto-created)
├── src/
│   ├── index.ts                  # Entry point (builds server)
│   ├── server.ts                 # Express + SSE server (2652 lines)
│   ├── orchestrator.ts           # Core 7-phase pipeline (940 lines)
│   ├── types.ts                  # 376 lines of TypeScript interfaces
│   ├── config/
│   │   └── agentRules.ts         # Central policy: models, QC, cleaning
│   ├── agents/
│   │   ├── agentRegistry.ts      # Factory: all 20+ agent instances
│   │   ├── webScraperAgent.ts    # Thin wrapper over WebTool.crawlWebsite()
│   │   ├── semanticCleaningAgent.ts  # Noise filtering via heuristics DB
│   │   ├── webIntelligenceAgent.ts   # Homepage analysis, SEO, offerings map
│   │   ├── socialIntelligenceAgent.ts  # Social profile + post extraction
│   │   ├── businessIdentityAgent.ts    # Multi-priority name resolution
│   │   ├── offeringsExtractionAgent.ts # Map-reduce + taxonomy + deep merge
│   │   ├── aiContentAgent.ts         # Layman summaries (gpt-4o-mini)
│   │   ├── audienceIntelligenceAgent.ts # Buyer personas with fallbacks
│   │   ├── brandIntelligenceAgent.ts   # Tone, positioning, USPs
│   │   ├── digitalMaturityAgent.ts     # Scoring: website 45%, SEO 35%, social 20%
│   │   ├── rdInsightAgent.ts           # Live web search + LLM synthesis
│   │   ├── marketingSalesAgent.ts      # Content strategy, LinkedIn outreach
│   │   ├── competitorAgent.ts          # Google Places + semantic search (1492 lines)
│   │   ├── competitiveAnalysisAgent.ts # Map-reduce gap analysis
│   │   ├── seoAgent.ts                 # Deep SEO footprint comparison
│   │   ├── smmAgent.ts                 # Social content (5 archetypes)
│   │   ├── socialExtractorAgent.ts     # Browser-based social extraction (2400+ lines)
│   │   ├── seedCompetitorAgent.ts      # Seed competitor discovery
│   │   ├── trendingTopicsAgent.ts      # Industry trend discovery (multi-engine)
│   │   └── qcAgent.ts                  # Validation suite + cascading retries
│   ├── auth/
│   │   └── authStore.ts         # Session auth, project assignments
│   ├── memory/
│   │   ├── memoryStore.ts       # Dual MongoDB/local + vector KB
│   │   └── knowledgeIndex.ts    # In-memory singleton + keyword search
│   ├── qc/
│   │   └── qcAgent.ts           # QC logic (cascading retries, confidence)
│   ├── tools/
│   │   └── webTool.ts           # Priority crawl, sitemap, Selenium fallback
│   └── utils/
│       ├── llm.ts               # Multi-provider factory (OpenAI, Groq, Gemini, Tavily)
│       ├── logger.ts            # Structured logging with levels
│       ├── vectorStore.ts       # Embeddings + cosine similarity
│       ├── placesApi.ts         # Google Places API wrapper
│       ├── freeSearchEngine.ts  # Keyless search fallback
│       ├── braveSearchEngine.ts # Brave Search API
│       ├── bingRssSearchEngine.ts # Bing RSS fallback
│       ├── tavilyClient.ts      # Tavily quota management
│       ├── socialVerificationUtils.ts # Social handle authenticity
│       ├── pdfExtractor.ts      # pdf-parse + pdftoppm OCR fallback
│       └── pdfGenerator.ts      # pdfmake report generation
```

---

## ⚙️ Configuration-Driven Behavior (`config/agentRules.ts`)

**Single source of truth** for all tunable parameters. Modify here, not in agent code.

```typescript
export const agentRules = {
  models: {
    smart: "gpt-4o",              // Complex reasoning (brand, R&D, competitive analysis)
    fast: "gpt-4o-mini",          // High-volume map phases (offerings extraction)
    vision: "gpt-4o",             // PDF OCR fallback
    embedding: "text-embedding-3-small"
  },
  cleaning: {
    noisyLabels: [...],           // UI/nav labels to strip from extracted text
    keepPatterns: [...],          // Regex to preserve despite noise
    minContentLength: 50
  },
  qc: {
    minConfidenceScore: 0.85,
    maxRetries: 3,
    requiredModules: [
      "businessIdentity", "offerings", "webIntelligence",
      "audienceIntelligence", "brandIntelligence", "digitalMaturity"
    ]
  },
  competitor: {
    minSocialAccounts: 2,
    socialActivityWindowDays: 180,
    maxPerCategory: 15
  },
  crawl: {
    maxPages: 12,
    maxBytesPerPage: 500000,
    timeoutMs: 15000,
    spaFallback: true,
    respectRobotsTxt: true
  }
}
```

---

## 🔄 Core Pipeline — 7 Phases (orchestrator.ts)

| Phase | Agent(s) | Key Output | Parallel? |
|-------|----------|------------|-----------|
| **1. Crawl** | `WebScraperAgent` → `WebTool.crawlWebsite()` | `PageSnapshot[]` | No |
| **2. Semantic Cleaning** | `SemanticCleaningAgent` | `SemanticWebData` | No |
| **3. Parallel Intel** | `WebIntelligenceAgent` + `SocialIntelligenceAgent` | `WebIntelligence`, `SocialIntelligence` | ✅ |
| **4. Identity** | `BusinessIdentityAgent` | `BusinessIdentity` | No |
| **5. Deep Extraction** | 6 agents (offerings, audience, brand, digital, R&D, marketing) | Full intelligence objects | ✅ |
| **6. AI Content** | `AiContentAgent` | Layman summaries | No |
| **7. QC + Finalize** | `QcAgent` (cascading retries ≤3) → Executive Summary + PDF + Vectors | `BusinessIntelligenceProfile` | No |

### Cascading Retry Logic
- On QC failure: re-run **ONLY failed agents** with `previousQcFeedback` context
- Max 3 attempts, exponential backoff
- Tracks `agentDiagnostics` per attempt
- Pass threshold: `confidenceScore ≥ 0.85`

### Real-Time SSE Streaming
- Endpoint: `GET /api/analyze/stream?url=...`
- Events: `phase_start`, `phase_complete`, `agent_progress`, `error`, `complete`
- Heartbeat every 15s to prevent proxy timeouts

---

## 🧠 Data Schemas (types.ts — 376 lines)

### Core Accumulator: `StructuredMemory`
```typescript
interface StructuredMemory {
  input: BusinessInput;                    // URL, socialUrls, brochureText, instructions
  scrapedPages: PageSnapshot[];            // Phase 1 output
  semanticWebData: SemanticWebData;        // Phase 2 output
  webIntelligence: WebIntelligence;        // Phase 3
  socialIntelligence: SocialIntelligence;  // Phase 3
  businessIdentity: BusinessIdentity;      // Phase 4
  offerings: OfferingsIntelligence;        // Phase 5
  audience: AudienceIntelligence;          // Phase 5
  brandPositioning: BrandIntelligence;     // Phase 5
  digitalMaturity: DigitalMaturity;        // Phase 5
  rdInsights: RdInsights;                  // Phase 5
  marketingSales: MarketingSalesIntelligence; // Phase 5
  aiContent: AiContent;                    // Phase 6
  qcReport: QcReport;                      // Phase 7
  executiveSummary: string;                // Phase 7
  pdfReport: string | null;                // Phase 7
  vectorKnowledgeBase: any[];              // Phase 7
  competitors: CompetitorProfile[];        // Separate pipeline
  ownSocials: ProjectSocials;              // ProjectSocialAgent
  brandVoicePattern: BrandVoicePattern;    // ProjectSocialAgent
  sourceMap: Record<string, string[]>;     // Provenance tracking
  rejectedCompetitors: string[];           // CompetitorAgent discards
  seedCompetitorUrls?: string[];           // User-provided seeds
}
```

### Key Sub-Interfaces
- **ProductDetailed**: `name, category, description, keyFeatures[], technicalSpecs{}, useCases[], exportMarkets[], subProducts[], aiLaymanSummary`
- **CompetitorProfile**: `name, url, type(local/regional/global), socials{}, products[], commonProducts[], whyCompetitor, evidenceUrls[]`
- **QcReport**: `passed, attempts, issues[{module, field, severity, message}], confidenceScore (0-1)`

---

## 🤖 Agent Registry — All 20+ Agents

```typescript
// agents/agentRegistry.ts
export const agents = {
  // Phase 1-2
  webScraper: new WebScraperAgent(),
  semanticCleaning: new SemanticCleaningAgent(),
  
  // Phase 3
  webIntelligence: new WebIntelligenceAgent(),
  socialIntelligence: new SocialIntelligenceAgent(),
  
  // Phase 4
  businessIdentity: new BusinessIdentityAgent(),
  
  // Phase 5 (Parallel)
  offeringsExtraction: new OfferingsExtractionAgent(),
  audienceIntelligence: new AudienceIntelligenceAgent(),
  brandIntelligence: new BrandIntelligenceAgent(),
  digitalMaturity: new DigitalMaturityAgent(),
  rdInsight: new RdInsightAgent(),
  marketingSales: new MarketingSalesAgent(),
  
  // Phase 6
  aiContent: new AiContentAgent(),
  
  // Phase 7
  qc: new QcAgent(),
  
  // Auxiliary
  competitor: new CompetitorAgent(),
  competitiveAnalysis: new CompetitiveAnalysisAgent(),
  seo: new SeoAgent(),
  smm: new SmmAgent(),
  socialExtractor: new SocialExtractorAgent(),
  seedCompetitor: new SeedCompetitorAgent(),
  trendingTopics: new TrendingTopicsAgent(),
};
```

---

## 🔑 LLM Integration (utils/llm.ts)

### `createChatModel()` Factory
```typescript
// Provider selection by model prefix:
"gpt-"       → ChatOpenAI (OpenAI)
"gemini-"    → ChatGoogleGenerativeAI
"groq-"      → ChatGroq
"tavily-"    → TavilySearchResults (tool, not chat)

// Model aliases from agentRules.ts:
smart: "gpt-4o"           // Complex reasoning
fast: "gpt-4o-mini"       // High-volume map phases
vision: "gpt-4o"          // PDF OCR fallback
embedding: "text-embedding-3-small"  // Vector embeddings
```

### Resilient Groq Fetch (utils/llm.ts:70-194)
- **Per-model quota tracking** with `modelExhaustedUntil` timestamps
- **OTPM/TPD handling**: Rolling cooldown vs hard daily latch
- **Key rotation**: Multiple Groq API keys with automatic failover
- **Qwen special case**: Enforces 250 max_tokens (Groq limit)

### Structured Output
- All extraction agents use `.withStructuredOutput(zodSchema)`
- Zod schemas mirror TypeScript interfaces exactly

---

## 💾 Persistence Layer

### Triple Persistence Strategy
1. **MongoDB** (primary, when `MONGODB_URI` set) — `memoryStore.ts:50-120`
2. **Local JSON** (fallback, always) — `data/memory/{key}.json` with atomic write
3. **GitHub Auto-sync** — Via deployment pipeline (see PROJECT_CONTEXT.md)

### Vector Knowledge Base
- `utils/vectorStore.ts`: OpenAI `text-embedding-3-small` (1536-dim) or local FNV-1a fallback (256-dim)
- `cosineSimilarity()` for semantic search
- Batch embedding with rate limiting

### Knowledge Index (In-Memory)
- `memory/knowledgeIndex.ts`: Singleton `KnowledgeIndex` with keyword search
- Auto-populated on memory load, used for fast RAG lookups

---

## 🕷️ Web Scraping Stack (tools/webTool.ts)

### Crawl Strategy
1. **Sitemap Discovery** → Parse XML sitemap for URLs
2. **Priority Queue** → Homepage → About → Product/Service → Contact → Blog (deprioritized)
3. **Cheerio (Static)** → Fast HTML parsing: title, headings, links, contentText, JSON-LD, emails, phones
4. **Selenium Fallback** → For SPAs (detected via low text/content ratio)
   - Headless Chromium with `--disable-blink-features=AutomationControlled`
   - Waits for network idle, scrolls for lazy content
5. **Page Classification** → Heuristic: URL path + heading keywords → pageType

### Host vs. Container Headless Browser Requirements
**CRITICAL:** Environment expectations for Selenium & Puppeteer differ between local dev and Docker:

| Environment | Chrome/Chromium Path | Setup |
|-------------|---------------------|-------|
| **Docker (Production)** | `/usr/bin/chromium` + `chromium-driver` | Installed in `Dockerfile` with symlink `chromium → google-chrome` for Puppeteer compatibility |
| **Local Dev (`npm run dev`)** | Host machine `PATH` | Must have **Google Chrome** or **Chromium** installed and accessible on `PATH` |

**Browser Lifecycle Rule (MANDATORY):**
- Every browser instance spawned for SPA fallback OR social scraping **MUST** be wrapped in `try/finally` with explicit `.quit()` (Selenium) / `.close()` (Puppeteer)
- Prevents zombie Chromium processes from leaking RAM on host or in containers

**Required Chrome Flags (ALWAYS):**
```typescript
[
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled'
]
```

---

## 📊 Key Algorithms

### CompetitorAgent — Multi-Stage Verification (1492 lines)
```
1. URL/domain filtering (BLOCKED_DOMAINS: 90+ entries)
2. Informational content rejection (blog/wiki/directory patterns)
3. Manufacturer vs Dealer detection (keyword scoring)
4. Industry keyword matching (combinedIndKws from target + offerings)
5. Foreign industry marker rejection (fitness, healthcare, jewelry, craft, media)
6. LLM Candidate Gate (Zod structured output, 5s timeout + fallback)
7. Deep product overlap scanning (≥50% token match)
8. Social link extraction (HTML + JSON-LD sameAs) with platform-provider filtering
9. Social verification (HTTP HEAD + content check)
10. Social activity evaluation (YouTube API, Instagram/LinkedIn/Facebook scraping)
```

### OfferingsExtractionAgent — Map-Reduce
```
Map: Per-page LLM extraction (gpt-4o-mini) with structured schema
   ↓
Master Taxonomy Generation: Consolidate all page-level products
   ↓
Live Engineering Research: Web search for technical specs per product
   ↓
Reduce: Deep merge (by name) preserving max detail across pages
   ↓
Output: ProductDetailed[] with specs, useCases, exportMarkets, subProducts[]
```

### BusinessIdentityAgent — Multi-Priority Name Resolution
1. JSON-LD Organization/name
2. Logo alt/title text
3. About page H1
4. Homepage H1
5. Meta title
6. Social profile names
7. Domain heuristic

### DigitalMaturityAgent — Scoring Algorithm
```
websiteQuality (45%): SSL, mobile viewport, page speed signals, structured data, accessibility
seoReadiness (35%): meta tags, headings hierarchy, schema.org, sitemap, robots.txt
socialActivity (20%): profile completeness, post frequency, engagement signals
```

---

## 🌐 Express Server (server.ts:2652 lines)

### Key Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/analyze/stream` | SSE streaming analysis (main pipeline) |
| POST | `/api/analyze` | Non-streaming analysis |
| GET | `/api/status/:jobId` | Poll job status |
| POST | `/api/competitors/discover` | CompetitorAgent discovery |
| POST | `/api/competitors/analyze` | CompetitiveAnalysisAgent gap analysis |
| POST | `/api/seo/analyze` | Deep SEO analysis |
| POST | `/api/smm/generate` | Social media content generation |
| GET | `/api/memory/:key` | Load saved memory |
| POST | `/api/memory/:key` | Save memory |
| POST | `/api/auth/login` | Session authentication |
| GET | `/api/projects` | List user projects |

### Middleware Stack
- `helmet()` — CSP, HSTS, X-Frame-Options, Referrer-Policy
- `cors()` — Configurable origins
- `express.json({limit: '10mb'})` — Body parsing
- `rateLimit({windowMs: 15min, max: 100})` — API rate limiting
- `authMiddleware` — Session validation (except public endpoints)

### Authentication (auth/authStore.ts)
- Session-based with HTTP-only cookies
- Project-scoped access control
- Bcrypt password hashing

---

## 🐳 Docker & Deployment

```dockerfile
# Dockerfile
FROM node:20-bookworm-slim
# Installs: chromium, chromium-driver, poppler-utils, fonts-liberation
# Symlinks chromium → google-chrome for Puppeteer compatibility
# Builds TS, exposes 3000, runs with --max-old-space-size=350
```

### Strict 350MB Node.js Memory Budget (Production Constraint)

**Memory Ceiling:** Production runs with `--max-old-space-size=350` and `--expose-gc` (constrained to ~350MB RAM for cost-effective deployment on Render/containers).

**OOM Prevention Rules (MANDATORY for all agents & utilities):**
- **Avoid buffering** full HTML pages, massive PDF binaries, or raw screenshots simultaneously in memory
- **When crawling large sites or parsing deep sitemaps:** Use streaming, batched processing (e.g., `p-limit`), and explicit pruning of `PageSnapshot` text content after extraction
- **After heavy map-reduce phases** (Offerings Extraction, PDF generation, Competitive Analysis): Explicitly trigger manual garbage collection:
  ```typescript
  if (global.gc) global.gc();
  ```
  before passing data to the next phase
- **Vector embeddings:** Batch with rate limiting (see `utils/vectorStore.ts`) — never embed thousands of texts in one loop

### Environment Variables (.env)
```
TAVILY_API_KEY=
GOOGLE_GEMINI_API_KEY=
OPENAI_API_KEY=
GROQ_API_KEY=
APIFY_API_TOKEN=
YOUTUBE_API_KEY=
GITHUB_TOKEN=
GOOGLE_MAPS_API_KEY=
BRAVE_SEARCH_API_KEY=
MONGODB_URI=              # Optional; enables MongoDB persistence
```

---

## 🧪 Testing & Debugging

### CLI Test Harness (runAgent.ts)
```bash
# Usage: npx tsx runAgent.ts <websiteUrl> [scope] [maxResults]
# Example: npx tsx runAgent.ts "https://example.com" regional 10
```
- Runs CompetitorAgent + CompetitiveAnalysisAgent end-to-end
- Outputs competitive gap analysis markdown to console
- Useful for debugging competitor pipeline independently

### Manual Pipeline Test
```bash
npm run build && npm start
# Then: curl -N "http://localhost:3000/api/analyze/stream?url=https://example.com"
```

---

## 🎯 Modification Cheatsheet

### Add a New Agent
1. Create `src/agents/newAgent.ts` implementing standard interface
2. Add to `agentRegistry.ts` factory
3. Wire into `orchestrator.ts` at appropriate phase
4. Add Zod schema to `types.ts` if new output type
5. Add config to `agentRules.ts` if tunable

### Change LLM Model for an Agent
→ Edit `agentRules.ts` models section (smart/fast/vision/embedding)

### Adjust QC Thresholds
→ Edit `agentRules.ts` qc section (minConfidenceScore, maxRetries, requiredModules)

### Modify Crawl Behavior
→ Edit `agentRules.ts` crawl section (maxPages, timeoutMs, spaFallback)

### Add Blocked Domain for Competitors
→ Add to `BLOCKED_DOMAINS` array in `competitorAgent.ts:63-90`

### Add Foreign Industry Marker
→ Add to `FOREIGN_INDUSTRY_MARKERS` in `competitorAgent.ts:48-61`

### Change Social Requirements
→ Edit `MIN_SOCIAL_ACCOUNTS`, `SOCIAL_ACTIVITY_WINDOW_DAYS` in `competitorAgent.ts:41-43`

---

## 📝 Coding Conventions

### TypeScript
- **Strict mode** enabled (tsconfig.json)
- **Zod schemas** for all LLM structured outputs
- **Interfaces** over types for object shapes
- **Explicit return types** on public methods

### Agent Pattern
```typescript
export class NewAgent {
  readonly name = "new-agent";
  readonly version = "1.0.0";
  
  async run(input: InputType, context?: ContextType): Promise<OutputType> {
    const logger = createLogger("NewAgent");
    logger.info(`Running NewAgent...`);
    // ... implementation
    return output;
  }
}
```

### Logging
```typescript
import { createLogger } from "../utils/logger.js";
const logger = createLogger("AgentName");
logger.debug("detail"); logger.info("progress"); logger.warn("issue"); logger.error("failure");
```

### Error Handling
- Wrap external calls in try/catch
- Return `null` or empty array on failure (never throw in agents)
- Log at appropriate level with context

### Async Patterns
- Use `Promise.all` for parallel independent work
- Use `Promise.race` with timeout for external APIs
- Avoid `for await` unless sequential dependency exists

### Memory Budget Compliance (350MB Cap)
- **Never** hold full HTML, PDF buffers, or screenshot arrays in memory simultaneously
- **Stream/Chunk** large sitemaps and page batches (use `p-limit` or similar concurrency control)
- **Prune `PageSnapshot.contentText`** after semantic cleaning — keep only structured fields
- **Call `if (global.gc) global.gc()`** after map-reduce phases (Offerings Extraction, Competitive Analysis, PDF generation)
- **Batch embeddings** with `utils/vectorStore.ts` helpers — never loop thousands of `generateEmbedding()` calls

---

## 🔍 Known Issues (from PROJECT_CONTEXT.md + Code Review)

| Issue | Location | Severity | Fix Approach |
|-------|----------|----------|--------------|
| Dead code: `webScraperAgent_v13.ts` | agents/ | Low | Delete file |
| Duplicate `knowledgeIndex.add()` calls | orchestrator.ts:106-107 | Medium | Remove duplicate |
| Failover logging discrepancy | webTool.ts | Low | Unify log messages |
| Query param inconsistency: `site` vs `url` | server.ts routes | Medium | Standardize to `url` |
| Scraper double execution risk | orchestrator + server | Medium | Add guard flag |
| MongoDB/local sync not transactional | memoryStore.ts | High | Add transaction or reconciliation |
| Chromium pathing in Docker (symlinks) | Dockerfile | Low | Verify at build time |
| No structured logging correlation IDs | logger.ts | Medium | Add requestId propagation |
| Rate limiting not per-user | server.ts | Medium | Key by session/user |

---

## 🚀 Quick Start for New Instances

```bash
# 1. Install dependencies
npm install

# 2. Configure .env with API keys (required: TAVILY_API_KEY, OPENAI_API_KEY or GROQ_API_KEY)

# 3. Build
npm run build

# 4. Run server
npm start

# 5. Test SSE endpoint
curl -N "http://localhost:3000/api/analyze/stream?url=https://example.com"
```

---

## 📚 Reference Files

- **PROJECT_CONTEXT.md** — Extended architecture docs, data flows, conventions
- **config/agentRules.ts** — All tunable parameters
- **src/types.ts** — Complete type definitions
- **src/orchestrator.ts** — Pipeline logic
- **src/agents/agentRegistry.ts** — Agent instantiation
- **src/utils/llm.ts** — LLM factory + Groq resilience logic

---

*Generated during architectural audit. Update this file when making structural changes.*