import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { ZodError } from "zod";
import multer from "multer";
import { QcFailureError } from "./errors.js";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

const execFileAsync = promisify(execFile);
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
import { ProjectSocialAgent } from "./agents/projectSocialAgent.js";
import { AuthStore, type AuthUser } from "./auth/authStore.js";

import helmet from "helmet";
import rateLimit from "express-rate-limit";

const logger = createLogger("Server");

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Apply security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://connect.facebook.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      mediaSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      frameSrc: [
        "'self'",
        "https://www.youtube.com",
        "https://youtube.com",
        "https://www.facebook.com",
        "https://*.facebook.com",
        "https://web.facebook.com",
        "https://m.facebook.com",
        "https://*.fbcdn.net",
        "https://fb.watch",
        "https://www.linkedin.com",
        "https://*.linkedin.com",
        "https://www.instagram.com",
        "https://*.instagram.com"
      ],
      connectSrc: ["'self'", "https:"]
    }
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting to protect against DoS attacks & bot spamming
// Authenticated dashboard requests (with session token) bypass rate limits
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => Boolean(req.headers.authorization || req.query.token),
  message: { error: "Too many requests from this IP, please try again later." }
});

const intelligenceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => Boolean(req.headers.authorization || req.query.token),
  message: { error: "Analysis run limit reached for this IP. Please wait a few minutes." }
});

// Brute-force protection for login endpoint (50 attempts per 15 min per IP, skipping successful logins)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many failed login attempts from this IP. Locked for 15 minutes for security." }
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
const projectSocialAgent = new ProjectSocialAgent();
const memoryStore = new MemoryStore();
const authStore = new AuthStore();
const port = Number(process.env.PORT ?? 3000);

// A second click (or a reconnecting browser) must not start another set of
// Chrome sessions for the same project while its tracker is already running.
const activeTrackerRuns = new Map<string, Promise<void>>();
const runTrackerOnce = async (site: any): Promise<void> => {
  const key = String(site.input?.websiteUrl || '').trim().toLowerCase();
  const current = activeTrackerRuns.get(key);
  if (current) {
    logger.info(`Daily tracker already running for ${site.input.websiteUrl}; joining the active run.`);
    return current;
  }

  const run = (async () => {
    await cronAgent.run(site, memoryStore);
    knowledgeIndex.add(site);
  })();
  activeTrackerRuns.set(key, run);
  try {
    await run;
  } finally {
    if (activeTrackerRuns.get(key) === run) activeTrackerRuns.delete(key);
  }
};

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB file upload limit
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));
// Serve plain JS assets from src/static/ at /static/
const staticPath = __dirname.endsWith("dist") 
  ? join(__dirname, "..", "src", "static")
  : join(__dirname, "static");
app.use("/static", express.static(staticPath, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}));

// ---------------------------------------------------------------------------
// Authentication & SaaS Admin Projects APIs
// ---------------------------------------------------------------------------

const getToken = (request: express.Request): string | undefined => {
  const bearer = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || (typeof request.query.token === "string" ? request.query.token : undefined);
};
const authenticateRequest = async (request: express.Request): Promise<AuthUser | null> => authStore.getSession(getToken(request));

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const session = await authStore.authenticate(String(username || ""), String(password || ""));
  if (!session) return res.status(401).json({ success: false, error: "Invalid username or password." });
  return res.json({ success: true, ...session });
});

app.get("/api/auth/status", async (req, res) => {
  const user = await authenticateRequest(req);
  return res.json(user ? { authenticated: true, user } : { authenticated: false });
});

app.post("/api/auth/logout", (req, res) => {
  authStore.revoke(getToken(req));
  return res.json({ success: true });
});

const requireAuth: express.RequestHandler = async (req, res, next) => {
  const user = await authenticateRequest(req);
  if (!user) return res.status(401).json({ error: "Authentication required." });
  (req as express.Request & { currentUser?: AuthUser }).currentUser = user;
  next();
};
const requireAdmin: express.RequestHandler = (req, res, next) => {
  const user = (req as express.Request & { currentUser?: AuthUser }).currentUser;
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
};

const hasProjectAccess = async (user?: AuthUser, projectUrl?: string): Promise<boolean> => {
  if (!user || !projectUrl) return false;
  if (user.role === "admin") return true;
  const assigned = await authStore.assignedProjects(user.username);
  const normalize = (u: string) => (u || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  const targetNorm = normalize(projectUrl);
  return assigned.some(a => normalize(a) === targetNorm);
};

app.get("/api/admin/users", requireAuth, requireAdmin, async (_req, res) => res.json({ users: await authStore.listUsers() }));
app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const role = req.body?.role === "admin" ? "admin" : "user";
    const user = await authStore.createUser(String(req.body?.username || ""), String(req.body?.password || ""), role);
    return res.status(201).json({ success: true, user });
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
});
app.delete("/api/admin/users/:username", requireAuth, requireAdmin, async (req, res) => {
  try {
    const deleted = await authStore.deleteUser(req.params.username);
    return deleted ? res.json({ success: true }) : res.status(404).json({ error: "User not found." });
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
});
app.put("/api/admin/users/:username/projects", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectUrl = String(req.body?.projectUrl || "").trim();
    if (!projectUrl || !(await memoryStore.loadBySite(projectUrl))) return res.status(404).json({ error: "Project not found." });
    await authStore.assignProject(req.params.username, projectUrl);
    return res.json({ success: true });
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
});
app.delete("/api/admin/users/:username/projects", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectUrl = String(req.query.projectUrl || "").trim();
    if (!projectUrl) return res.status(400).json({ error: "Project URL is required." });
    await authStore.unassignProject(req.params.username, projectUrl);
    return res.json({ success: true });
  } catch (error: any) { return res.status(400).json({ error: error.message }); }
});

app.put("/api/admin/projects/assignments", requireAuth, requireAdmin, async (req, res) => {
  try {
    const projectUrl = String(req.body?.projectUrl || "").trim();
    const rawUsernames = req.body?.usernames;
    const usernames: string[] = Array.isArray(rawUsernames)
      ? rawUsernames.map((u: any) => String(u).trim()).filter(Boolean)
      : (req.body?.username ? [String(req.body.username).trim()] : []);

    if (!projectUrl || !(await memoryStore.loadBySite(projectUrl))) {
      return res.status(404).json({ error: "Project not found." });
    }
    if (usernames.length === 0) {
      return res.status(400).json({ error: "At least one username is required." });
    }

    await authStore.assignProjectToUsers(usernames, projectUrl);
    return res.json({ success: true, count: usernames.length });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
});

app.delete("/api/admin/projects", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rawUrl = String(req.query.url || req.body?.url || req.body?.projectUrl || "").trim();
    if (!rawUrl) return res.status(400).json({ error: "Missing project url parameter." });

    const deleted = await memoryStore.deleteBySite(rawUrl);
    await authStore.removeProjectFromAssignments(rawUrl);
    knowledgeIndex.remove(rawUrl);

    logger.success(`Project ${rawUrl} and all related data deleted by administrator.`);
    return res.json({
      success: true,
      deleted: true,
      url: rawUrl,
      message: "Project and all associated data deleted successfully."
    });
  } catch (error: any) {
    logger.error(`Failed to delete project: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
});

// All application data and actions require an authenticated session. Auth
// endpoints above and static assets stay public so users can reach the login page.
app.use("/api", (req, res, next) => {
  // Browser media elements cannot attach Authorization headers. These routes
  // expose only the already-validated remote asset proxy, not workspace data.
  if (req.path === "/proxy-media" || req.path === "/proxy-video" || req.path === "/linkedin-embed-player" || req.path === "/facebook-embed-player" || req.path === "/instagram-embed") return next();
  return requireAuth(req, res, next);
});
app.use("/memory", requireAuth);
app.use("/business-intelligence", requireAuth);

app.get("/api/projects", async (req, res) => {
  try {
    const onDisk = await memoryStore.loadAll();
    const user = (req as express.Request & { currentUser?: AuthUser }).currentUser;
    const assignedUrls = new Set(user ? await authStore.assignedProjects(user.username) : []);
    const assignmentsMap = user?.role === "admin" ? authStore.getProjectAssignmentsMap() : null;
    const normalize = (u: string) => (u || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    const assignedNorms = new Set(Array.from(assignedUrls).map(normalize));
    const isAdmin = user?.role === "admin";

    const allProjectsList = onDisk.map(m => {
      const urlNorm = normalize(m.input.websiteUrl);
      const isAssigned = assignedUrls.has(m.input.websiteUrl) || assignedNorms.has(urlNorm);
      return {
        id: Buffer.from(m.input.websiteUrl).toString('base64').replace(/=/g, ''),
        url: m.input.websiteUrl,
        name: m.businessIdentity?.officialName || m.input.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        industry: m.businessIdentity?.industry || "Business Intelligence",
        competitorCount: m.competitors?.length || 0,
        postCount: m.socialFeed?.length || 0,
        lastAnalyzed: "Active Intelligence",
        assigned: isAssigned,
        ...(isAdmin ? { assignedTo: (assignmentsMap?.get(urlNorm) || []).sort((a, b) => a.localeCompare(b)) } : {})
      };
    });

    const userProjects = allProjectsList.filter(p => p.assigned);

    if (!isAdmin) {
      // Non-admin users ONLY receive their assigned projects
      return res.json({
        userProjects,
        allProjects: userProjects
      });
    }

    allProjectsList.sort((a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name));

    res.json({
      userProjects,
      allProjects: allProjectsList
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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
    const lower = (rawUrl || "").toLowerCase();
    let platform = "Social Post";
    let icon = "🌐";
    let gradStart = "#1e293b";
    let gradEnd = "#0f172a";

    if (lower.includes("instagram")) {
        platform = "Instagram";
        icon = "📸";
        gradStart = "#833ab4";
        gradEnd = "#fd1d1d";
    } else if (lower.includes("facebook") || lower.includes("fbcdn") || lower.includes("fbsbx")) {
        platform = "Facebook";
        icon = "📘";
        gradStart = "#1877f2";
        gradEnd = "#0d47a1";
    } else if (lower.includes("linkedin") || lower.includes("licdn")) {
        platform = "LinkedIn";
        icon = "💼";
        gradStart = "#0077b5";
        gradEnd = "#004182";
    } else if (lower.includes("youtube") || lower.includes("ytimg")) {
        platform = "YouTube";
        icon = "▶️";
        gradStart = "#cc0000";
        gradEnd = "#660000";
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340">
      <defs>
        <linearGradient id="g_${Math.abs(rawUrl.length % 1000)}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${gradStart}"/>
          <stop offset="100%" stop-color="${gradEnd}"/>
        </linearGradient>
      </defs>
      <rect width="600" height="340" fill="url(#g_${Math.abs(rawUrl.length % 1000)})"/>
      <rect width="600" height="340" fill="rgba(0,0,0,0.25)"/>
      <circle cx="300" cy="135" r="46" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.35)" stroke-width="2"/>
      <text x="300" y="148" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="34" text-anchor="middle" fill="#ffffff">${icon}</text>
      <text x="300" y="220" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#ffffff" letter-spacing="1">${platform.toUpperCase()}</text>
      <text x="300" y="250" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="500" text-anchor="middle" fill="rgba(255,255,255,0.78)">Public Competitor Update</text>
    </svg>`;

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(svg);
};

const handleProxyMedia = async (req: express.Request, res: express.Response) => {
    let rawUrl = (req.query.url as string || '').trim();
    if (!rawUrl) return res.status(400).send('Missing url parameter');

    // Handle comma-separated URLs or array-stringified URLs
    if (rawUrl.includes(',')) {
        const parts = rawUrl.split(',').map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
            if (p.startsWith('http://') || p.startsWith('https://')) {
                rawUrl = p;
                break;
            }
        }
    }

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
        let targetUrl = rawUrl.replace(/\\u00253D/gi, '%3D').replace(/\\u0025/g, '%');
        const lowerRaw = targetUrl.toLowerCase();

        // 1. If targetUrl is a YouTube URL/ID, automatically resolve to YouTube image thumbnail
        const ytMatch = targetUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|shorts\/)([^"&?\/\s]{11})/i);
        if (ytMatch && ytMatch[1]) {
            targetUrl = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
        }

        const lowerTarget = targetUrl.toLowerCase();
        const isDirectMedia = lowerTarget.includes('.jpg') || lowerTarget.includes('.jpeg') ||
                              lowerTarget.includes('.png') || lowerTarget.includes('.webp') ||
                              lowerTarget.includes('.gif') || lowerTarget.includes('.mp4') ||
                              lowerTarget.includes('scontent') || lowerTarget.includes('fbcdn') ||
                              lowerTarget.includes('fbsbx') || lowerTarget.includes('licdn') ||
                              lowerTarget.includes('cdninstagram') || lowerTarget.includes('img.youtube.com') ||
                              lowerTarget.includes('googleusercontent') || lowerTarget.includes('lookaside') ||
                              lowerTarget.includes('ytimg') || lowerTarget.includes('unsplash.com');

        // If targetUrl is an HTML webpage rather than a direct image/media file, immediately serve the fast SVG placeholder
        // to avoid blocking the server with hanging external webpage scrapes.
        if (!isDirectMedia && !lowerTarget.includes('.mp4')) {
            return sendPlatformSvgPlaceholder(res, rawUrl);
        }

        let ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        let referer = '';

        if (lowerTarget.includes('lookaside.fbsbx.com')) {
            ua = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
            referer = '';
        } else if (lowerTarget.includes('facebook.com/')) {
            ua = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
            referer = '';
        } else if (lowerTarget.includes('instagram') || lowerTarget.includes('cdninstagram')) {
            referer = '';
        } else if (lowerTarget.includes('fbcdn')) {
            referer = '';
        } else if (lowerTarget.includes('linkedin') || lowerTarget.includes('licdn')) {
            referer = 'https://www.linkedin.com/';
        } else {
            referer = 'https://www.google.com/';
        }

        const isVideoReq = lowerTarget.match(/\.(mp4|webm|ogg)(\?|$)/i) || lowerTarget.includes('/playlist/vid/') || lowerTarget.includes('video.licdn.com');
        const headers: Record<string, string> = {
            'User-Agent': ua,
            'Accept': isVideoReq ? 'video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8' : 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            ...(referer ? { 'Referer': referer } : {})
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

        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('text/html') && !isVideoReq) {
            logger.warn(`[Proxy-Media] Target URL ${targetUrl} returned HTML content-type instead of image, redirecting.`);
            if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
                return res.redirect(302, rawUrl);
            }
            return sendPlatformSvgPlaceholder(res, rawUrl);
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', String(response.headers['content-type']));
        }
        if (response.headers['accept-ranges']) {
            res.setHeader('Accept-Ranges', String(response.headers['accept-ranges']));
        }
        if (response.headers['content-range']) {
            res.setHeader('Content-Range', String(response.headers['content-range']));
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', String(response.headers['content-length']));
        }

        res.status(response.status);
        response.data.pipe(res);
    } catch (error: any) {
        logger.warn(`[Proxy-Media] Direct stream failed for ${rawUrl}: ${error.message}`);
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
            return res.redirect(302, rawUrl);
        }
        return sendPlatformSvgPlaceholder(res, rawUrl);
    }
};

app.get('/api/proxy-media', handleProxyMedia);
app.get('/api/proxy-video', handleProxyMedia);

app.get('/api/social-video-url', async (req, res) => {
    const rawPostUrl = (req.query.url as string || '').trim();
    if (!rawPostUrl || (!rawPostUrl.startsWith('http://') && !rawPostUrl.startsWith('https://'))) {
        return res.status(400).json({ success: false, error: 'Valid url query parameter required' });
    }

    try {
        const fetchRes = await axios.get(rawPostUrl, {
            headers: {
                'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 7000
        });

        const html = fetchRes.data || '';
        const regex = /https:[\\/]+[a-zA-Z0-9._-]+(?:fbcdn\.net|fbsbx\.com)[\\/]+[^\s"']+\.mp4[^\s"']*/g;
        const matches = html.match(regex) || [];
        if (matches.length > 0) {
            let clean = matches[0].replace(/\\\/|\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
            clean = clean.split('<')[0].split('\\')[0].split('"')[0];
            return res.json({ success: true, videoUrl: clean });
        }

        return res.json({ success: false, message: 'No direct video stream found' });
    } catch (e: any) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/linkedin-embed-player', async (req, res) => {
    const actId = req.query.id as string;
    if (!actId) return res.status(400).send('Activity ID required');

    try {
        const embedUrl = `https://www.linkedin.com/embed/feed/update/urn:li:activity:${actId}`;
        const embedRes = await axios.get(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 7000
        });

        const rawHtml = embedRes.data || '';
        const $ = cheerio.load(rawHtml);
        const rawSources = $('video').attr('data-sources');

        if (rawSources) {
            try {
                const parsed = JSON.parse(rawSources);
                const best = parsed.find((s: any) => s.src && s.src.includes('720p')) || parsed.find((s: any) => s.src && s.src.includes('480p')) || parsed[0];
                if (best && best.src) {
                    const videoSrc = `/api/proxy-media?url=${encodeURIComponent(best.src)}`;
                    const videoPoster = $('video').attr('poster') || '';
                    const posterAttr = videoPoster ? `poster="/api/proxy-media?url=${encodeURIComponent(videoPoster)}"` : '';
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, html { margin: 0 !important; padding: 0 !important; width: 100vw !important; height: 100vh !important; background: #000 !important; overflow: hidden !important; display: flex !important; align-items: center !important; justify-content: center !important; }
    video { width: 100vw !important; height: 100vh !important; max-width: 100vw !important; max-height: 100vh !important; object-fit: contain !important; margin: 0 !important; background: #000 !important; }
  </style>
</head>
<body>
  <video src="${videoSrc}" ${posterAttr} controls autoplay playsinline preload="auto"></video>
</body>
</html>`);
                }
            } catch (err: any) {
                logger.warn(`[LinkedIn-Player] Failed to parse video data-sources for ${actId}: ${err.message}`);
            }
        }

        // Clean responsive embed fallback for image/text posts
        const customStyle = `
        <style>
          body, html { margin: 0 !important; padding: 0 !important; width: 100% !important; min-height: 100% !important; background: #080d1a !important; color: #fff !important; }
          article { border: none !important; margin: 0 auto !important; background: #080d1a !important; color: #fff !important; }
          .base-main-feed-card { background: #080d1a !important; color: #fff !important; }
          .feed-shared-text, p, span, h1, h2, h3, h4 { color: #f1f5f9 !important; }
          img { max-width: 100% !important; height: auto !important; border-radius: 8px !important; }
        </style>
        `;

        let html = rawHtml.replace('</head>', `${customStyle}</head>`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (e: any) {
        logger.warn(`[LinkedIn-Player] Failed to load embed HTML for ${actId}: ${e.message}`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html>
<html>
<head><style>body { background: #031224; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }</style></head>
<body>
  <div style="font-size: 48px; margin-bottom: 16px;">💼</div>
  <h3 style="margin: 0 0 16px 0;">Official LinkedIn Update</h3>
  <a href="https://www.linkedin.com/feed/update/urn:li:activity:${actId}" target="_blank" style="background: #0a66c2; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">View on LinkedIn ↗</a>
</body>
</html>`);
    }
});

app.get('/api/facebook-embed-player', (req, res) => {
    const rawVidId = req.query.id as string;
    const postUrl = req.query.url as string || '';
    let vidId = rawVidId;
    if (!vidId && postUrl) {
        const m = postUrl.match(/(?:\/videos\/(?:[^\/]+\/)?|\/reel\/|\/watch\/?\?v=)(\d+)/) || postUrl.match(/(\d{10,20})/);
        if (m) vidId = m[1];
    }

    if (!vidId && !postUrl) return res.status(400).send('Facebook Video ID or URL required');

    const canonicalUrl = vidId ? `https://www.facebook.com/watch/?v=${vidId}` : postUrl;
    const pluginUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonicalUrl)}&show_text=false&width=500`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body, html { margin: 0 !important; padding: 0 !important; width: 100vw !important; height: 100vh !important; background: #000 !important; overflow: hidden !important; display: flex !important; align-items: center !important; justify-content: center !important; }
    iframe { width: 100vw !important; height: 100vh !important; border: 0 !important; background: #000 !important; }
  </style>
</head>
<body>
  <iframe src="${pluginUrl}" frameborder="0" scrolling="no" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowfullscreen></iframe>
</body>
</html>`);
});

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
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  request.socket.setTimeout(0);
  if (typeof (response as any).flushHeaders === "function") {
    (response as any).flushHeaders();
  }

  // Send immediate connected event so browser and reverse proxy know the stream is active
  response.write(`data: ${JSON.stringify({ type: 'progress', step: "Initializing analysis..." })}\n\n`);

  // Periodic heartbeat every 8 seconds prevents reverse proxy (Render/Cloudflare) timeouts
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      try {
        response.write(`: keepalive\n\n`);
      } catch (_) {}
    }
  }, 8000);

  request.on("close", () => {
    clearInterval(heartbeat);
  });

  const url = request.body.websiteUrl as string;
  const socialUrls = (request.body.socialUrls as string || "").split(",").map(s => s.trim()).filter(Boolean);
  const customInstructions = request.body.customInstructions as string | undefined;
  
  if (!url) {
    clearInterval(heartbeat);
    response.write(`data: ${JSON.stringify({ type: 'error', error: "Website URL is required" })}\n\n`);
    response.end();
    return;
  }
  const finalUrl = url;

  try {
    let brochureText: string | undefined = undefined;
    if (request.file) {
      // Magic-byte check for PDF (%PDF- header signature)
      const buf = request.file.buffer;
      const isPdfMagic = buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
      if (!isPdfMagic) {
        clearInterval(heartbeat);
        logger.warn(`[Security Alert] Rejected uploaded file: invalid PDF magic header.`);
        response.write(`data: ${JSON.stringify({ type: 'error', error: "Security Alert: Uploaded file is not a valid PDF document." })}\n\n`);
        response.end();
        return;
      }

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
          await execFileAsync("pdftoppm", ["-jpeg", tmpPdf, tmpImgPrefix]);
          
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
        const profile = await orchestrator.run(input, (stepName, partial) => {
          if (!response.writableEnded) {
            response.write(`data: ${JSON.stringify({ type: 'progress', step: stepName, partial })}\n\n`);
          }
        });
        
        if (!response.writableEnded) {
          response.write(`data: ${JSON.stringify({ type: 'complete', profile })}\n\n`);
        }
        logger.success(`✅ Pipeline execution completed successfully for ${finalUrl}`);
      } catch (err: any) {
        // Automatic Failure Protection Circuit Breaker
        if (process.env.SYSTEM_VERSION === "v13") {
          logger.error(`v13 Orchestrator crashed (${err.message}). Triggering AUTOMATIC FAILOVER to v12-stable...`);
          const fallbackOrchestrator = new OrchestratorAgent(memoryStore);
          const fallbackProfile = await fallbackOrchestrator.run(input, (stepName, partial) => {
            if (!response.writableEnded) {
              response.write(`data: ${JSON.stringify({ type: 'progress', step: `[FAILOVER] ${stepName}`, partial })}\n\n`);
            }
          });
          if (!response.writableEnded) {
            response.write(`data: ${JSON.stringify({ type: 'complete', profile: fallbackProfile })}\n\n`);
          }
          logger.success(`✅ Pipeline fallback execution completed successfully for ${finalUrl}`);
        } else {
          throw err;
        }
      }
    } catch (e: any) {
      throw e;
    }
  } catch (error: any) {
    if (!response.writableEnded) {
      if (error instanceof ZodError) {
        response.write(`data: ${JSON.stringify({ type: 'error', error: "Invalid input." })}\n\n`);
      } else if (error instanceof QcFailureError) {
        response.write(`data: ${JSON.stringify({ type: 'error', error: error.message, qc: error.qc })}\n\n`);
      } else {
        logger.error("Business intelligence stream failed:", error);
        response.write(`data: ${JSON.stringify({ type: 'error', error: error.message || "Business intelligence run failed." })}\n\n`);
      }
    }
  } finally {
    clearInterval(heartbeat);
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
    if (!response.writableEnded) {
      response.end();
    }
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

    const user = (request as express.Request & { currentUser?: AuthUser }).currentUser;
    if (!(await hasProjectAccess(user, url))) {
      return response.status(403).json({ error: "Access denied. This project is not assigned to your account." });
    }

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
    if (updates.industryClassification) {
      memory.industryClassification = { ...memory.industryClassification, ...updates.industryClassification };
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
      if (updates.offerings.valuePropositions) {
        memory.offerings.valuePropositions = updates.offerings.valuePropositions;
      }
    }
    if (updates.processes) {
      memory.processes = { ...memory.processes, ...updates.processes };
    }
    if (updates.audience) {
      memory.audience = { ...memory.audience, ...updates.audience };
    }
    if (updates.competitors !== undefined) {
      memory.competitors = updates.competitors;
    }
    if (updates.socialFeed !== undefined) {
      memory.socialFeed = updates.socialFeed;
    }
    if (updates.marketingSales) {
      memory.marketingSales = { ...memory.marketingSales, ...updates.marketingSales };
    }
    if (updates.digitalMaturity) {
      memory.digitalMaturity = { ...memory.digitalMaturity, ...updates.digitalMaturity };
    }
    if (updates.rdInsights) {
      memory.rdInsights = { ...memory.rdInsights, ...updates.rdInsights };
    }
    if (updates.rejectedCompetitors !== undefined) {
      memory.rejectedCompetitors = updates.rejectedCompetitors;
    }
    if (updates.ownSocials !== undefined) {
      memory.ownSocials = updates.ownSocials;
    }
    if (updates.ownSocialFeed !== undefined) {
      memory.ownSocialFeed = updates.ownSocialFeed;
    }
    if (updates.brandVoicePattern !== undefined) {
      memory.brandVoicePattern = updates.brandVoicePattern;
    }

    await memoryStore.save(memory);
    knowledgeIndex.add(memory); // Update the cache

    response.json({ success: true, memory });
  } catch (e: any) {
    logger.error(`Memory Update error: ${e.message}`);
    response.status(500).json({ error: e.message });
  }
});

app.delete("/api/memory", requireAuth, requireAdmin, async (request, response) => {
  try {
    const url = (request.query.url as string) || (request.body?.url as string);
    if (!url) return response.status(400).json({ error: "Missing url param" });

    const deleted = await memoryStore.deleteBySite(url);
    await authStore.removeProjectFromAssignments(url);
    knowledgeIndex.remove(url);

    response.json({
      success: true,
      deleted,
      message: "Project and all associated data deleted successfully."
    });
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
    const { websiteUrl, type, totalPosts, language, strategy, theme, subTheme, mirrorCompetitor, mirrorPost, industryFocus, customGoal, trendingTopic, targetPersona, targetPlatform } = request.body;
    if (!websiteUrl || !type || !totalPosts) {
      response.status(400).json({ error: "Missing required parameters." });
      return;
    }

    const user = (request as express.Request & { currentUser?: AuthUser }).currentUser;
    if (!(await hasProjectAccess(user, websiteUrl))) {
      return response.status(403).json({ error: "Access denied. This project is not assigned to your account." });
    }

    let memory = knowledgeIndex.get(websiteUrl);
    if (!memory) {
      memory = await memoryStore.loadBySite(websiteUrl) ?? undefined;
    }

    if (!memory) {
      response.status(404).json({ error: "No memory found for this URL. Please run the Intelligence Pipeline first." });
      return;
    }

    const posts = await smmAgent.run(memory, type as "video" | "image", Number(totalPosts), language || "English", strategy || "new", theme || "brand", subTheme, mirrorCompetitor, mirrorPost, industryFocus, customGoal, trendingTopic, targetPersona, targetPlatform);
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

    const user = (request as express.Request & { currentUser?: AuthUser }).currentUser;
    if (!(await hasProjectAccess(user, url))) {
      return response.status(403).json({ error: "Access denied. This project is not assigned to your account." });
    }

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
    const competitors = await (competitorAgentToUse as any).run(memory, scope || "all");
    
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
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  request.socket.setTimeout(0);
  response.flushHeaders();

  // Send immediate connected event so browser and reverse proxy know the stream is active
  response.write(`data: ${JSON.stringify({ type: 'progress', status: "Connected. Scanning competitor footprint..." })}\n\n`);

  // Periodic heartbeat every 4 seconds prevents reverse proxy (Render/Cloudflare) timeouts
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      response.write(`: keepalive\n\n`);
      if (typeof (response as any).flush === 'function') {
        (response as any).flush();
      }
    }
  }, 4000);

  request.on("close", () => {
    clearInterval(heartbeat);
  });

  const { websiteUrl, scope, force } = request.body;
  if (!websiteUrl) {
    clearInterval(heartbeat);
    response.write(`data: ${JSON.stringify({ type: 'error', error: "Website URL is required" })}\n\n`);
    response.end();
    return;
  }

  let memory = knowledgeIndex.get(websiteUrl);
  if (!memory) {
    memory = await memoryStore.loadBySite(websiteUrl) ?? undefined;
  }

  if (!memory) {
    clearInterval(heartbeat);
    response.write(`data: ${JSON.stringify({ type: 'error', error: "No memory found for this URL." })}\n\n`);
    response.end();
    return;
  }

  try {
    if (force) {
      memory.competitors = [];
    }

    const competitors = await competitorAgent.run(
      memory, 
      scope || "all", 
      (comp, statusMsg) => {
        if (!response.writableEnded) {
          if (comp) {
            if (!memory.competitors) memory.competitors = [];
            if (!memory.competitors.some((c: any) => c.url === comp.url)) {
              memory.competitors.push(comp);
              knowledgeIndex.add(memory);
            }
            response.write(`data: ${JSON.stringify({ type: 'competitor', competitor: comp, status: statusMsg })}\n\n`);
          } else {
            response.write(`data: ${JSON.stringify({ type: 'progress', status: statusMsg })}\n\n`);
          }
          if (typeof (response as any).flush === 'function') {
            (response as any).flush();
          }
        }
      },
      undefined,
      Boolean(force)
    );

    memory.competitors = competitors;
    knowledgeIndex.add(memory);

    // Persist to MongoDB, disk, and GitHub before concluding stream
    try {
      await memoryStore.save(memory);
    } catch (saveErr: any) {
      logger.warn(`Competitor persistence warning: ${saveErr.message}`);
    }

    // Immediately notify the client and close the SSE stream so the dashboard loading finishes
    if (!response.writableEnded) {
      response.write(`data: ${JSON.stringify({ type: 'complete', competitors })}\n\n`);
      response.end();
    }
  } catch (err: any) {
    logger.error(`Competitor Stream error: ${err.message}`);
    if (!response.writableEnded) {
      response.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      response.end();
    }
  } finally {
    clearInterval(heartbeat);
    if (!response.writableEnded) {
      response.end();
    }
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
    const { websiteUrl, compName, compUrl, youtube, instagram, facebook, linkedin } = request.body;
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
      if (!newComp.socials) {
        newComp.socials = { linkedin: null, instagram: null, facebook: null, youtube: null };
      }
      if (youtube) newComp.socials.youtube = youtube;
      if (instagram) newComp.socials.instagram = instagram;
      if (facebook) newComp.socials.facebook = facebook;
      if (linkedin) newComp.socials.linkedin = linkedin;

      if (!memory.competitors) memory.competitors = [];
      memory.competitors.push(newComp);
      await memoryStore.save(memory);
      knowledgeIndex.add(memory);
    }

    logger.success(`✅ Successfully scraped and added manual competitor with custom socials: ${compName}`);
    response.json({ success: true, competitor: newComp });
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
      await runTrackerOnce(site);
    } else {
      // Fallback for legacy calls (runs for all)
      const sites = await memoryStore.loadAll();
      for (const site of sites) {
        await runTrackerOnce(site);
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
    const user = (request as express.Request & { currentUser?: AuthUser }).currentUser;
    if (url && !(await hasProjectAccess(user, url))) {
      return response.status(403).json({ error: "Access denied. This project is not assigned to your account." });
    }

    let memory = url ? await memoryStore.loadBySite(url) : null;
    if (!memory && url) {
      const allMemories = await memoryStore.loadAll();
      memory = allMemories.find(m => {
        const u = (m.input?.websiteUrl || "").toLowerCase();
        return u.includes(url.toLowerCase()) || url.toLowerCase().includes(u.replace(/^https?:\/\//, "").replace(/\/+$/, ""));
      }) || null;
    }
    if (!memory) return response.status(404).json({ error: "Memory not found" });
    
    // Update knowledge index
    knowledgeIndex.add(memory);
    
    const feed = ((memory as any).socialFeed || []) as any[];

    // Extract target project identifiers so we strictly reject self-posts (the feed is ONLY for competitors)
    const targetOfficialName = (memory.businessIdentity?.officialName || "").trim().toLowerCase();
    const targetSiteUrl = (memory.input?.websiteUrl || "").toLowerCase();
    let targetDomain = "";
    try {
      targetDomain = new URL(targetSiteUrl.startsWith("http") ? targetSiteUrl : `https://${targetSiteUrl}`).hostname.replace(/^www\./, "").toLowerCase();
    } catch {}

    const targetTokens = [
      ...targetOfficialName.split(/[\s,.-]+/).filter(w => w.length >= 4 && !['solutions', 'pvt', 'ltd', 'private', 'limited', 'company', 'inc', 'corp', 'industries', 'group', 'agency', 'works', 'tech'].includes(w)),
      targetDomain.split('.')[0]
    ].filter(Boolean);

    const targetHandles = (memory.input?.socialUrls || []).map(u => {
      try {
        const segs = new URL(u).pathname.split('/').filter(Boolean);
        return segs[segs.length - 1]?.toLowerCase();
      } catch { return null; }
    }).filter(Boolean) as string[];

    // Return clean, strictly deduplicated competitor posts from memory
    const seenUrls = new Set<string>();
    const filteredFeed: any[] = [];

    for (const post of feed) {
      const rawLink = String(post.post_url || post.link || post.postUrl || "").trim();
      const rawLinkLower = rawLink.toLowerCase();
      const platformStr = String(post.platform || "").toLowerCase();
      const companyKey = String(post.company || post.competitorName || "").trim().toLowerCase();

      // Strictly filter out posts belonging to the target project itself (this is the COMPETITOR Feed)
      const isSelfPost = 
        (targetOfficialName && (companyKey === targetOfficialName || companyKey.includes(targetOfficialName) || targetOfficialName.includes(companyKey))) ||
        (targetDomain && rawLinkLower.includes(targetDomain)) ||
        targetTokens.some(tok => companyKey.includes(tok) && targetOfficialName.includes(tok)) ||
        targetHandles.some(h => h && h.length > 3 && rawLinkLower.includes(h));

      if (isSelfPost) {
        continue;
      }

      // Skip generic placeholder links
      if (rawLink.includes("instagram.com/instagram") || rawLink.includes("facebook.com/facebook")) {
        continue;
      }

      if (!rawLink || rawLink.includes("xyz123") || rawLink.includes("abc456") || rawLink.includes("example.com")) {
        continue;
      }

      // Reject generic YouTube watch links without video ID
      if ((rawLink.includes("youtube.com") || rawLink.includes("youtu.be")) && !rawLink.match(/(?:v=|\/vi\/|shorts\/)([\w-]{11})/)) {
        continue;
      }

      let normUrl = rawLink.split('?')[0].split('#')[0].replace(/\/+$/, '');
      if (rawLink.includes('youtube.com') || rawLink.includes('youtu.be')) {
        const ytId = rawLink.match(/(?:v=|\/vi\/|shorts\/)([\w-]{11})/);
        if (ytId && ytId[1]) normUrl = `https://www.youtube.com/watch?v=${ytId[1]}`;
      }

      const dedupKey = `${platformStr}_${companyKey}_${normUrl}`;

      if (!seenUrls.has(dedupKey)) {
        seenUrls.add(dedupKey);
        post.post_url = rawLink;
        post.link = rawLink;
        filteredFeed.push(post);
      }
    }

    // If the competitor feed is empty but competitors exist, trigger tracker once in the background
    if (filteredFeed.length === 0 && memory.competitors && memory.competitors.length > 0) {
      runTrackerOnce(memory).catch(err => {
        logger.warn(`Auto-triggered social tracker error: ${err.message}`);
      });
    }

    response.json({ feed: filteredFeed });
  } catch (e: any) {
    response.status(500).json({ error: e.message });
  }
});

app.get("/api/own-social-feed", async (request, response) => {
  const url = request.query.url as string;
  if (!url) return response.status(400).json({ error: "Missing url parameter" });

  try {
    let memory = await memoryStore.loadBySite(url);
    if (!memory) {
      const allMemories = await memoryStore.loadAll();
      memory = allMemories.find(m => {
        const u = (m.input?.websiteUrl || "").toLowerCase();
        return u.includes(url.toLowerCase()) || url.toLowerCase().includes(u.replace(/^https?:\/\//, "").replace(/\/+$/, ""));
      }) || allMemories[0] || null;
    }
    if (!memory) return response.status(404).json({ error: "Memory not found" });

    // Ensure baseline brandVoicePattern exists if not set
    if (!memory.brandVoicePattern) {
      const companyContext = {
        name: memory.businessIdentity?.officialName || "Business",
        industry: memory.businessIdentity?.industry,
        subIndustry: memory.businessIdentity?.subIndustry,
        description: memory.businessIdentity?.description,
        offerings: memory.offerings
      };
      memory.brandVoicePattern = await projectSocialAgent.analyzePattern(memory.ownSocialFeed || [], companyContext);
      await memoryStore.save(memory);
    }

    response.json({
      feed: memory.ownSocialFeed || [],
      pattern: memory.brandVoicePattern || null,
      socials: memory.ownSocials || {}
    });
  } catch (e: any) {
    logger.error(`Error in /api/own-social-feed: ${e.message}`);
    response.status(500).json({ error: e.message });
  }
});

app.post("/api/refresh-own-socials", async (request, response) => {
  const { websiteUrl, socials } = request.body;
  if (!websiteUrl) return response.status(400).json({ error: "Missing websiteUrl" });

  try {
    let memory = await memoryStore.loadBySite(websiteUrl);
    if (!memory) {
      const allMemories = await memoryStore.loadAll();
      memory = allMemories.find(m => {
        const u = (m.input?.websiteUrl || "").toLowerCase();
        return u.includes(websiteUrl.toLowerCase()) || websiteUrl.toLowerCase().includes(u.replace(/^https?:\/\//, "").replace(/\/+$/, ""));
      }) || allMemories[0] || null;
    }
    if (!memory) return response.status(404).json({ error: "Memory not found" });

    const companyName = memory.businessIdentity?.officialName || "Target Business";
    const existingSocials = socials || memory.ownSocials || memory.input?.socialUrls;

    logger.info(`Re-crawling official socials for ${companyName}...`);
    const result = await projectSocialAgent.run(
      companyName,
      memory.input.websiteUrl,
      existingSocials,
      undefined,
      memory
    );

    memory.ownSocials = result.ownSocials;
    memory.ownSocialFeed = result.ownSocialFeed;
    memory.brandVoicePattern = result.brandVoicePattern;

    await memoryStore.save(memory);
    knowledgeIndex.add(memory);

    response.json({
      success: true,
      feed: memory.ownSocialFeed,
      pattern: memory.brandVoicePattern,
      socials: memory.ownSocials
    });
  } catch (e: any) {
    logger.error(`Error refreshing own socials: ${e.message}`);
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

app.get("/api/sites", async (request, response) => {
  const onDisk = await memoryStore.loadAll();
  const user = (request as express.Request & { currentUser?: AuthUser }).currentUser;
  const assignedUrls = new Set(user ? await authStore.assignedProjects(user.username) : []);
  const normalize = (u: string) => (u || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  const assignedNorms = new Set(Array.from(assignedUrls).map(normalize));
  const isAdmin = user?.role === "admin";

  let sites = onDisk.map(m => {
    const urlNorm = normalize(m.input.websiteUrl);
    const isAssigned = assignedUrls.has(m.input.websiteUrl) || assignedNorms.has(urlNorm);
    return {
      url: m.input.websiteUrl,
      name: m.businessIdentity?.officialName || m.input.websiteUrl,
      assigned: isAssigned
    };
  });

  if (!isAdmin) {
    // Non-admin users ONLY receive sites assigned to them
    sites = sites.filter(s => s.assigned);
  } else {
    sites.sort((a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name));
  }

  response.json(sites);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const server = app.listen(port, async () => {
  logger.success(`Business R&D Agent System v2.0`);
  logger.info(`Listening on http://localhost:${port}`);

  // Warm up and bootstrap auth store and project memories into knowledge index
  try {
    await authStore.initialize();
    await memoryStore.syncFromCloud();
    const loadedMemories = await memoryStore.loadAll();
    for (const m of loadedMemories) {
      knowledgeIndex.add(m);
    }
    logger.info(`Bootstrapped ${loadedMemories.length} projects into KnowledgeIndex.`);
  } catch (err: any) {
    logger.warn(`Storage bootstrap warning: ${err.message}`);
  }

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
