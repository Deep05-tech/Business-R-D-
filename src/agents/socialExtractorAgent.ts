import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { rm } from 'node:fs/promises';
import pLimit from 'p-limit';
import { BingRssSearchEngine } from '../utils/bingRssSearchEngine.js';
import { FreeSearchEngine } from '../utils/freeSearchEngine.js';
import { BraveSearchEngine } from '../utils/braveSearchEngine.js';
import { isTavilyAvailable, markTavilyQuotaExhausted } from '../utils/tavilyClient.js';
import { verifyPostAuthor, isAuthenticCompetitorProfile, isInstagramBundleHash } from '../utils/socialVerificationUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chromium is the largest resource consumer in the tracker.  Keeping this
// process-wide (rather than per agent instance) prevents concurrent callers
// from competing over ChromeDriver or exhausting RAM/swap.
const configuredBrowserConcurrency = Number(process.env.SOCIAL_BROWSER_CONCURRENCY || 1);
const browserSessionLimit = pLimit(Number.isFinite(configuredBrowserConcurrency)
    ? Math.max(1, Math.min(configuredBrowserConcurrency, 2))
    : 1);

export interface ExtractPostsOptions {
    /** Use the low-cost HTTP/search route first; browser scraping remains a fallback. */
    preferHttp?: boolean;
}

export class SocialExtractorAgent {
    private driver: WebDriver | null = null;
    private profilePath: string;
    private browserProfilePaths: string[] = [];

    constructor() {
        this.profilePath = path.resolve(__dirname, '../../chrome_profile');
    }

    private async initBrowser(platform: string) {
        if (process.env.ENABLE_BROWSER_SCRAPING !== "true") {
            throw new Error("Browser scraping is disabled to prevent OOM on memory-constrained containers.");
        }
        const options = new chrome.Options();
        const tmpUserDataDir = path.join(os.tmpdir(), `chrome_user_data_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
        this.browserProfilePaths = [tmpUserDataDir];
        if (process.env.PROXY_URL) {
            options.addArguments(`--proxy-server=${process.env.PROXY_URL}`);
        }
        options.addArguments('--headless=new');
        options.addArguments('--disable-gpu');
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments(`--user-data-dir=${tmpUserDataDir}`);
        options.addArguments('--remote-allow-origins=*');
        options.addArguments('--window-size=1920,1080');
        options.addArguments('--disable-blink-features=AutomationControlled');
        options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        try {
            this.driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(options)
                .build();
            await this.driver.manage().setTimeouts({ implicit: 0, pageLoad: 15000, script: 15000 });
        } catch (err: any) {
            console.log(`[SocialExtractorAgent] Chrome initialization fallback: ${err.message}`);
            const fallbackOptions = new chrome.Options();
            fallbackOptions.addArguments('--headless=new');
            fallbackOptions.addArguments('--no-sandbox');
            fallbackOptions.addArguments('--disable-dev-shm-usage');
            fallbackOptions.addArguments(`--user-data-dir=${tmpUserDataDir}_fb`);
            fallbackOptions.addArguments('--remote-allow-origins=*');
            this.browserProfilePaths.push(`${tmpUserDataDir}_fb`);
            this.driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(fallbackOptions)
                .build();
            await this.driver.manage().setTimeouts({ implicit: 0, pageLoad: 15000, script: 15000 });
        }
    }

    private async closeBrowser() {
        const driver = this.driver;
        const profilePaths = this.browserProfilePaths;
        this.driver = null;
        this.browserProfilePaths = [];
        try {
            if (driver) await driver.quit();
        } finally {
            // Chrome creates substantial cache files in each temporary profile.
            // Remove them after every session so a long tracker cannot fill disk.
            await Promise.all(profilePaths.map(profilePath => rm(profilePath, { recursive: true, force: true }).catch(() => {})));
        }
    }

    public async extractYouTubeAPI(profileUrl?: string | null, compName?: string): Promise<any> {
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (!apiKey) return null;
        if (!profileUrl && !compName) return null;
        try {
            const cleanUrl = typeof profileUrl === 'string' ? profileUrl : '';
            const handleMatch = cleanUrl ? cleanUrl.match(/@([\w.-]+)/) : null;
            const channelMatch = cleanUrl ? cleanUrl.match(/\/channel\/([\w-]+)/) : null;
            const userMatch = cleanUrl ? cleanUrl.match(/\/user\/([\w-]+)/) : null;

            let channelId = "";
            let uploadsPlaylistId = "";

            if (channelMatch) channelId = channelMatch[1];

            const params: any = { part: "contentDetails,snippet", key: apiKey };
            if (channelId) params.id = channelId;
            else if (handleMatch) params.forHandle = handleMatch[1].startsWith('@') ? handleMatch[1] : `@${handleMatch[1]}`;
            else if (userMatch) params.forUsername = userMatch[1];

            let chRes: any = null;
            if (params.id || params.forHandle || params.forUsername) {
                chRes = await axios.get("https://youtube.googleapis.com/youtube/v3/channels", { params, timeout: 5000 }).catch(() => null);
            }

            if (chRes?.data?.items?.[0]) {
                uploadsPlaylistId = chRes.data.items[0].contentDetails?.relatedPlaylists?.uploads;
            }

            // Fallback: If no channel found by handle/URL, but we have compName, search YouTube channels for official match
            if (!uploadsPlaylistId && compName) {
                const searchRes = await axios.get("https://youtube.googleapis.com/youtube/v3/search", {
                    params: { part: "snippet", q: compName, type: "channel", maxResults: 5, key: apiKey },
                    timeout: 5000
                }).catch(() => null);

                const channels = searchRes?.data?.items || [];
                const nameTokens = compName.toLowerCase().split(/\s+/).filter(t => t.length > 2 && t !== "ltd" && t !== "inc" && t !== "pvt" && t !== "private" && t !== "limited" && t !== "corp" && t !== "group");

                for (const item of channels) {
                    const title = (item.snippet?.channelTitle || item.snippet?.title || "").toLowerCase();
                    const isMatch = nameTokens.some(token => title.includes(token));
                    if (isMatch && item.id?.channelId) {
                        const targetChId = item.id.channelId;
                        const subChRes = await axios.get("https://youtube.googleapis.com/youtube/v3/channels", {
                            params: { part: "contentDetails", id: targetChId, key: apiKey },
                            timeout: 5000
                        }).catch(() => null);
                        uploadsPlaylistId = subChRes?.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || "";
                        if (uploadsPlaylistId) break;
                    }
                }
            }

            if (uploadsPlaylistId) {
                const itemsRes = await axios.get("https://youtube.googleapis.com/youtube/v3/playlistItems", {
                    params: { part: "snippet,contentDetails", playlistId: uploadsPlaylistId, maxResults: 5, key: apiKey },
                    timeout: 5000,
                });

                const items = itemsRes.data?.items || [];
                if (items.length > 0) {
                    return items.map((item: any) => {
                        const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
                        const title = item.snippet?.title || "YouTube Video";
                        const publishedAt = item.snippet?.publishedAt || item.contentDetails?.videoPublishedAt || "";
                        const dateStr = publishedAt ? publishedAt.split("T")[0] : "Recent";
                        const thumb = item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null);

                        return {
                            caption: title,
                            timestamp: dateStr,
                            mediaType: "Video",
                            mediaUrls: thumb,
                            likes: "Hidden",
                            comments: "Hidden",
                            postUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : profileUrl
                        };
                    });
                }
            }
        } catch (e: any) {
            console.log(`[SocialExtractorAgent] YouTube Data API fast-path failed: ${e.message}`);
        }
        return null;
    }

    public async verifyYouTubeVideo(videoId: string, compName?: string): Promise<{ valid: boolean; title: string; author: string; thumbnail: string; channelUrl: string } | null> {
        if (!videoId || videoId.length !== 11) return null;
        try {
            const res = await axios.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
                timeout: 5000
            });
            const data = res.data;
            if (!data || !data.title || !data.author_name) return null;

            const author = String(data.author_name).trim();
            const title = String(data.title).trim();
            const cleanAuthor = author.toLowerCase().replace(/[^a-z0-9]/g, '');

            if (!compName) {
                return {
                    valid: true,
                    title,
                    author,
                    thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                    channelUrl: data.author_url || ''
                };
            }

            const cleanComp = compName
                .toLowerCase()
                .replace(/\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?|gmbh)\b/gi, '')
                .replace(/[^a-z0-9]/g, '');

            const STOPWORDS = new Set(['agency', 'india', 'digital', 'marketing', 'media', 'solutions', 'online', 'services', 'pvt', 'ltd', 'inc', 'llc', 'corp', 'the', 'and', 'pr', 'group', 'company', 'channel', 'official', 'in', 'of', 'for', 'by', 'at', 'on', 'with', 'best', 'top', 'new', 'no', '1', 'to', 'from', 'a', 'an']);

            const authorLower = author.toLowerCase();
            const authorTokens = authorLower
                .split(/[^a-z0-9]+/)
                .filter(t => t.length >= 3 && !STOPWORDS.has(t));

            const compTokens = compName
                .toLowerCase()
                .split(/[^a-z0-9]+/)
                .filter(t => t.length >= 3 && !STOPWORDS.has(t));

            const coreComp = compTokens.join('');
            const coreAuthor = authorTokens.join('');

            const hasCoreMatch = (coreComp.length >= 3 && (coreAuthor.includes(coreComp) || coreComp.includes(coreAuthor)));
            const hasTokenMatch = compTokens.length > 0 && compTokens.some(t => authorTokens.includes(t) || cleanAuthor.includes(t));

            const titleLower = title.toLowerCase();
            const cleanTitle = titleLower.replace(/[^a-z0-9]/g, '');

            // Title-based match for official corporate overview, plant/factory tour, product, or showcase videos
            const hasTitleCoreMatch = coreComp.length >= 4 && cleanTitle.includes(coreComp);
            const hasTitleTokenMatch = compTokens.length >= 2 && compTokens.every(t => titleLower.includes(t));
            const hasTitleMatch = hasTitleCoreMatch || hasTitleTokenMatch;

            // Strictly require author or title match; reject generic news broadcasters or unrelated third parties
            const isBroadcaster = authorLower.includes('news') || authorLower.includes('nbc') || authorLower.includes('cnn') || authorLower.includes('bbc') || authorLower.includes('times') || titleLower.includes('news');
            const isMatch = (hasCoreMatch || hasTokenMatch || hasTitleMatch) && !isBroadcaster;

            if (!isMatch) {
                console.log(`[SocialExtractorAgent] YouTube author mismatch: Author "${author}" does not match competitor "${compName}" for video ${videoId}. Discarding.`);
                return null;
            }

            return {
                valid: true,
                title,
                author,
                thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
                channelUrl: data.author_url || ''
            };
        } catch (e: any) {
            return null;
        }
    }

    private validateSocialPost(post: any, platform: string, profileUrl: string): any | null {
        if (!post) return null;
        if (post._invalidAuthor) return null;

        const postUrl = String(post.post_url || post.postUrl || "").trim();
        if (!postUrl || !postUrl.startsWith("http")) return null;

        let cleanPostUrl = postUrl;
        const lowerUrl = postUrl.toLowerCase();

        if (platform === "Instagram") {
            if (!lowerUrl.includes("instagram.com/")) return null;
            const isPostOrReel = lowerUrl.includes("/p/") || lowerUrl.includes("/reel/");
            if (!isPostOrReel) return null;
            const igSc = lowerUrl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
            if (igSc && igSc[1]) {
                const isReel = lowerUrl.includes("/reel/");
                cleanPostUrl = `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${igSc[1]}/`;
                if (isReel) {
                    post.media_type = "Video";
                    post.mediaType = "Video";
                }
            }
        }
        if (platform === "Facebook") {
            if (!lowerUrl.includes("facebook.com/")) return null;
            // Reject profile page links or directory list links
            if (lowerUrl.match(/facebook\.com\/[a-z0-9._-]+\/?$/i)) return null;
            if (lowerUrl.includes("facebook.com/profile.php?") && !lowerUrl.includes("story_fbid=") && !lowerUrl.includes("fbid=")) return null;
            if (lowerUrl.endsWith("/videos/") || lowerUrl.endsWith("/videos") || lowerUrl.endsWith("/posts/") || lowerUrl.endsWith("/posts") || lowerUrl.endsWith("/photos/") || lowerUrl.endsWith("/photos")) return null;

            const isFbSinglePost = lowerUrl.includes("/watch") || 
                                  lowerUrl.includes("/reel/") || 
                                  lowerUrl.includes("/share/p/") || 
                                  lowerUrl.includes("/share/v/") || 
                                  lowerUrl.includes("permalink.php") || 
                                  lowerUrl.includes("story.php") || 
                                  lowerUrl.includes("story_fbid=") || 
                                  lowerUrl.includes("fbid=") || 
                                  lowerUrl.includes("pfbid") || 
                                  Boolean(lowerUrl.match(/\/posts\/[a-z0-9_:-]+/i)) ||
                                  Boolean(lowerUrl.match(/\/photos\/[a-z0-9_-]+/i)) ||
                                  Boolean(lowerUrl.match(/\/photo\/?\?/i)) ||
                                  Boolean(lowerUrl.match(/\/videos?\/[a-z0-9._-]+/i));
            if (!isFbSinglePost) return null;
            cleanPostUrl = postUrl.split('&__cft__')[0].split('&__tn__')[0].split('#')[0].replace(/\/+$/, '').replace(/:(\d+)$/, '');
        }
        if (platform === "LinkedIn") {
            if (!lowerUrl.includes("linkedin.com/")) return null;
            const isLiPost = lowerUrl.includes("/posts/") || lowerUrl.includes("/feed/update/") || lowerUrl.includes("activity-");
            if (!isLiPost) return null;
            cleanPostUrl = postUrl.split('?')[0].split('#')[0].replace(/\/+$/, '');
        }
        if (platform === "YouTube") {
            if (!lowerUrl.includes("youtube.com/") && !lowerUrl.includes("youtu.be/")) return null;
            const ytMatch = lowerUrl.match(/(?:v=|\/vi\/|shorts\/)([\w-]{11})/);
            if (!ytMatch || !ytMatch[1]) return null; // Reject generic youtube.com/watch without video ID
            cleanPostUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
            post._ytId = ytMatch[1];
        }

        if (lowerUrl.includes("news") || lowerUrl.includes("tavily") || lowerUrl.includes("indiamart") || lowerUrl.includes("google.com/search") || lowerUrl.includes("/groups/") || lowerUrl.includes("castingcalls")) {
            return null;
        }

        post.post_url = cleanPostUrl;
        post.postUrl = cleanPostUrl;
        post.link = cleanPostUrl;

        const caption = String(post.caption || post.content || "").trim();
        const lowerCap = caption.toLowerCase();

        // Reject profile bios, follower stats, log-in prompts, and generic page titles:
        const isProfileBioOrLanding = 
            /\d+[\d,]*\s*(Followers|Following|Posts)/i.test(caption) ||
            /See Instagram photos/i.test(caption) ||
            /Log in to Facebook/i.test(caption) ||
            /Welcome to Facebook/i.test(caption) ||
            /Log In or Sign Up/i.test(caption) ||
            /Create an account/i.test(caption) ||
            lowerCap === "instagram" ||
            lowerCap === "facebook" ||
            lowerCap.startsWith("home - ") ||
            lowerCap.includes("log in to instagram") ||
            lowerCap.includes("log in or sign up");

        if (isProfileBioOrLanding) {
            return null;
        }

        // Entity mismatch guard: Verify handle or domain matching against target profileUrl / company
        const targetCompName = String(post.company || post.competitorName || "").trim().toLowerCase();
        const baseBrandName = targetCompName
            .replace(/\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?|gmbh)\b/gi, '')
            .trim();
        const cleanCompKey = baseBrandName.replace(/[^a-z0-9]/g, '');
        
        // Check if brand words match in caption or URL (require at least 2 distinct words for multi-word brands)
        const brandWords = baseBrandName.split(/\s+/).filter(w => w.length > 2);
        const matchedWords = brandWords.filter(w => lowerCap.includes(w) || lowerUrl.includes(w));
        const hasWordMatch = brandWords.length >= 2 ? (matchedWords.length >= 2) : (matchedWords.length >= 1);
        const hasCompMatch = (cleanCompKey.length >= 3 && (lowerCap.includes(baseBrandName) || lowerUrl.includes(cleanCompKey))) || hasWordMatch;

        if (profileUrl) {
            const targetHandleMatch = profileUrl.match(/(?:instagram\.com|facebook\.com|linkedin\.com\/(?:company|in)|youtube\.com\/@|\/channel\/)\/([a-zA-Z0-9._-]+)/i);
            const INVALID_TARGET_HANDLES = new Set(['pages', 'people', 'groups', 'p', 'reel', 'reels', 'watch', 'videos', 'popular', 'share', 'sharer', 'login', 'about', 'explore', 'stories', 'direct', 'tags']);
            if (targetHandleMatch && targetHandleMatch[1] && !INVALID_TARGET_HANDLES.has(targetHandleMatch[1].toLowerCase())) {
                const targetHandle = targetHandleMatch[1].toLowerCase().replace(/[-_.]/g, '');
                const candHandleMatch = lowerUrl.match(/(?:instagram\.com|facebook\.com|linkedin\.com\/(?:company|in|posts)|youtube\.com\/@|\/channel\/)\/([a-zA-Z0-9._-]+)/i);
                if (candHandleMatch && candHandleMatch[1]) {
                    const rawCand = candHandleMatch[1].toLowerCase();
                    const cleanCandHandle = rawCand.replace(/\.php$/i, '').replace(/[-_.]/g, '');
                    const ROUTE_KEYWORDS = new Set(['p', 'reel', 'reels', 'share', 'posts', 'videos', 'watch', 'photo', 'photos', 'permalink', 'story', 'popular', 'groups', 'events']);
                    const isKnownRoute = ROUTE_KEYWORDS.has(cleanCandHandle) || lowerUrl.includes('story.php') || lowerUrl.includes('permalink.php') || lowerUrl.includes('fbid=');
                    if (!isKnownRoute && targetHandle.length >= 4 && !cleanCandHandle.includes(targetHandle) && !targetHandle.includes(cleanCandHandle)) {
                        return null;
                    }
                }
            }
        } else if (!hasCompMatch) {
            return null;
        }

        if (targetCompName.includes("bearings")) {
            if (lowerCap.includes("educational communication") || lowerCap.includes("consortium for educational") || lowerCap.includes("eflu") || lowerUrl.includes("cec.vasantkunj") || lowerUrl.includes("cec-new-delhi")) {
                return null;
            }
        }

        // Allow base profile URLs if caption provides sufficient context
        const isBaseProfileUrl = !lowerUrl.includes('/p/') && !lowerUrl.includes('/reel/') && !lowerUrl.includes('/posts/') && !lowerUrl.includes('story.php') && !lowerUrl.includes('permalink') && !lowerUrl.includes('v=') && !lowerUrl.includes('/status/');
        if (isBaseProfileUrl && caption.length < 20) {
            return null;
        }

        // Reject Instagram bundle hashes immediately
        if (platform === "Instagram" && (isInstagramBundleHash(lowerUrl) || isInstagramBundleHash(String(post.id || '')))) {
            return null;
        }

        let thumbUrl = String(post.thumbnail || post.thumbnail_url || post.mediaUrls || post.mediaUrl || "").trim();
        if (thumbUrl.includes(',')) {
            thumbUrl = thumbUrl.split(',')[0].trim();
        }

        // Auto-heal Facebook photo posts if thumbnail is missing
        if (platform === "Facebook" && !thumbUrl) {
            const fbPhotoMatch = postUrl.match(/(?:fbid=|\/photos\/(?:[^\/]+\/)?|\/photo\/?\?fbid=|\bmedia_id=)(\d{8,25})/i);
            if (fbPhotoMatch && fbPhotoMatch[1]) {
                thumbUrl = `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${fbPhotoMatch[1]}`;
            }
        }

        // Auto-heal Instagram posts with valid shortcodes if thumbnail is missing
        if (platform === "Instagram" && !thumbUrl) {
            const scMatch = postUrl.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]{10,13})/);
            if (scMatch && scMatch[1] && !isInstagramBundleHash(scMatch[1])) {
                thumbUrl = `https://www.instagram.com/p/${scMatch[1]}/media/?size=l`;
            }
        }
        
        const lowerThumb = thumbUrl.toLowerCase();
        const isInvalidThumb = !thumbUrl.startsWith("http") ||
            lowerThumb.includes("profile_pic") ||
            lowerThumb.includes("profile_photo") ||
            lowerThumb.includes("avatar") ||
            lowerThumb.includes("ghost-person") ||
            lowerThumb.includes("company-logo") ||
            lowerThumb.includes("placeholder") ||
            lowerThumb.includes("default_logo") ||
            lowerThumb.includes("static/images");

        const mediaUrl = isInvalidThumb ? "" : thumbUrl;
        const thumbnailUrl = isInvalidThumb ? "" : thumbUrl;

        if (caption.length < 3 && !thumbnailUrl) {
            return null;
        }

        const rawType = String(post.media_type || post.mediaType || "Image").trim();
        let mediaType: "Image" | "Video" | "Carousel" | "Text" = "Image";
        if (rawType.toLowerCase().includes("video") || lowerUrl.includes("/reel/") || lowerUrl.includes("/watch")) {
            mediaType = "Video";
        } else if (rawType.toLowerCase().includes("carousel")) {
            mediaType = "Carousel";
        } else if (rawType.toLowerCase().includes("text") || !thumbnailUrl) {
            mediaType = "Text";
        }

        const likes = String(post.engagement?.likes || post.likes || "0").trim();
        const comments = String(post.engagement?.comments || post.comments || "0").trim();
        const publishedDate = String(post.published_date || post.date || post.timestamp || "Recent").trim();
        const companyName = String(post.company || post.competitorName || "").trim();
        const id = post.id || `post_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        return {
            id,
            company: companyName,
            platform: platform as any,
            post_url: postUrl,
            caption: caption,
            media_type: mediaType,
            thumbnail: thumbnailUrl,
            media_url: mediaUrl || thumbnailUrl,
            date: publishedDate,
            engagement: {
                likes,
                comments
            },
            // Compatibility aliases
            profile_url: profileUrl,
            thumbnail_url: thumbnailUrl,
            published_date: publishedDate,
            link: postUrl,
            content: caption,
            timestamp: publishedDate,
            mediaUrl: mediaUrl || thumbnailUrl,
            mediaUrls: mediaUrl || thumbnailUrl,
            mediaType: mediaType,
            likes,
            comments,
            postUrl,
            competitorName: companyName,
            video_url: post.video_url || post.videoUrl || undefined,
            videoUrl: post.video_url || post.videoUrl || undefined,
            activity_id: post.activity_id || undefined,
            fb_video_id: post.fb_video_id || post.video_id || undefined
        };
    }

    public async extract(platform: "Instagram" | "LinkedIn" | "Facebook" | "YouTube", profileUrl: string, compName?: string): Promise<string> {
        const posts = await this.extractPosts(platform, profileUrl, compName, 20);
        if (posts && posts.length > 0) {
            return this.formatOutput(platform, profileUrl, posts);
        }
        return `Status:\nSocial extraction failed\n\nReason:\nCould not extract latest posts directly from ${platform} profile page.`;
    }

    public async extractPosts(
        platform: "Instagram" | "LinkedIn" | "Facebook" | "YouTube",
        profileUrl: string,
        compName?: string,
        maxPosts: number = 20,
        options: ExtractPostsOptions = {}
    ): Promise<any[]> {
        const isBrowserEnabled = process.env.ENABLE_BROWSER_SCRAPING === "true";
        let httpAttempted = false;

        // Fast HTTP/Search route runs if requested or when headless browser is disabled
        if (options.preferHttp || !isBrowserEnabled) {
            httpAttempted = true;
            try {
                const httpPosts = await this.extractPostsHttp(platform, profileUrl, compName, maxPosts);
                if (httpPosts.length > 0) {
                    console.log(`[SocialExtractorAgent] Fast HTTP/API extraction succeeded for ${platform} (${profileUrl || compName}): ${httpPosts.length} posts.`);
                    return httpPosts;
                }
            } catch (e: any) {
                console.log(`[SocialExtractorAgent] Fast HTTP extraction attempt failed for ${platform}: ${e.message}`);
            }
        }

        // 1. Browser Strategy: Open the profile page directly in the browser and scrape latest posts
        // Guarded: only run if headless browser is explicitly enabled in environment (avoids 400MB RAM spike on 512MB hosts)
        if (isBrowserEnabled && profileUrl && profileUrl.startsWith("http")) {
            let attempts = 0;
            const maxAttempts = 2;
            while (attempts < maxAttempts) {
                try {
                    attempts++;
                    console.log(`[SocialExtractorAgent] Opening ${platform} profile page directly in browser: ${profileUrl}`);
                    const rawData = await browserSessionLimit(async () => {
                        await this.initBrowser(platform);
                        try {
                            if (platform === "Instagram") return await this.extractInstagram(profileUrl);
                            if (platform === "LinkedIn") return await this.extractLinkedIn(profileUrl);
                            if (platform === "Facebook") return await this.extractFacebook(profileUrl);
                            return await this.extractYouTube(profileUrl);
                        } finally {
                            await this.closeBrowser();
                        }
                    });

                    if (Array.isArray(rawData) && rawData.length > 0) {
                        const seenUrls = new Set<string>();
                        const validPosts: any[] = [];

                        for (const item of rawData) {
                            const validated = this.validateSocialPost({ ...item, competitorName: compName, isDirectProfilePost: true }, platform, profileUrl);
                            if (validated && !seenUrls.has(validated.post_url)) {
                                seenUrls.add(validated.post_url);
                                validPosts.push({ ...validated, isDirectProfilePost: true });
                                if (validPosts.length >= maxPosts) break;
                            }
                        }

                        if (validPosts.length > 0) {
                            console.log(`[SocialExtractorAgent] Successfully scraped ${validPosts.length} latest posts directly from ${platform} profile page.`);
                            return validPosts;
                        }
                    }
                } catch (error: any) {
                    console.log(`[SocialExtractorAgent] Browser profile scraping attempt ${attempts} failed for ${profileUrl}: ${error.message}`);
                    await this.closeBrowser().catch(() => {});
                }
            }
        }

        // 2. Secondary Fallback: Fast HTTP / API / Search Extraction (only if not already executed)
        if (!httpAttempted) {
            try {
                const httpPosts = await this.extractPostsHttp(platform, profileUrl, compName, maxPosts);
                if (httpPosts && httpPosts.length > 0) {
                    console.log(`[SocialExtractorAgent] Fast HTTP/API extraction succeeded for ${platform} (${profileUrl || compName}): ${httpPosts.length} posts.`);
                    return httpPosts;
                }
            } catch (e: any) {
                console.log(`[SocialExtractorAgent] Fast HTTP extraction attempt failed for ${platform}: ${e.message}`);
            }
        }

        if (platform === "YouTube") {
            try {
                const apiResult = await this.extractYouTubeAPI(profileUrl, compName);
                if (apiResult && Array.isArray(apiResult) && apiResult.length > 0) {
                    const validPosts = apiResult
                        .map(p => this.validateSocialPost(p, platform, profileUrl))
                        .filter(Boolean);
                    if (validPosts.length > 0) {
                        return validPosts.slice(0, maxPosts);
                    }
                }
            } catch (e: any) {
                console.log(`[SocialExtractorAgent] YouTube API path failed in extractPosts: ${e.message}`);
            }
        }

        return [];
    }

    public async extractPostsHttp(
        platform: "Instagram" | "LinkedIn" | "Facebook" | "YouTube",
        profileUrl: string,
        compName?: string,
        maxPosts: number = 20
    ): Promise<any[]> {
        const posts: any[] = [];
        const cleanCompName = compName || "";

        if (platform === "Instagram") {
            try {
                if (profileUrl && profileUrl.startsWith("http")) {
                    let res: any;
                    try {
                        res = await axios.get(profileUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                                'Accept-Language': 'en-US,en;q=0.9',
                                'Sec-Fetch-Dest': 'document',
                                'Sec-Fetch-Mode': 'navigate',
                                'Sec-Fetch-Site': 'none',
                                'Sec-Fetch-User': '?1',
                                'Upgrade-Insecure-Requests': '1'
                            },
                            timeout: 10000,
                            maxRedirects: 5
                        });
                    } catch (igErr: any) {
                        if (igErr.response?.status === 429) {
                            await new Promise(r => setTimeout(r, 1500));
                            res = await axios.get(profileUrl, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                                    'Accept-Language': 'en-US,en;q=0.9'
                                },
                                timeout: 10000,
                                maxRedirects: 5
                            });
                        } else {
                            throw igErr;
                        }
                    }
                    const html = res?.data || "";
                    // Real Instagram post/reel shortcodes:
                    // 1. Strict regex: preceded by quote, slash, or full URL to avoid base64 noise
                    const matches: string[] = [];
                    const hrefMatches = html.matchAll(/(?:href=["']|(?:https?:\/\/(?:www\.)?instagram\.com)?)\/(?:p|reel)\/([A-Za-z0-9_-]{10,13})(?:[/?#"'&]|\s|$)/g);
                    for (const hm of hrefMatches) {
                        if (hm[1]) matches.push(`/p/${hm[1]}/`);
                    }
                    const jsonMatches = html.matchAll(/"(?:shortcode|code)":"([A-Za-z0-9_-]{10,13})"/g);
                    for (const jm of jsonMatches) {
                        if (jm[1]) matches.push(`/p/${jm[1]}/`);
                    }

                    const seenShortcodes = new Set<string>();
                    for (const m of matches) {
                        const scMatch = m.match(/(?:p|reel)\/([A-Za-z0-9_-]{10,13})/);
                        if (scMatch && scMatch[1] && !seenShortcodes.has(scMatch[1])) {
                            const code = scMatch[1];
                            const codeLower = code.toLowerCase();
                            if (codeLower === 'instagram' || codeLower.includes('explore') || codeLower.includes('stories') || codeLower.includes('accounts') || codeLower === 'category' || codeLower.includes('join') || code.length < 10 || code.length > 13 || isInstagramBundleHash(code)) continue;
                            seenShortcodes.add(code);
                            const isReel = m.includes('/reel/');
                            const postLink = `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${code}/`;
                            posts.push({
                                id: `ig_${code}`,
                                company: cleanCompName,
                                platform: "Instagram",
                                post_url: postLink,
                                caption: `${cleanCompName} on Instagram: Official ${isReel ? 'Reel' : 'Post'}.`,
                                media_type: isReel ? "Video" : "Image",
                                thumbnail: `https://www.instagram.com/p/${code}/media/?size=l`,
                                media_url: `https://www.instagram.com/p/${code}/media/?size=l`,
                                date: new Date().toISOString().split('T')[0],
                                engagement: { likes: 0, comments: 0 },
                                isDirectProfilePost: true
                            });
                            if (posts.length >= maxPosts) break;
                        }
                    }
                }
            } catch (e: any) {
                if (!e.message?.includes('403') && !e.message?.includes('404')) {
                    console.log(`[SocialExtractorAgent] Instagram direct HTML extraction notice: ${e.message}`);
                }
            }
        }

        if (platform === "Facebook") {
            try {
                if (profileUrl && profileUrl.startsWith("http")) {
                    // Ensure trailing slash for Facebook profile URLs to prevent HTTP 400
                    const normalizedProfileUrl = profileUrl.split('?')[0].replace(/\/+$/, '') + '/';
                    let res: any;
                    try {
                        res = await axios.get(normalizedProfileUrl, {
                            headers: {
                                'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                                'Accept-Language': 'en-US,en;q=0.9'
                            },
                            timeout: 8000,
                            maxRedirects: 5
                        });
                    } catch (fbErr: any) {
                        try {
                            res = await axios.get(normalizedProfileUrl, {
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                                },
                                timeout: 8000,
                                maxRedirects: 5
                            });
                        } catch {
                            // Proceed to permalink/search fallback
                        }
                    }
                    const html = res?.data || "";
                    const seenUrls = new Set<string>();

                    // 1. Look for permalink_url in JSON script blobs (e.g. reels, videos, posts, pfbid)
                    const permalinks = html.matchAll(/"permalink_url":"([^"]+)"/g);
                    for (const m of permalinks) {
                        const rawUrl = m[1].replace(/\\\//g, "/");
                        if (!rawUrl.includes("/permalink.php") && !rawUrl.match(/\/(?:reel|reels|videos|photos|posts)\/[a-zA-Z0-9_-]+/)) continue;
                        if (seenUrls.has(rawUrl)) continue;
                        seenUrls.add(rawUrl);

                        const matchIdx = m.index || 0;
                        const window = html.substring(Math.max(0, matchIdx - 1500), Math.min(html.length, matchIdx + 1500));
                        let caption = "";
                        const textMatch = window.match(/"text":"([^"]{15,500})"/);
                        if (textMatch) {
                            caption = textMatch[1]
                                .replace(/\\n/g, " ")
                                .replace(/\\u([0-9a-fA-F]{4})/g, (_: string, c: string) => String.fromCharCode(parseInt(c, 16)))
                                .trim();
                        }
                        if (!caption || caption.startsWith("See more") || caption.startsWith("Page ·") || caption.includes("Not yet rated")) {
                            caption = `${cleanCompName} on Facebook: Official Update.`;
                        }

                        let mediaUrl = "";
                        const imgMatch = window.match(/"image":\{"uri":"([^"]+)"/);
                        if (imgMatch) {
                            mediaUrl = imgMatch[1].replace(/\\\/|\//g, '/').replace(/\\u0026/g, '&');
                        }

                        const isVideo = rawUrl.includes("/reel/") || rawUrl.includes("/videos/");
                        posts.push({
                            id: `fb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                            company: cleanCompName,
                            platform: "Facebook",
                            post_url: rawUrl,
                            caption: caption,
                            media_type: isVideo ? "Video" : (mediaUrl ? "Image" : "Text"),
                            thumbnail: mediaUrl,
                            media_url: mediaUrl,
                            date: new Date().toISOString().split("T")[0],
                            engagement: { likes: 0, comments: 0 },
                            isDirectProfilePost: true
                        });
                        if (posts.length >= maxPosts) break;
                    }

                    // 2. Fallback: match post / reel / video URLs directly in page HTML
                    if (posts.length < maxPosts) {
                        const urlMatches = html.matchAll(/https?:\/\/(?:www|m)\.facebook\.com\/([a-zA-Z0-9._-]+)\/(?:posts|videos|photos|reel)\/([a-zA-Z0-9_-]+)/g);
                        for (const m of urlMatches) {
                            const isReel = m[0].includes('/reel/');
                            const isVideoRoute = m[0].includes('/videos/');
                            const isPhotos = m[0].includes('/photos/');
                            const routeType = isReel ? 'reel' : (isVideoRoute ? 'videos' : (isPhotos ? 'photos' : 'posts'));
                            const fullUrl = `https://www.facebook.com/${m[1]}/${routeType}/${m[2]}/`;
                            if (seenUrls.has(fullUrl)) continue;
                            seenUrls.add(fullUrl);

                            const isVideo = isReel || isVideoRoute;
                            const photoId = m[2];
                            let thumb = "";
                            if (isPhotos && /^\d{8,25}$/.test(photoId)) {
                                thumb = `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${photoId}`;
                            }
                            posts.push({
                                id: `fb_${m[2]}`,
                                company: cleanCompName,
                                platform: "Facebook",
                                post_url: fullUrl,
                                caption: `${cleanCompName} on Facebook: Official Post.`,
                                media_type: isVideo ? "Video" : (thumb ? "Image" : "Text"),
                                thumbnail: thumb,
                                media_url: thumb || fullUrl,
                                date: new Date().toISOString().split("T")[0],
                                engagement: { likes: 0, comments: 0 },
                                isDirectProfilePost: true
                            });
                            if (posts.length >= maxPosts) break;
                        }
                    }
                }
            } catch (e: any) {
                if (!e.message?.includes('403') && !e.message?.includes('404')) {
                    console.log(`[SocialExtractorAgent] Facebook direct HTML extraction notice: ${e.message}`);
                }
            }
        }

        if (platform === "LinkedIn") {
            try {
                if (profileUrl && profileUrl.startsWith("http")) {
                    const res = await axios.get(profileUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                        },
                        timeout: 10000
                    });
                const $ = cheerio.load(res.data);
                $('script[type="application/ld+json"]').each((_, el) => {
                    try {
                        const json = JSON.parse($(el).text());
                        const graph = json['@graph'] || (Array.isArray(json) ? json : [json]);
                        graph.forEach((item: any) => {
                            if (item['@type'] === 'DiscussionForumPosting' || item['@type'] === 'SocialMediaPosting' || item.headline || item.articleBody) {
                                const caption = item.articleBody || item.headline || item.text || item.description || "";
                                const postUrl = item.url || item['@id'] || profileUrl;
                                const date = item.datePublished || item.dateCreated || new Date().toISOString();
                                const image = item.image?.url || item.image || item.thumbnailUrl || "";
                                if (caption.length > 10) {
                                    posts.push({
                                        id: `li_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                        company: cleanCompName,
                                        platform: "LinkedIn",
                                        post_url: postUrl,
                                        caption: caption.trim(),
                                        media_type: image ? "Image" : "Text",
                                        thumbnail: Array.isArray(image) ? image[0] : (typeof image === 'string' ? image : ""),
                                        media_url: Array.isArray(image) ? image[0] : (typeof image === 'string' ? image : ""),
                                        date: typeof date === 'string' ? date.split('T')[0] : new Date().toISOString().split('T')[0],
                                        engagement: { likes: 0, comments: 0 }
                                    });
                                }
                            }
                        });
                    } catch {}
                });
                }
            } catch (e: any) {
                // Direct profile scrape is an optional fast-path; proceed to search engine fallback on expected HTTP blocks
                if (!e.message?.includes('403') && !e.message?.includes('404')) {
                    console.log(`[SocialExtractorAgent] LinkedIn HTTP extraction notice: ${e.message}`);
                }
            }
        }

        if (platform === "YouTube") {
            // 1. Direct channel scraping if profileUrl is provided
            if (profileUrl && !profileUrl.includes('search_query')) {
                try {
                    let channelUrl = profileUrl.trim();
                    if (!channelUrl.includes('/videos') && !channelUrl.includes('/watch') && !channelUrl.includes('search_query')) {
                        channelUrl = `${channelUrl.replace(/\/+$/, '')}/videos`;
                    }
                    if (channelUrl.includes('v=')) {
                        const vMatch = channelUrl.match(/v=([a-zA-Z0-9_-]{11})/);
                        if (vMatch && vMatch[1]) {
                            const verified = await this.verifyYouTubeVideo(vMatch[1], cleanCompName);
                            if (verified) {
                                posts.push({
                                    id: `yt_${vMatch[1]}`,
                                    company: cleanCompName,
                                    platform: "YouTube",
                                    post_url: `https://www.youtube.com/watch?v=${vMatch[1]}`,
                                    caption: verified.title,
                                    media_type: "Video",
                                    thumbnail: verified.thumbnail,
                                    media_url: verified.thumbnail,
                                    date: new Date().toISOString().split('T')[0],
                                    engagement: { likes: 0, comments: 0 }
                                });
                            }
                        }
                    } else {
                        const chRes = await axios.get(channelUrl, {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                'Accept-Language': 'en-US,en;q=0.9'
                            },
                            timeout: 8000
                        }).catch(() => null);

                        if (chRes && chRes.data) {
                            const vidMatches = chRes.data.match(/"videoId":"([a-zA-Z0-9_-]{11})"/g) || [];
                            const seenVids = new Set<string>();
                            for (const m of vidMatches) {
                                const vMatch = m.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
                                if (vMatch && vMatch[1] && !seenVids.has(vMatch[1])) {
                                    seenVids.add(vMatch[1]);
                                    const vId = vMatch[1];
                                    const verified = await this.verifyYouTubeVideo(vId, cleanCompName);
                                    if (verified) {
                                        posts.push({
                                            id: `yt_${vId}`,
                                            company: cleanCompName,
                                            platform: "YouTube",
                                            post_url: `https://www.youtube.com/watch?v=${vId}`,
                                            caption: verified.title,
                                            media_type: "Video",
                                            thumbnail: verified.thumbnail,
                                            media_url: verified.thumbnail,
                                            date: new Date().toISOString().split('T')[0],
                                            engagement: { likes: 0, comments: 0 }
                                        });
                                        if (posts.length >= maxPosts) break;
                                    }
                                }
                            }
                        }
                    }
                } catch (e: any) {
                    // Channel direct scrape notice
                }
            }
        }

        if (posts.length === 0 && cleanCompName) {
            try {
                const searchBrand = cleanCompName
                    .replace(/^m\/s\.?\s+/i, '')
                    .split(/[-–—|(/]/)[0]
                    .replace(/\b(pvt\.?\s*ltd\.?|private\s+limited|ltd\.?|limited|inc\.?|incorporated|llc|corp\.?|corporation|co\.?|gmbh)\b/gi, '')
                    .replace(/[^\w\s]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim() || cleanCompName;

                let results: any[] = [];
                const handleMatch = profileUrl ? profileUrl.match(/(?:facebook\.com|instagram\.com|linkedin\.com\/(?:company|in)|youtube\.com\/@|\/channel\/)\/([a-zA-Z0-9._-]+)/i) : null;
                const handle = handleMatch && !['pages', 'people', 'groups', 'p', 'reel', 'reels', 'watch', 'videos', 'popular', 'share', 'sharer', 'login'].includes(handleMatch[1].toLowerCase()) ? handleMatch[1] : '';

                // 1. Try Tavily Search API first if available and within quota limits
                if (isTavilyAvailable()) {
                    const tavilyKey = process.env.TAVILY_API_KEY;
                    try {
                        const targetDomains: Record<string, string[]> = {
                            "Instagram": ["instagram.com"],
                            "Facebook": ["facebook.com"],
                            "LinkedIn": ["linkedin.com"],
                            "YouTube": ["youtube.com"]
                        };

                        let tavilyQuery = "";
                        if (platform === "Instagram") {
                            tavilyQuery = handle ? `"${handle}"` : `"${searchBrand}"`;
                        } else if (platform === "Facebook") {
                            tavilyQuery = handle ? `"${handle}"` : `"${searchBrand}"`;
                        } else if (platform === "LinkedIn") {
                            tavilyQuery = handle ? `"${handle}"` : `"${searchBrand}"`;
                        } else if (platform === "YouTube") {
                            tavilyQuery = handle ? `"${handle}"` : `"${searchBrand}"`;
                        }

                        const tavilyRes = await axios.post("https://api.tavily.com/search", {
                            api_key: tavilyKey,
                            query: tavilyQuery,
                            search_depth: "basic",
                            include_domains: targetDomains[platform] || [],
                            max_results: maxPosts * 3
                        }, { timeout: 6000 });

                        if (tavilyRes.data && Array.isArray(tavilyRes.data.results)) {
                            for (const r of tavilyRes.data.results) {
                                const u = (r.url || "").trim();
                                let snippet = (r.content || r.title || "").trim();
                                if (u && snippet && !u.includes("/accounts/login") && !u.includes("/login/")) {
                                    results.push({ url: u, title: r.title || "", content: snippet });
                                }
                            }
                        }
                    } catch (tavErr: any) {
                        const status = tavErr.response?.status;
                        const errMsg = tavErr.response?.data?.detail?.error || tavErr.message || '';
                        if (status === 432 || status === 429 || errMsg.includes('limit') || errMsg.includes('quota')) {
                            markTavilyQuotaExhausted(errMsg);
                        }
                    }
                }

                const isDomainMatch = (u: string) => {
                    if (!u) return false;
                    const l = u.toLowerCase();
                    if (platform === "Instagram") return l.includes("instagram.com/p/") || l.includes("instagram.com/reel/");
                    if (platform === "Facebook") return l.includes("facebook.com/") && (l.includes("/posts/") || l.includes("/photos/") || l.includes("/videos/") || l.includes("/reel/") || l.includes("story.php") || l.includes("permalink.php") || l.includes("fbid="));
                    if (platform === "LinkedIn") return l.includes("linkedin.com/posts/") || l.includes("linkedin.com/feed/update/") || l.includes("linkedin.com/pulse/");
                    if (platform === "YouTube") return l.includes("youtube.com/watch") || l.includes("youtu.be/") || l.includes("youtube.com/shorts/");
                    return false;
                };

                // 2. Fallback to BraveSearchEngine (fast, keyless, reliable HTML search)
                if (!results || results.length === 0) {
                    let braveQuery = "";
                    if (platform === "Instagram") {
                        braveQuery = handle ? `site:instagram.com/p/ OR site:instagram.com/reel/ "${handle}"` : `site:instagram.com/p/ OR site:instagram.com/reel/ "${searchBrand}"`;
                    } else if (platform === "Facebook") {
                        braveQuery = handle ? `"${handle}" site:facebook.com` : `"${searchBrand}" site:facebook.com`;
                    } else if (platform === "LinkedIn") {
                        braveQuery = `"${searchBrand}" site:linkedin.com/posts/ OR site:linkedin.com/feed/update/`;
                    } else if (platform === "YouTube") {
                        braveQuery = `"${searchBrand}" site:youtube.com/watch`;
                    }

                    if (braveQuery) {
                        try {
                            const brave = new BraveSearchEngine({ maxResults: 15 });
                            const rawBrave = await brave.invoke({ query: braveQuery });
                            const braveResults = JSON.parse(rawBrave || "[]");
                            if (Array.isArray(braveResults) && braveResults.length > 0) {
                                for (const r of braveResults) {
                                    if (isDomainMatch(r.url)) results.push(r);
                                }
                            }
                        } catch {}
                    }

                    // 3. Fallback to FreeSearchEngine (DuckDuckGo) with unquoted brand syntax (reliable and free)
                    if (!results || results.length === 0) {
                        let ddgQuery = "";
                        if (platform === "Instagram") {
                            ddgQuery = handle ? `site:instagram.com "${handle}"` : `site:instagram.com "${searchBrand}"`;
                        } else if (platform === "Facebook") {
                            ddgQuery = `${searchBrand} site:facebook.com`;
                        } else if (platform === "LinkedIn") {
                            ddgQuery = `${searchBrand} site:linkedin.com/posts/`;
                        } else if (platform === "YouTube") {
                            ddgQuery = `${searchBrand} site:youtube.com/watch`;
                        }

                        if (ddgQuery) {
                            try {
                                const ddg = new FreeSearchEngine({ maxResults: 10 });
                                const rawDDG = await ddg.invoke({ query: ddgQuery });
                                const ddgResults = JSON.parse(rawDDG || "[]");
                                if (Array.isArray(ddgResults) && ddgResults.length > 0) {
                                    for (const r of ddgResults) {
                                        if (isDomainMatch(r.url)) results.push(r);
                                    }
                                }
                            } catch {}
                        }
                    }

                    // 4. Fallback to BingRssSearchEngine with strict domain matching
                    if (!results || results.length === 0 && braveQuery) {
                        try {
                            const bing = new BingRssSearchEngine({ maxResults: 12 });
                            const rawBing = await bing.invoke({ query: braveQuery });
                            const bingResults = JSON.parse(rawBing || "[]");
                            if (Array.isArray(bingResults) && bingResults.length > 0) {
                                for (const r of bingResults) {
                                    if (isDomainMatch(r.url)) results.push(r);
                                }
                            }
                        } catch {}
                    }
                }

                for (const r of results) {
                    const url = (r.url || "").trim();
                    const urlLower = url.toLowerCase();
                    if (urlLower.includes('merriam-webster.com') || urlLower.includes('dictionary.com') || urlLower.includes('thesaurus.com') || urlLower.includes('wikipedia.org')) continue;

                    let content = (r.content || r.title || "").trim();

                    if (platform === "Instagram") {
                        content = content.replace(/^.*?\bon Instagram:\s*["“]?/i, '').replace(/["”]$/, '').replace(/\s+/g, ' ').trim();
                        if (content.toLowerCase().includes('welcome back to instagram') || content.toLowerCase().includes('sign in to check out')) {
                            content = `${cleanCompName} - Instagram Update`;
                        }
                    } else if (platform === "Facebook") {
                        content = content.replace(/^.*?\bon Facebook:\s*["“]?/i, '').replace(/["”]$/, '').replace(/\s+/g, ' ').trim();
                        if (content.toLowerCase().includes('see posts, photos and more on facebook') || content.toLowerCase().includes('log into facebook') || content.toLowerCase().includes('see more posts')) {
                            let slugTitle = "";
                            const slugMatch = url.match(/\/(?:videos|posts|reel)\/([a-zA-Z0-9_-]{10,})/i);
                            if (slugMatch && slugMatch[1] && !/^\d+$/.test(slugMatch[1])) {
                                slugTitle = slugMatch[1].replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
                                if (slugTitle.length > 5) {
                                    slugTitle = slugTitle.charAt(0).toUpperCase() + slugTitle.slice(1);
                                }
                            }
                            content = slugTitle || `${cleanCompName} - Facebook Update`;
                        }
                    }

                    if (url) {
                        const isDuplicate = posts.some(p => (p.post_url || p.link || '').toLowerCase() === url.toLowerCase());
                        if (isDuplicate) continue;

                        let thumb = "";
                        let med = url;
                        let vidTitle = content;

                        if (platform === "YouTube") {
                            const ytMatch = url.match(/(?:v=|\/vi\/|shorts\/)([\w-]{11})/);
                            if (ytMatch && ytMatch[1]) {
                                const verified = await this.verifyYouTubeVideo(ytMatch[1], cleanCompName);
                                if (!verified) {
                                    continue;
                                }
                                thumb = verified.thumbnail;
                                med = verified.thumbnail;
                                vidTitle = verified.title;
                            } else {
                                continue;
                            }
                        } else if (platform === "Facebook") {
                            const photoMatch = url.match(/(?:fbid=|\/photos\/(?:[^\/]+\/)?|\/photo\/?\?fbid=|\bmedia_id=|\/videos\/(?:[^\/]+\/)?|\/posts\/)(\d{8,25})/i);
                            if (photoMatch && photoMatch[1]) {
                                thumb = `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${photoMatch[1]}`;
                                med = thumb;
                            }
                        } else if (platform === "Instagram") {
                            const scMatch = url.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]{10,13})/);
                            if (scMatch && scMatch[1] && !isInstagramBundleHash(scMatch[1])) {
                                thumb = `https://www.instagram.com/p/${scMatch[1]}/media/?size=l`;
                                med = thumb;
                            }
                        }

                        posts.push({
                            id: `${platform.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                            company: cleanCompName,
                            platform: platform as any,
                            post_url: url,
                            caption: vidTitle || content,
                            media_type: platform === "YouTube" || url.includes('/video') || url.includes('/reel') ? "Video" : (thumb ? "Image" : "Text"),
                            thumbnail: thumb,
                            media_url: med,
                            profile_url: profileUrl,
                            profileUrl: profileUrl,
                            date: new Date().toISOString().split('T')[0],
                            engagement: { likes: 0, comments: 0 }
                        });
                        if (posts.length >= maxPosts * 2) break;
                    }
                }
            } catch (e: any) {
                console.log(`[SocialExtractorAgent] Search engine fallback failed for ${platform}: ${e.message}`);
            }
        }

        const validPosts = posts.map(p => this.validateSocialPost(p, platform, profileUrl)).filter(Boolean) as any[];

        // Deduplicate validPosts to ensure NO repeating duplicate URLs or captions
        const seenUrls = new Set<string>();
        const uniquePosts: any[] = [];
        for (const p of validPosts) {
            const urlKey = (p.post_url || p.link || p.postUrl || "").toLowerCase();
            if (urlKey && !seenUrls.has(urlKey)) {
                seenUrls.add(urlKey);
                uniquePosts.push(p);
            }
        }

        const candidateSlice = uniquePosts.slice(0, maxPosts * 2);
        const enriched = await Promise.all(
            candidateSlice.map(p => this.enrichPostDetails(p, platform))
        );
        const validEnriched = enriched.filter(p => !p._invalidAuthor && Boolean(
            p.thumbnail || p.platform === 'YouTube' || p.platform === 'Instagram' || p.platform === 'Facebook' || p._ytId
        ));
        return validEnriched.slice(0, maxPosts);
    }

    public static cleanSocialCaption(text: string, platform?: string): string {
        if (!text) return '';
        let s = String(text).trim();

        // 1. Strip Instagram login page texts and redirects
        s = s.replace(/Welcome back to Instagram[\s\S]*?(?:around the world\.?|world\.?|$)/gis, '');
        s = s.replace(/Sign in to check out what your friends[\s\S]*?(?:around the world\.?|world\.?|$)/gis, '');
        s = s.replace(/Log in to see photos and videos from friends[\s\S]*?(?:around the world\.?|world\.?|$)/gis, '');
        s = s.replace(/Log In Sign Up.*?Never miss a post from.*?Sign up/gis, '');
        s = s.replace(/Log In Sign Up.*?Sign up for Instagram/gis, '');
        s = s.replace(/Start the conversation\.\s*\d*\s*Log in to like or comment\./gis, '');
        s = s.replace(/Log in to like or comment\./gis, '');
        s = s.replace(/## No comments yet\.\s*Start the conversation\./gis, '');
        s = s.replace(/See more posts from [^\n.]+/gis, '');
        s = s.replace(/Don't have an account\? Sign up/gis, '');

        // 2. Strip Facebook accessibility / photo description boilerplates
        s = s.replace(/See posts, photos and more on Facebook\.?/gis, '');
        s = s.replace(/See posts, photos and more on Facebook/gis, '');
        s = s.replace(/Log into Facebook to start sharing and connecting with your friends, family, and people you know\.?/gis, '');
        s = s.replace(/Log into Facebook to start sharing.*?$/gis, '');
        s = s.replace(/Log into Facebook/gis, '');
        s = s.replace(/Log In or Sign Up to View/gis, '');
        s = s.replace(/Connect with friends and the world around you on Facebook\.?/gis, '');
        s = s.replace(/See photos, profile pictures and albums from.*?$/gis, '');
        s = s.replace(/No photo description available\.?/gis, '');
        s = s.replace(/May be an image of.*$/gis, '');
        s = s.replace(/May be a graphic of.*$/gis, '');
        s = s.replace(/Photo by .*? on .*?\./gis, '');
        s = s.replace(/Video by .*? on .*?\./gis, '');
        s = s.replace(/See more posts.*$/gis, '');
        s = s.replace(/[a-zA-Z0-9._]+'s profile picture/gis, '');
        s = s.replace(/[a-zA-Z0-9._]+ • Follow/gis, '');
        s = s.replace(/^Title:\s*.*?\s*-\s*/is, '');
        s = s.replace(/^[A-Za-z]{3}\s+\d{1,2},\s*\d{4}\s*·\s*/is, '');
        s = s.replace(/\.\.\.\s*From\s*$/is, '');

        // Strip common Instagram headers
        s = s.replace(/^.*?\bon (?:Instagram|Facebook):\s*["“]?/is, '');
        s = s.replace(/^[\d,kK]+\s*likes,\s*[\d,kK]+\s*comments\s*-\s*[^\s:]+(?:\s+on\s+[A-Za-z]+\s+\d{1,2},\s*\d{4})?:\s*["“]?/is, '');

        const lower = s.toLowerCase();
        if (lower.includes('welcome back to instagram') ||
            lower.includes('sign in to check out') ||
            lower.includes('no photo description available') ||
            lower.includes('see posts, photos and more on facebook') ||
            lower.includes('log into facebook') ||
            lower.includes('merriam-webster') ||
            lower.includes('dictionary.com') ||
            lower === 'around the world.' ||
            lower === 'around the world') {
            s = '';
        }

        if (s.startsWith('"') || s.startsWith('“')) s = s.slice(1);
        if (s.endsWith('"') || s.endsWith('”')) s = s.slice(0, -1);
        return s.trim();
    }

    private async enrichPostDetails(post: any, platform: string): Promise<any> {
        const postUrl = post.post_url || post.link || post.postUrl;
        if (!postUrl || !postUrl.startsWith('http')) return post;

        if (platform === "YouTube") {
            const ytMatch = postUrl.match(/(?:v=|\/vi\/|shorts\/)([\w-]{11})/);
            if (ytMatch && ytMatch[1]) {
                const verified = await this.verifyYouTubeVideo(ytMatch[1], post.company || post.competitorName);
                if (verified) {
                    post.caption = verified.title;
                    post.content = verified.title;
                    post.thumbnail = verified.thumbnail;
                    post.thumbnail_url = verified.thumbnail;
                    post.media_url = verified.thumbnail;
                    post.mediaUrl = verified.thumbnail;
                    post.mediaUrls = verified.thumbnail;
                    post.media_type = "Video";
                    post.mediaType = "Video";
                } else {
                    post._invalidAuthor = true;
                }
            }
            return post;
        }

        // Always parse shortcode for Instagram posts
        if (platform === 'Instagram') {
            const scMatch = postUrl.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
            if (scMatch && scMatch[1]) {
                if (isInstagramBundleHash(scMatch[1])) {
                    post._invalidAuthor = true;
                    return post;
                }
                post.shortcode = scMatch[1];
            }
        }

        // Auto-extract lookaside thumbnail for Facebook photo posts
        if (platform === 'Facebook') {
            const fbPhotoMatch = postUrl.match(/(?:fbid=|\/photos\/(?:[^\/]+\/)?|\/photo\/?\?fbid=|\bmedia_id=)(\d{8,25})/i);
            if (fbPhotoMatch && fbPhotoMatch[1] && (!post.thumbnail || post.thumbnail.includes('favicon'))) {
                const fbThumb = `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${fbPhotoMatch[1]}`;
                post.thumbnail = fbThumb;
                post.thumbnail_url = fbThumb;
                post.media_url = fbThumb;
                post.mediaUrl = fbThumb;
                post.mediaUrls = fbThumb;
                post.media_type = "Image";
                post.mediaType = "Image";
            }
        }

        try {
            const headers = (platform === 'Instagram' || platform === 'Facebook') ? {
                'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            } : {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            };

            const res = await axios.get(postUrl, { headers, timeout: 6000 }).catch(() => null);
            if (!res || !res.data) {
                // If direct scrape timed out or failed, ensure fallback thumbnail for Instagram
                if (platform === 'Instagram' && post.shortcode && !isInstagramBundleHash(post.shortcode) && !post.thumbnail) {
                    const igThumb = `https://www.instagram.com/p/${post.shortcode}/media/?size=l`;
                    post.thumbnail = igThumb;
                    post.thumbnail_url = igThumb;
                    post.media_url = igThumb;
                    post.mediaUrl = igThumb;
                    post.mediaUrls = igThumb;
                }
                return post;
            }

            const $ = cheerio.load(res.data);
            let ogTitle = $("meta[property=\"og:title\"]").attr("content") || $("meta[name=\"twitter:title\"]").attr("content") || "";
            let ogDesc = $("meta[property=\"og:description\"]").attr("content") || $("meta[name=\"description\"]").attr("content") || $("meta[name=\"twitter:description\"]").attr("content") || "";
            const ogImg = $("meta[property=\"og:image\"]").attr("content") || $("meta[name=\"og:image\"]").attr("content") || $("meta[name=\"twitter:image\"]").attr("content") || "";

            // Ignore login page / generic boilerplate in ogTitle and ogDesc
            const isBoilerplateText = (txt: string) => {
                if (!txt) return true;
                const lower = txt.toLowerCase();
                return lower.includes('welcome back to instagram') ||
                       lower.includes('sign in to check out') ||
                       lower.includes('log in to see photos') ||
                       lower.includes('no photo description available') ||
                       lower.includes('may be an image of') ||
                       lower.includes('see posts, photos and more on facebook') ||
                       lower.includes('log into facebook') ||
                       lower.includes('see more posts') ||
                       lower.includes('merriam-webster') ||
                       lower.includes('dictionary.com') ||
                       lower === 'instagram' ||
                       lower === 'facebook';
            };

            if (isBoilerplateText(ogTitle)) ogTitle = "";
            if (isBoilerplateText(ogDesc)) ogDesc = "";

            let extractedCaption = "";

            let igAuthorHandle = "";
            let igAuthorName = "";

            // 1. Instagram structured OpenGraph regex extraction
            if (platform === 'Instagram' && ogDesc) {
                const igMatch = ogDesc.match(/^([\d,kK]+)\s*likes,\s*([\d,kK]+)\s*comments\s*-\s*([^\s:]+)(?:\s+on\s+([A-Za-z]+\s+\d{1,2},\s*\d{4}))?:\s*["“]([\s\S]*?)["”]?\s*$/);
                if (igMatch) {
                    igAuthorHandle = igMatch[3] || "";
                    post.engagement = {
                        likes: igMatch[1],
                        comments: igMatch[2]
                    };
                    post.likes = igMatch[1];
                    post.comments = igMatch[2];
                    if (igMatch[4]) {
                        try {
                            const parsedD = new Date(igMatch[4]);
                            if (!isNaN(parsedD.getTime())) {
                                post.date = parsedD.toISOString().split('T')[0];
                                post.published_date = post.date;
                                post.timestamp = post.date;
                            }
                        } catch(e) {}
                    }
                    if (igMatch[5]) {
                        extractedCaption = SocialExtractorAgent.cleanSocialCaption(igMatch[5], 'Instagram');
                    }
                }
            }
            if (platform === 'Instagram' && ogTitle) {
                const igTitleM = ogTitle.match(/^(.*?)\s+on Instagram:/i);
                if (igTitleM && igTitleM[1]) {
                    igAuthorName = igTitleM[1].trim();
                }
            }

            if (!extractedCaption) {
                if (ogDesc) {
                    const match = ogDesc.match(/: ["“](.*?)["”]?$/s) || ogDesc.match(/: (.*)$/s);
                    if (match && match[1]) {
                        extractedCaption = match[1].replace(/["”]$/, "").trim();
                    } else {
                        extractedCaption = ogDesc.trim();
                    }
                }
                if ((!extractedCaption || extractedCaption.length < 15) && ogTitle) {
                    const match = ogTitle.match(/: ["“](.*?)["”]?$/s) || ogTitle.match(/: (.*)$/s);
                    if (match && match[1]) {
                        extractedCaption = match[1].replace(/["”]$/, "").trim();
                    } else {
                        extractedCaption = ogTitle.trim();
                    }
                }
            }

            extractedCaption = SocialExtractorAgent.cleanSocialCaption(extractedCaption, platform);

            const compName = post.company || post.competitorName || 'Competitor';
            const verifiedProfile = post.profile_url || post.profileUrl || null;

            // Strict Post Authorship Verification
            if (post.isDirectProfilePost) {
                // Post was scraped directly from the competitor's verified profile page; author authenticity is guaranteed.
            } else if (platform === 'Instagram' && (igAuthorHandle || igAuthorName)) {
                const isAuthorValid = verifyPostAuthor('Instagram', {
                    authorHandle: igAuthorHandle,
                    authorName: igAuthorName,
                    postUrl,
                    ogTitle,
                    ogDesc
                }, compName, verifiedProfile);

                if (!isAuthorValid) {
                    console.log(`[SocialExtractorAgent] Instagram author mismatch: handle="${igAuthorHandle}", name="${igAuthorName}" does not match competitor "${compName}" for ${postUrl}. Discarding.`);
                    post._invalidAuthor = true;
                    return post;
                }
            } else if (platform === 'Facebook') {
                const isAuthorValid = verifyPostAuthor('Facebook', {
                    postUrl,
                    ogTitle,
                    ogDesc
                }, compName, verifiedProfile);

                if (!isAuthorValid) {
                    console.log(`[SocialExtractorAgent] Facebook author mismatch: ogTitle="${ogTitle}" does not match competitor "${compName}" for ${postUrl}. Discarding.`);
                    post._invalidAuthor = true;
                    return post;
                }
            } else if (platform === 'LinkedIn') {
                const isAuthorValid = verifyPostAuthor('LinkedIn', {
                    postUrl,
                    ogTitle,
                    ogDesc
                }, compName, verifiedProfile);

                if (!isAuthorValid) {
                    console.log(`[SocialExtractorAgent] LinkedIn author mismatch for competitor "${compName}" on ${postUrl}. Discarding.`);
                    post._invalidAuthor = true;
                    return post;
                }
            }

            const hasBoilerplate = (cap: string) => {
                if (!cap) return true;
                const lower = cap.toLowerCase();
                return lower.includes('log in') || lower.includes('sign up') || lower.includes('profile picture') ||
                       lower.includes('start the conversation') || lower.includes('never miss a post') ||
                       lower.includes('welcome back to instagram') || lower.includes('sign in to check out') ||
                       lower.includes('no photo description available') ||
                       lower.includes('may be an image') || lower.includes('photo by ') || lower.includes('video by ') ||
                       lower.includes('see posts, photos and more on facebook') ||
                       lower.includes('log into facebook') ||
                       lower.includes('see more posts') ||
                       lower.includes('merriam-webster') ||
                       lower.includes('dictionary.com');
            };

            const getCleanFallbackTitle = () => {
                let slugTitle = "";
                const slugMatch = postUrl.match(/\/(?:videos|posts|reel)\/([a-zA-Z0-9_-]{10,})/i);
                if (slugMatch && slugMatch[1] && !/^\d+$/.test(slugMatch[1])) {
                    slugTitle = slugMatch[1].replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
                    if (slugTitle.length > 5) {
                        slugTitle = slugTitle.charAt(0).toUpperCase() + slugTitle.slice(1);
                    }
                }
                if (slugTitle) return slugTitle;
                return platform === 'Instagram' ? `${compName} - Instagram ${postUrl.includes('/reel/') ? 'Reel' : 'Post'}` : (platform === 'Facebook' ? `${compName} - Facebook Update` : `${compName} - ${platform}`);
            };

            if (extractedCaption && !hasBoilerplate(extractedCaption) && (hasBoilerplate(post.caption) || extractedCaption.length > (post.caption ? post.caption.length : 0))) {
                post.caption = extractedCaption;
                post.content = extractedCaption;
            } else if (post.caption) {
                post.caption = SocialExtractorAgent.cleanSocialCaption(post.caption, platform);
                if (hasBoilerplate(post.caption) || !post.caption) {
                    post.caption = getCleanFallbackTitle();
                }
                post.content = post.caption;
            } else {
                post.caption = getCleanFallbackTitle();
                post.content = post.caption;
            }

            const isAeroOrPlaceholder = !ogImg ||
                ogImg.includes("static/images") ||
                ogImg.includes("profile_pic") ||
                ogImg.includes("profile_photo") ||
                ogImg.includes("avatar") ||
                ogImg.includes("favicon") ||
                ogImg.includes("static.licdn.com") ||
                ogImg.includes("aero-v1") ||
                ogImg.includes("c45fy346jw096z9pbphyyhdz7");

            if (ogImg && ogImg.startsWith("http") && !isAeroOrPlaceholder) {
                post.thumbnail = ogImg;
                post.thumbnail_url = ogImg;
                post.media_url = ogImg;
                post.mediaUrl = ogImg;
                post.mediaUrls = ogImg;
                if (!post.media_type || post.media_type === "Text") {
                    post.media_type = (postUrl.includes('/reel/') || postUrl.includes('/videos/') || postUrl.includes('/watch')) ? "Video" : "Image";
                    post.mediaType = post.media_type;
                }
            } else if (!post.thumbnail || post.thumbnail.includes('favicon') || isAeroOrPlaceholder) {
                if (platform === 'Facebook') {
                    if (postUrl.includes('/videos/') || postUrl.includes('/reel/') || postUrl.includes('/watch')) {
                        post.media_type = "Video";
                        post.mediaType = "Video";
                    }
                    const fbIdMatch = postUrl.match(/(?:fbid=|\/photos\/(?:[^\/]+\/)?|\/photo\/?\?fbid=|\bmedia_id=)(\d{8,25})/);
                    if (fbIdMatch && fbIdMatch[1]) {
                        const fbThumb = `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${fbIdMatch[1]}`;
                        post.thumbnail = fbThumb;
                        post.thumbnail_url = fbThumb;
                        post.media_url = fbThumb;
                        post.mediaUrl = fbThumb;
                        post.mediaUrls = fbThumb;
                    }
                } else if (platform === 'Instagram') {
                    const scMatch = post.shortcode || (postUrl.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
                    if (scMatch && !isInstagramBundleHash(scMatch)) {
                        post.shortcode = scMatch;
                        const igThumb = `https://www.instagram.com/p/${scMatch}/media/?size=l`;
                        post.thumbnail = igThumb;
                        post.thumbnail_url = igThumb;
                        post.media_url = igThumb;
                        post.mediaUrl = igThumb;
                        post.mediaUrls = igThumb;
                    }
                }
            }

            // Check for direct MP4 video streams on Instagram and Facebook
            const mp4Regex = /https:[\\/]+[a-zA-Z0-9._-]+(?:fbcdn\.net|fbsbx\.com)[\\/]+[^\s"']+\.mp4[^\s"']*/g;
            const mp4Matches = (res.data || '').match(mp4Regex) || [];
            if (mp4Matches.length > 0) {
                let cleanMp4 = mp4Matches[0].replace(/\\\/|\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
                cleanMp4 = cleanMp4.split('<')[0].split('\\')[0].split('"')[0];
                post.video_url = cleanMp4;
                post.media_type = "Video";
                post.mediaType = "Video";
            }

            if (platform === 'Instagram') {
                const scMatch = postUrl.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
                if (scMatch && scMatch[1]) {
                    post.shortcode = scMatch[1];
                }
            } else if (platform === 'LinkedIn') {
                const actMatch = postUrl.match(/(?:activity-|activity:|ugcPost:|share:)(\d+)/);
                if (actMatch && actMatch[1]) {
                    post.activity_id = actMatch[1];
                    try {
                        const embedRes = await axios.get(`https://www.linkedin.com/embed/feed/update/urn:li:activity:${actMatch[1]}`, {
                            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                            timeout: 5000
                        }).catch(() => null);
                        if (embedRes && embedRes.data) {
                            const $li = cheerio.load(embedRes.data);
                            const rawSources = $li('video').attr('data-sources');
                            if (rawSources) {
                                const parsed = JSON.parse(rawSources);
                                const best = parsed.find((s: any) => s.src && s.src.includes('720p')) || parsed[0];
                                if (best && best.src) {
                                    post.video_url = best.src;
                                    post.media_type = "Video";
                                    post.mediaType = "Video";
                                }
                            }
                        }
                    } catch(e) {}
                }
            } else if (platform === 'Facebook') {
                if (postUrl.includes('/videos/') || postUrl.includes('/reel/')) {
                    post.media_type = "Video";
                    post.mediaType = "Video";
                    const idMatch = postUrl.match(/(?:\/videos\/(?:[^\/]+\/)?|\/reel\/|\/watch\/?\?v=)(\d+)/) || postUrl.match(/(\d{10,20})/);
                    if (idMatch && idMatch[1]) {
                        post.fb_video_id = idMatch[1];
                        try {
                            const pluginUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent('https://www.facebook.com/watch/?v=' + idMatch[1])}&show_text=false&width=500`;
                            const fbPluginRes = await axios.get(pluginUrl, {
                                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                                timeout: 5000
                            }).catch(() => null);
                            if (fbPluginRes && fbPluginRes.data) {
                                const re = /(https:[^"'<>\s]+?\.mp4[^"'<>\s]*)/gi;
                                let m;
                                while ((m = re.exec(fbPluginRes.data)) !== null) {
                                    let clean = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                                    if (!clean.includes('rsrc.php') && clean.includes('video.')) {
                                        post.video_url = clean;
                                        break;
                                    }
                                }
                            }
                        } catch(e) {}
                    }
                }
            }

            const likeMatch = ogDesc.match(/([\d,kK]+)\s*likes/i);
            const commentMatch = ogDesc.match(/([\d,kK]+)\s*comments/i);
            if (likeMatch || commentMatch) {
                post.engagement = {
                    likes: likeMatch ? likeMatch[1] : (post.engagement?.likes || "0"),
                    comments: commentMatch ? commentMatch[1] : (post.engagement?.comments || "0")
                };
                post.likes = post.engagement.likes;
                post.comments = post.engagement.comments;
            }
        } catch (e: any) {
            // Ignore enrichment errors
        }

        return post;
    }

    // Lightweight profile-bio reader used to verify an Instagram account belongs to the
    // target industry (guards against mis-attributing a same-named account in another
    // vertical, e.g. a gym named "Forge Performance"). Self-contained: inits + closes the browser.
    public async fetchInstagramBio(handle: string): Promise<string> {
        const cleanHandle = handle.replace(/^@/, "").replace(/\/+$/, "");
        if (process.env.ENABLE_BROWSER_SCRAPING !== "true") {
            return "";
        }
        try {
            await this.initBrowser("Instagram");
            await this.driver!.get(`https://www.instagram.com/${cleanHandle}/`);
            await this.driver!.sleep(6000);
            // Grab the full profile header text (name, handle, category line, bio). The category line
            // (e.g. "Gym/Physical Fitness Center" vs "Industrial Company") is a strong industry signal
            // that survives class-name churn. Fall back to og:description only if no header exists.
            const headerText = await this.driver!.executeScript(`
                const header = document.querySelector('main header');
                if (header && header.textContent && header.textContent.trim().length > 5) {
                    return header.textContent.trim();
                }
                const metaDesc = document.querySelector('meta[property="og:description"]');
                if (metaDesc && metaDesc.content && metaDesc.content.length > 5) {
                    return metaDesc.content;
                }
                return "";
            `);
            return String(headerText || "") as string;
        } catch (e: any) {
            console.log(`[SocialExtractorAgent] fetchInstagramBio failed for ${cleanHandle}: ${e.message}`);
            return "";
        } finally {
            await this.closeBrowser();
        }
    }

    // Checks whether an Instagram account has been active. Profile grid tiles carry no timestamps, so
    // we read the newest post link, open that single post and return the age of its `time datetime`.
    // Returns checked=false when no post can be inspected (e.g. login wall / private / empty) so
    // callers treat it as "unknown".
    public async fetchInstagramLastActivity(handle: string): Promise<{ checked: boolean; lastPostDays: number | null }> {
        const cleanHandle = handle.replace(/^@/, "").replace(/\/+$/, "");
        if (process.env.ENABLE_BROWSER_SCRAPING !== "true") {
            return { checked: false, lastPostDays: null };
        }
        try {
            await this.initBrowser("Instagram");
            await this.driver!.get(`https://www.instagram.com/${cleanHandle}/`);
            await this.driver!.sleep(5000);

            const firstPost = String(await this.driver!.executeScript(`
                const links = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
                return links.length > 0 ? links[0].getAttribute('href') : "";
            `) || "");
            if (!firstPost) return { checked: false, lastPostDays: null };

            await this.driver!.get(`https://www.instagram.com${firstPost.startsWith("http") ? "" : firstPost}`);
            await this.driver!.sleep(3000);

            const datetimes = await this.driver!.executeScript(`
                const times = Array.from(document.querySelectorAll('time[datetime], time[title]'));
                const vals = times.map(t => t.getAttribute('datetime') || t.getAttribute('title') || '').filter(Boolean);
                return vals;
            `);
            const now = Date.now();
            let maxDays: number | null = null;
            for (const v of (datetimes as string[])) {
                const t = Date.parse(v.replace(/\s*,\s*.*$/, ""));
                if (!isNaN(t)) {
                    const d = (now - t) / 86400000;
                    if (maxDays === null || d < maxDays) maxDays = d;
                }
            }
            return { checked: maxDays !== null, lastPostDays: maxDays };
        } catch (e: any) {
            console.log(`[SocialExtractorAgent] fetchInstagramLastActivity failed for ${cleanHandle}: ${e.message}`);
            return { checked: false, lastPostDays: null };
        } finally {
            await this.closeBrowser();
        }
    }

    private async extractInstagram(profileUrl: string): Promise<any> {
        if (!this.driver) throw new Error("Driver not initialized");        
        
        const cleanProfileHandle = profileUrl.split('instagram.com/')[1]?.split('/')[0]?.split('?')[0]?.toLowerCase();

        await this.driver.get(profileUrl);
        await this.driver.sleep(1200); // Wait for SPA to load
        
        let postUrls: string[] = [profileUrl]; // Default to profileUrl if it's direct
        
        if (!profileUrl.includes('/p/') && !profileUrl.includes('/reel/')) {
            try {
                await this.driver.wait(
                    until.elementLocated(By.css('main a[href*="/p/"], main a[href*="/reel/"], a[href*="/p/"], a[href*="/reel/"]')), 
                    10000
                );

                // Progressive scroll to load up to 20 post grid anchors
                for (let s = 0; s < 5; s++) {
                    await this.driver.executeScript('window.scrollBy(0, 1000);').catch(() => {});
                    await this.driver.sleep(1200);
                }
                
                const urls: string[] = await this.driver.executeScript(`
                    const main = document.querySelector('main');
                    const links = main ? Array.from(main.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) : Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
                    return links.map(a => a.href).slice(0, 20);
                `);
                
                if (urls && urls.length > 0) {
                    postUrls = urls;
                } else {
                    throw new Error("Could not find post URLs on Instagram page");
                }
            } catch (e) {
                const isPrivateText = await this.driver.executeScript(`
                    return Array.from(document.querySelectorAll('*')).some(el => {
                        const txt = el.textContent ? el.textContent.toLowerCase() : "";
                        return txt.includes('this account is private');
                    });
                `);
                if (isPrivateText) throw new Error("PRIVATE_ACCOUNT");
                
                throw new Error("Could not locate any post grid on this Instagram profile.");
            }
        }
        
        const results = [];
        
        for (const postUrl of postUrls) {
            await this.driver.get(postUrl);
            await this.driver.sleep(2000);
            
            const data: any = await this.driver.executeScript(`
                // Extract author handle from header if present
                let authorHandle = "";
                const headerAnchor = document.querySelector('header a[href^="/"], article header a[href^="/"], main header a[href^="/"]');
                if (headerAnchor) {
                    authorHandle = (headerAnchor.getAttribute('href') || "").replace(/\\//g, "").trim();
                }

                // Check for private account
                const isPrivateText = Array.from(document.querySelectorAll('*')).some(el => {
                    const txt = el.textContent ? el.textContent.toLowerCase() : "";
                    return txt.includes('this account is private');
                });
                if (isPrivateText) return { isPrivate: true };

                // Look for time tag
                let timestamp = "";
                const timeEl = document.querySelector('time');
                if (timeEl) timestamp = timeEl.getAttribute('datetime') || timeEl.textContent || "";
                
                // Find caption
                let caption = "";
                const ogTitle = document.querySelector('meta[property="og:title"]');
                if (ogTitle && ogTitle.content) {
                    caption = ogTitle.content;
                    if (caption.includes('on Instagram: "')) {
                        caption = caption.split('on Instagram: "')[1];
                        if (caption.endsWith('"')) caption = caption.slice(0, -1);
                    }
                }
                
                const lowerCap = caption.toLowerCase();
                if (lowerCap.includes('login • instagram') || lowerCap.includes('page not found') || lowerCap.includes('welcome back to instagram') || caption === 'Instagram') {
                    caption = "";
                }
                
                if (!caption || caption.length < 5) {
                    const textNodes = document.querySelectorAll('h1[dir="auto"], span[dir="auto"]');
                    for (let i = 0; i < textNodes.length; i++) {
                        const nodeText = textNodes[i].textContent || "";
                        if (nodeText.length > 20 && !nodeText.toLowerCase().includes('login') && !nodeText.toLowerCase().includes('sign up')) {
                            caption = nodeText.trim();
                            break;
                        }
                    }
                }
                
                // Media
                const isReel = window.location.href.includes('/reel/');
                let mediaType = isReel ? "Video" : "Image";
                let mediaUrls = "";
                
                if (document.querySelector('video') || isReel) {
                    mediaType = "Video";
                    const ogVideo = document.querySelector('meta[property="og:video"]');
                    if (ogVideo && ogVideo.content) {
                        mediaUrls = ogVideo.content;
                    } else {
                        const html = document.documentElement.innerHTML;
                        const startIndex = html.indexOf('"video_versions":');
                        if (startIndex !== -1) {
                            const arrayStart = html.indexOf('[', startIndex);
                            const arrayEnd = html.indexOf(']', arrayStart);
                            if (arrayStart !== -1 && arrayEnd !== -1) {
                                try {
                                    const versionsStr = html.substring(arrayStart, arrayEnd + 1);
                                    const versions = JSON.parse(versionsStr);
                                    if (versions && versions.length > 0) {
                                        mediaUrls = versions[0].url.replace(/\\\\u0026/g, '&');
                                    }
                                } catch (e) {}
                            }
                        }
                        
                        if (!mediaUrls) {
                            const vid = document.querySelector('video');
                            if (vid) {
                                mediaUrls = vid.getAttribute('src') || "";
                                if (mediaUrls.startsWith('blob:')) mediaUrls = "";
                                if (!mediaUrls) mediaUrls = vid.getAttribute('poster') || "";
                            }
                        }
                        
                        if (!mediaUrls || mediaUrls.startsWith('blob:')) {
                            const ogImg = document.querySelector('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]');
                            if (ogImg && ogImg.content) {
                                mediaUrls = ogImg.content;
                            }
                        }

                        if (!mediaUrls || mediaUrls.startsWith('blob:')) {
                            const img = document.querySelector('img[style*="object-fit: cover"]');
                            if (img) {
                                mediaUrls = img.getAttribute('src') || "";
                                mediaType = "Image";
                            }
                        }
                    }
                } else {
                    let imgs = Array.from(document.querySelectorAll('img[style*="object-fit: cover"]')).filter(img => {
                        const src = img.getAttribute('src') || "";
                        return src.includes('scontent') && !src.includes('p150x150');
                    });
                    
                    if (imgs.length === 0) {
                        imgs = Array.from(document.querySelectorAll('img')).filter(img => {
                            const alt = img.getAttribute('alt') || "";
                            const src = img.getAttribute('src') || "";
                            return src.includes('scontent') && !src.includes('p150x150') && !alt.toLowerCase().includes('profile picture') && !src.startsWith('data:') && !src.startsWith('blob:');
                        });
                    }
                    
                    if (imgs.length > 0) {
                        mediaType = imgs.length > 1 ? "Carousel" : "Image";
                        mediaUrls = imgs.map(img => img.getAttribute('src')).filter(Boolean).join(', ');
                    }
                }
                
                return {
                    authorHandle: authorHandle,
                    caption: caption,
                    timestamp: timestamp,
                    mediaType: mediaType,
                    mediaUrls: mediaUrls.startsWith('blob:') ? "" : mediaUrls,
                    likes: "Hidden",
                    comments: "Not extracted",
                    isReel: isReel,
                    postUrl: window.location.href
                };
            `);
            
            if (data && (data as any).isPrivate) {
                if (results.length === 0) {
                    throw new Error("PRIVATE_ACCOUNT");
                }
                break;
            }
            
            if (data) {
                const authorHandle = String((data as any).authorHandle || "").toLowerCase();
                if (cleanProfileHandle && authorHandle && authorHandle.length > 2) {
                    if (!cleanProfileHandle.includes(authorHandle) && !authorHandle.includes(cleanProfileHandle)) {
                        console.log(`[SocialExtractorAgent] Rejecting post ${(data as any).postUrl}: author handle (${authorHandle}) does not match target profile (${cleanProfileHandle})`);
                        continue;
                    }
                }
                results.push(data);
                if (results.length >= 20) break;
            }
        }
        
        results.sort((a, b) => {
            const parseTime = (dateStr?: string | null): number => {
                if (!dateStr) return 0;
                const t = new Date(dateStr).getTime();
                if (!isNaN(t)) return t;
                const str = String(dateStr).toLowerCase().trim();
                const now = Date.now();
                let m = str.match(/(\d+)\s*m/);
                if (m) return now - parseInt(m[1]) * 60 * 1000;
                m = str.match(/(\d+)\s*h/);
                if (m) return now - parseInt(m[1]) * 3600 * 1000;
                m = str.match(/(\d+)\s*d/);
                if (m) return now - parseInt(m[1]) * 86400 * 1000;
                m = str.match(/(\d+)\s*w/);
                if (m) return now - parseInt(m[1]) * 7 * 86400 * 1000;
                return 0;
            };
            return parseTime((b as any).timestamp) - parseTime((a as any).timestamp);
        });
        
        return results;
    }

    private async extractLinkedIn(profileUrl: string): Promise<any> {
        if (!this.driver) throw new Error("Driver not initialized");
        
        // Ensure URL goes to the root company page, unauthenticated posts tab is often broken
        const cleanUrl = profileUrl.split('/posts')[0];
        
        await this.driver.get(cleanUrl);
        await this.driver.sleep(3000); // Give it time to redirect if it's going to
        
        // Handle auth modal gracefully if present
        try {
            await this.driver.executeScript(`
                const dismissBtns = Array.from(document.querySelectorAll('button.modal__dismiss, button[aria-label="Dismiss"], button[data-tracking-control-name*="close"], .contextual-sign-in-modal__modal-dismiss'));
                dismissBtns.forEach(btn => btn.click());
            `);
        } catch (e) {}
        
        try {
            // Wait up to 15 seconds for ANY known post container to appear
            await this.driver.wait(
                until.elementLocated(By.css('.feed-shared-update-v2, [data-urn], article[data-id="main-feed-card"], .main-feed-activity-card')),
                15000
            );
        } catch (e) {
            // If it times out, we continue and let the executeScript handle the fallback
            await this.driver.sleep(2000); 
        }

        // Progressive scroll to load 10-20 LinkedIn posts
        for (let s = 0; s < 6; s++) {
            await this.driver.executeScript('window.scrollBy(0, 1000);').catch(() => {});
            await this.driver.sleep(1200);
        }
        
        const data = await this.driver.executeScript(`
            return (function() {
                var modalClose = document.querySelector('button.modal__dismiss, button[aria-label="Dismiss"], button.contextual-sign-in-modal__modal-dismiss');
                if (modalClose) modalClose.click();
                
                var isPrivateText = document.body && document.body.innerText ? document.body.innerText.toLowerCase().indexOf('this profile is not available') !== -1 : false;
                if (isPrivateText) return { isPrivate: true };
                
                var posts = document.querySelectorAll('.feed-shared-update-v2, [data-urn], article[data-id="main-feed-card"], .main-feed-activity-card, li.updates-list__item, article');
                if (!posts || posts.length === 0) return null;
                
                var results = [];
                var maxPosts = Math.min(posts.length, 20);
                
                for (var i = 0; i < maxPosts; i++) {
                    var post = posts[i];
                    try {
                        var seeMore = post.querySelector('.see-more, button[data-test-id="see-more-button"]');
                        if (seeMore) seeMore.click();
                    } catch(e) {}
                    
                    var capEl = post.querySelector('.feed-shared-update-v2__description-wrapper, .update-components-text, .attributed-text-segment-list__content, p[data-test-id="main-feed-activity-card__commentary"], .break-words');
                    var caption = capEl && capEl.textContent ? capEl.textContent.trim() : (post.textContent ? post.textContent.substring(0, 500).trim() : "LinkedIn Post");
                    
                    var timeEl = post.querySelector('.update-components-actor__sub-description, .feed-shared-actor__sub-description, time');
                    var timestamp = timeEl && timeEl.textContent ? timeEl.textContent.trim() : "Recent";
                    
                    var likeEl = post.querySelector('.social-details-social-counts__reactions-count, [data-test-id="social-actions__reaction-count"]');
                    var likes = likeEl && likeEl.textContent ? likeEl.textContent.trim() : "0";
                    
                    var comEl = post.querySelector('.social-details-social-counts__comments');
                    var comments = comEl && comEl.textContent ? comEl.textContent.trim() : "0";
                    
                    var mediaType = "Text";
                    var mediaUrls = "";
                    var hasVideoContainer = post.querySelector('video, .update-components-linkedin-video__poster, [data-test-id*="video"], .feed-shared-linkedin-video');
                    if (hasVideoContainer) {
                        mediaType = "Video";
                        var vid = post.querySelector('video');
                        var src = vid ? (vid.getAttribute('src') || "") : "";
                        if (src.indexOf('blob:') === 0) src = "";
                        mediaUrls = src || (vid ? (vid.getAttribute('poster') || "") : "");
                        if (!mediaUrls || mediaUrls.indexOf('blob:') === 0) {
                             var vImg = post.querySelector('img.update-components-linkedin-video__poster, img.update-components-image__image, img');
                             if (vImg) mediaUrls = vImg.getAttribute('data-delayed-url') || vImg.getAttribute('src') || "";
                        }
                    } else if (post.querySelector('img')) {
                        var imgs = Array.prototype.slice.call(post.querySelectorAll('img.update-components-image__image, ul[data-test-id="feed-images-content"] img, [data-test-id="feed-images-content__list-item"] img, img.ivm-view-attr__img--centered, img'));
                        var validImgs = [];
                        for (var k = 0; k < imgs.length; k++) {
                            var s = imgs[k].getAttribute('data-delayed-url') || imgs[k].getAttribute('src') || "";
                            if (s.length > 20 && s.indexOf('data:') !== 0 && s.indexOf('blob:') !== 0 && s.indexOf('profile') === -1 && s.indexOf('static.licdn.com') === -1 && s.indexOf('aero-v1') === -1) {
                                validImgs.push(s);
                            }
                        }
                        if (validImgs.length > 0) {
                            var isVidMedia = validImgs.some(function(url) {
                                return url.indexOf('/playlist/vid/') !== -1 || url.indexOf('thumbnail-with-play-button') !== -1;
                            });
                            mediaType = isVidMedia ? "Video" : (validImgs.length > 1 ? "Carousel" : "Image");
                            mediaUrls = validImgs.join(', ');
                        }
                    }
                    
                    var postUrl = "";
                    var urn = post.getAttribute('data-activity-urn') || post.getAttribute('data-urn');
                    if (urn) {
                        postUrl = "https://www.linkedin.com/feed/update/" + urn + "/";
                    } else {
                        var links = post.querySelectorAll('a[href*="/activity/"], a[href*="/posts/"], a.main-feed-card__overlay-link');
                        if (links.length > 0) {
                            postUrl = links[0].getAttribute('href') || "";
                        }
                        if (postUrl.indexOf('/') === 0) {
                            postUrl = "https://www.linkedin.com" + postUrl;
                        }
                        if (!postUrl) {
                            postUrl = window.location.href + "#post-" + (i + 1);
                        }
                    }
                    
                    results.push({
                        caption: caption,
                        timestamp: timestamp,
                        mediaType: mediaType,
                        mediaUrls: mediaUrls,
                        likes: likes,
                        comments: comments,
                        postUrl: postUrl
                    });
                }
                
                return results;
            })();
        `);
        
        if (data && (data as any).isPrivate) {
            throw new Error("PRIVATE_ACCOUNT");
        }
        
        if (!data) {
            throw new Error("Could not locate any posts on the LinkedIn page.");
        }
        
        return data;
    }

    private async extractFacebook(profileUrl: string): Promise<any> {
        if (!this.driver) throw new Error("Driver not initialized");
        
        await this.driver.get(profileUrl);
        
        try {
            // Wait up to 15 seconds for a post container to appear
            await this.driver.wait(
                until.elementLocated(By.css('div[role="article"]')),
                15000
            );
        } catch (e) {
            await this.driver.sleep(2000); 
        }
        
        // Dismiss login modal if present
        await this.driver.executeScript(`
            (function() {
                var modalClose = document.querySelector('div[aria-label="Close"]');
                if (modalClose) modalClose.click();
            })();
        `).catch(() => {});
        
        // Expand 'See more' before extracting to prevent truncated captions
        await this.driver.executeScript(`
            (function() {
                var firstPost = document.querySelector('div[role="article"]');
                if (firstPost) {
                    var buttons = firstPost.querySelectorAll('div[role="button"]');
                    for (var i = 0; i < buttons.length; i++) {
                        var btn = buttons[i];
                        if (btn.textContent && btn.textContent.toLowerCase().includes('see more')) {
                            btn.click();
                            break;
                        }
                    }
                }
            })();
        `).catch(() => {});
        
        // Progressive scrolling to load 10-20 Facebook posts
        for (let s = 0; s < 6; s++) {
            await this.driver.executeScript('window.scrollBy(0, 1000);').catch(() => {});
            await this.driver.sleep(1200);
        }

        const data = await this.driver.executeScript(`
            return (function() {
                var text = (document.body && document.body.innerText) ? document.body.innerText.toLowerCase() : "";
                if (text.indexOf("content isn't available") !== -1) return { isPrivate: true };
                
                var timelineUnits = Array.prototype.slice.call(document.querySelectorAll('div[data-pagelet*="TimelineFeedUnit"], div[data-pagelet*="ProfileTimeline"]'));
                var posts = [];
                if (timelineUnits.length > 0) {
                    for (var t = 0; t < timelineUnits.length; t++) {
                        var arts = Array.prototype.slice.call(timelineUnits[t].querySelectorAll('div[role="article"]'));
                        for (var a = 0; a < arts.length; a++) posts.push(arts[a]);
                    }
                }
                if (posts.length === 0) {
                    posts = Array.prototype.slice.call(document.querySelectorAll('div[role="article"]'));
                }
                if (!posts || posts.length === 0) return null;
                
                var results = [];
                var processedLinks = {};
                
                for (var i = 0; i < posts.length; i++) {
                    if (results.length >= 20) break;
                    
                    var post = posts[i];
                    
                    // Exclude any post container located inside header, cover photo, actions, tabs, or intro card
                    var ancestorPagelet = post.closest('[data-pagelet]');
                    var ancestorName = ancestorPagelet ? (ancestorPagelet.getAttribute('data-pagelet') || "").toLowerCase() : "";
                    if (ancestorName.indexOf('header') !== -1 || ancestorName.indexOf('intro') !== -1 || ancestorName.indexOf('cover') !== -1 || ancestorName.indexOf('actions') !== -1 || ancestorName.indexOf('tabs') !== -1 || ancestorName.indexOf('tilesfeed') !== -1) {
                        continue;
                    }
                    var postUrl = "";
                    var timestamp = "Recent";
                    var pageUrl = window.location.href.split('?')[0].replace(/\\/$/, '');
                    var anchors = Array.prototype.slice.call(post.querySelectorAll('a'));
                    
                    var permalinkAnchor = null;
                    for (var j = 0; j < anchors.length; j++) {
                        var href = (anchors[j].getAttribute('href') || "").toLowerCase();
                        if (href.indexOf('/posts/') !== -1 || href.indexOf('fbid=') !== -1 || href.indexOf('story_fbid=') !== -1 || href.indexOf('pfbid') !== -1 || href.indexOf('/videos/') !== -1 || href.indexOf('/reel/') !== -1 || href.indexOf('/photo') !== -1 || href.indexOf('/photos/') !== -1 || href.indexOf('story.php') !== -1 || href.indexOf('permalink') !== -1 || href.indexOf('/share/p/') !== -1 || href.indexOf('/share/v/') !== -1 || href.indexOf('/share/r/') !== -1 || href.indexOf('/watch') !== -1) {
                            permalinkAnchor = anchors[j];
                            break;
                        }
                    }
                    
                    if (!permalinkAnchor) {
                        for (var j = 0; j < anchors.length; j++) {
                            var h = anchors[j].getAttribute('href') || "";
                            if (!h || h === '#' || h.indexOf('javascript:') === 0) continue;
                            var full = h.indexOf('/') === 0 ? ("https://www.facebook.com" + h) : h;
                            var cleanFull = full.split('?')[0].replace(/\\/$/, '');
                            if (cleanFull !== pageUrl && cleanFull.indexOf('/about') === -1 && cleanFull.indexOf('/photos') === -1 && cleanFull.indexOf('/videos') === -1) {
                                permalinkAnchor = anchors[j];
                                break;
                            }
                        }
                    }
                    
                    if (permalinkAnchor) {
                        postUrl = permalinkAnchor.getAttribute('href') || "";
                        if (permalinkAnchor.textContent && permalinkAnchor.textContent.trim().length > 0) {
                            timestamp = permalinkAnchor.textContent.trim();
                        }
                    }
                    
                    if (postUrl.indexOf('/') === 0) {
                        postUrl = "https://www.facebook.com" + postUrl;
                    }
                    if (!postUrl || postUrl === window.location.href) {
                        postUrl = window.location.href + "#post-" + (i + 1);
                    }
                    
                    if (processedLinks[postUrl]) continue;
                    processedLinks[postUrl] = true;
                    
                    var caption = "";
                    var capEl = post.querySelector('div[data-ad-comet-preview="message"]');
                    if (capEl) {
                        caption = capEl.textContent.trim();
                    } else {
                        var autoEls = post.querySelectorAll('div[dir="auto"]');
                        for (var k = 0; k < autoEls.length; k++) {
                            var txt = autoEls[k].textContent.trim();
                            if (txt.length > 10 && txt.toLowerCase().indexOf('like') === -1 && txt.toLowerCase().indexOf('comment') === -1 && txt.toLowerCase().indexOf('share') === -1) { 
                                caption = txt;
                                break;
                            }
                        }
                    }
                    if (!caption) caption = "Facebook Social Activity Post";
                    
                    var likeEl = post.querySelector('span.x1e558r4');
                    var likes = likeEl && likeEl.textContent ? likeEl.textContent.trim() : "0";
                    
                    var fbIsVideo = postUrl.indexOf('/videos/') !== -1 || postUrl.indexOf('/reel/') !== -1 || postUrl.indexOf('/watch') !== -1;
                    var mediaType = fbIsVideo ? "Video" : "Text";
                    var mediaUrls = "";
                    
                    if (post.querySelector('video') || fbIsVideo) {
                        mediaType = "Video";
                        var vid = post.querySelector('video');
                        if (vid) {
                            mediaUrls = vid.getAttribute('src') || "";
                            if (mediaUrls.indexOf('blob:') === 0) mediaUrls = "";
                            if (!mediaUrls) mediaUrls = vid.getAttribute('poster') || "";
                        }
                        
                        var isProfileOrBanner = function(imgEl, urlStr) {
                            if (!urlStr || typeof urlStr !== 'string') return true;
                            var lower = urlStr.toLowerCase();
                            var alt = (imgEl.getAttribute('alt') || '').toLowerCase();
                            
                            // Wide banner aspect ratio check (cstp=mxWxH)
                            var cstpMatch = lower.match(/cstp=mx(\d+)x(\d+)/);
                            if (cstpMatch && cstpMatch[1] && cstpMatch[2]) {
                                var w = parseInt(cstpMatch[1], 10);
                                var h = parseInt(cstpMatch[2], 10);
                                if (w > 0 && h > 0 && (w / h > 2.1)) {
                                    return true;
                                }
                            }

                            if (lower.indexOf('p100x100') !== -1 || lower.indexOf('p200x200') !== -1 || lower.indexOf('p50x50') !== -1 || 
                                lower.indexOf('p36x36') !== -1 || lower.indexOf('p75x75') !== -1 || lower.indexOf('p160x160') !== -1 || 
                                lower.indexOf('p320x320') !== -1 || lower.indexOf('s100x100') !== -1 || lower.indexOf('s200x200') !== -1 || 
                                lower.indexOf('s50x50') !== -1 || lower.indexOf('s36x36') !== -1 || lower.indexOf('s75x75') !== -1 || 
                                lower.indexOf('profile_pic') !== -1 || lower.indexOf('profile_photo') !== -1 || lower.indexOf('avatar') !== -1 || 
                                lower.indexOf('cover_photo') !== -1 || lower.indexOf('profile_cover') !== -1 || lower.indexOf('banner') !== -1 || 
                                lower.indexOf('header') !== -1 || lower.indexOf('rsrc.php') !== -1 || lower.indexOf('emoji') !== -1) {
                                return true;
                            }
                            
                            if (alt.indexOf('profile picture') !== -1 || alt.indexOf('profile photo') !== -1 || alt.indexOf('cover photo') !== -1 || 
                                alt.indexOf('banner') !== -1 || alt.indexOf('logo') !== -1) {
                                return true;
                            }
                            
                            var parentHeader = imgEl.closest('header, div[aria-label*="Profile"], div[aria-label*="profile"], div[aria-label*="Cover"]');
                            if (parentHeader) return true;
                            
                            return false;
                        };

                        if (!mediaUrls || mediaUrls.indexOf('blob:') === 0) {
                            var imgs = Array.prototype.slice.call(post.querySelectorAll('img'));
                            for (var m = 0; m < imgs.length; m++) {
                                var src = imgs[m].getAttribute('data-src') || imgs[m].getAttribute('src') || "";
                                if (!isProfileOrBanner(imgs[m], src) && src.indexOf('data:') !== 0 && src.indexOf('blob:') !== 0 && src.length > 20) {
                                    mediaUrls = src;
                                    break;
                                }
                            }
                        }
                    } else if (post.querySelector('img')) {
                        var isProfileOrBanner = function(imgEl, urlStr) {
                            if (!urlStr || typeof urlStr !== 'string') return true;
                            var lower = urlStr.toLowerCase();
                            var alt = (imgEl.getAttribute('alt') || '').toLowerCase();
                            
                            if (lower.indexOf('p100x100') !== -1 || lower.indexOf('p200x200') !== -1 || lower.indexOf('p50x50') !== -1 || 
                                lower.indexOf('p36x36') !== -1 || lower.indexOf('p75x75') !== -1 || lower.indexOf('p160x160') !== -1 || 
                                lower.indexOf('p320x320') !== -1 || lower.indexOf('s100x100') !== -1 || lower.indexOf('s200x200') !== -1 || 
                                lower.indexOf('s50x50') !== -1 || lower.indexOf('s36x36') !== -1 || lower.indexOf('s75x75') !== -1 || 
                                lower.indexOf('s160x160') !== -1 || lower.indexOf('s320x320') !== -1 || lower.indexOf('s480x480') !== -1 || 
                                lower.indexOf('profile_pic') !== -1 || lower.indexOf('profile_photo') !== -1 || lower.indexOf('avatar') !== -1 || 
                                lower.indexOf('cover_photo') !== -1 || lower.indexOf('profile_cover') !== -1 || lower.indexOf('banner') !== -1 || 
                                lower.indexOf('header') !== -1 || lower.indexOf('rsrc.php') !== -1 || lower.indexOf('emoji') !== -1 || 
                                lower.indexOf('/cp0/e15/q65/') !== -1) {
                                return true;
                            }
                            
                            if (alt.indexOf('profile picture') !== -1 || alt.indexOf('profile photo') !== -1 || alt.indexOf('cover photo') !== -1 || 
                                alt.indexOf('banner') !== -1 || alt.indexOf('logo') !== -1) {
                                return true;
                            }
                            
                            var parentHeader = imgEl.closest('header, div[aria-label*="Profile"], div[aria-label*="profile"], div[aria-label*="Cover"]');
                            if (parentHeader) return true;
                            
                            return false;
                        };

                        var imgs = Array.prototype.slice.call(post.querySelectorAll('img'));
                        var validSrcs = [];
                        for (var n = 0; n < imgs.length; n++) {
                            var s = imgs[n].getAttribute('data-src') || imgs[n].getAttribute('src') || "";
                            if (!isProfileOrBanner(imgs[n], s) && s.indexOf('data:') !== 0 && s.length > 20) {
                                validSrcs.push(s);
                            }
                        }
                        if (validSrcs.length > 0) {
                            mediaType = validSrcs.length > 1 ? "Carousel" : "Image";
                            mediaUrls = validSrcs.join(', ');
                        } else {
                            mediaType = "Text";
                            mediaUrls = "";
                        }
                    }
                    
                    results.push({
                        caption: caption,
                        timestamp: timestamp,
                        mediaType: mediaType,
                        mediaUrls: mediaUrls,
                        likes: likes,
                        comments: "Hidden",
                        postUrl: postUrl
                    });
                }
                
                return results;
            })();
        `);
        
        if (!data) {
            throw new Error("Could not locate any posts on the Facebook page.");
        }
        
        return data;
    }

    private async extractYouTube(profileUrl: string): Promise<any> {
        if (!this.driver) throw new Error("Driver not initialized");
        
        let targetUrl = profileUrl;
        let isSingleVideo = targetUrl.includes('watch?v=') || targetUrl.includes('youtu.be/') || targetUrl.includes('/shorts/');
        
        if (isSingleVideo) {
            // First load the single video to find the uploader's official channel link
            await this.driver.get(targetUrl);
            await this.driver.sleep(2500);
            
            const uploaderChannelUrl = await this.driver.executeScript(`
                const channelAnchor = document.querySelector('ytd-video-owner-renderer a[href*="/@"], ytd-video-owner-renderer a[href*="/channel/"], ytd-video-owner-renderer a[href*="/c/"], #owner a[href*="/@"]');
                return channelAnchor ? channelAnchor.getAttribute('href') : null;
            `);
            
            if (uploaderChannelUrl && typeof uploaderChannelUrl === 'string') {
                let fullChannel = uploaderChannelUrl.startsWith('/') ? "https://www.youtube.com" + uploaderChannelUrl : uploaderChannelUrl;
                targetUrl = fullChannel.endsWith('/videos') ? fullChannel : (fullChannel.endsWith('/') ? fullChannel + 'videos' : fullChannel + '/videos');
                isSingleVideo = false; // Successfully upgraded to channel URL!
            }
        }
        
        if (!isSingleVideo && !targetUrl.endsWith('/videos')) {
            try {
                const urlObj = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
                if (urlObj.pathname === '/' || urlObj.pathname.startsWith('/results')) {
                    throw new Error("Invalid YouTube channel URL.");
                }
            } catch (e) {}
            
            targetUrl = targetUrl + (targetUrl.endsWith('/') ? 'videos' : '/videos');
        }
        
        await this.driver.get(targetUrl);
        
        // Handle GDPR / Cookie Consent Popup
        try {
            await this.driver.executeScript(`
                const buttons = Array.from(document.querySelectorAll('button'));
                const acceptBtn = buttons.find(b => b.textContent && b.textContent.toLowerCase().includes('accept all'));
                const rejectBtn = buttons.find(b => b.textContent && b.textContent.toLowerCase().includes('reject all'));
                if (acceptBtn) acceptBtn.click();
                else if (rejectBtn) rejectBtn.click();
            `);
            await this.driver.sleep(1500);
        } catch (e) {}
        
        try {
            if (isSingleVideo) {
                await this.driver.wait(until.elementLocated(By.css('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata, h2.title')), 10000);
            } else {
                await this.driver.wait(until.elementLocated(By.css('a[href*="/watch?v="]')), 10000);
            }
        } catch (e) {
            await this.driver.sleep(2000); 
        }
        
        const data = await this.driver.executeScript(`
            const href = window.location.href;
            const pathname = window.location.pathname;
            const isSingleVideo = href.includes('watch?v=') || href.includes('youtu.be/') || href.includes('/shorts/');
            
            if (isSingleVideo) {
                let title = document.title.replace(' - YouTube', '');
                let h1 = document.querySelector('h1.ytd-video-primary-info-renderer, h1.ytd-watch-metadata');
                if (h1 && h1.textContent) title = h1.textContent.trim();
                
                let timestamp = "Recent";
                let dateElement = document.querySelector('#info-strings yt-formatted-string, #description-inner #tooltip');
                if (dateElement && dateElement.textContent) timestamp = dateElement.textContent.trim();
                
                let mediaUrls = "None";
                const vidIdMatch = href.match(/(?:youtu\\.be\\/|youtube\\.com\\/(?:embed\\/|v\\/|watch\\?v=|watch\\?.+&v=|shorts\\/))([\\w-]{11})/);
                if (vidIdMatch && vidIdMatch[1]) {
                    mediaUrls = "https://img.youtube.com/vi/" + vidIdMatch[1] + "/hqdefault.jpg";
                }
                
                return [{
                    caption: title,
                    timestamp: timestamp,
                    mediaType: "Video",
                    mediaUrls: mediaUrls,
                    likes: "Hidden",
                    comments: "Hidden",
                    postUrl: href
                }];
            }

            // STRICT CHANNEL VERIFICATION: Reject YouTube Homepage or Search Results
            const isStrictChannel = href.includes('/@') || href.includes('/channel/') || href.includes('/c/') || href.includes('/user/');
            if (!isStrictChannel || pathname === '/' || pathname.startsWith('/results')) {
                return null; // Reject non-channel page
            }
            
            // Strictly target the channel browse container and explicitly exclude recommended sidebars (#secondary, #related)
            const channelContainer = document.querySelector('ytd-two-column-browse-results-renderer #contents, ytd-browse #contents, #contents.ytd-rich-grid-renderer');
            if (!channelContainer) return null;
            
            const links = Array.from(channelContainer.querySelectorAll('a[href*="/watch?v="], a[href*="/shorts/"]'));
            if (links.length === 0) return null;
            
            let results = [];
            const processedLinks = new Set();
            
            for (const link of links) {
                if (results.length >= 5) break;
                
                // Skip links located inside recommended sidebars or related video sections
                if (link.closest('#secondary, #related, ytd-compact-video-renderer')) continue;
                
                const postUrl = link.getAttribute('href');
                if (!postUrl || processedLinks.has(postUrl)) continue;
                
                const text = link.textContent ? link.textContent.trim() : "";
                if (text.length > 3 && !/^(\\d+:)?\\d+:\\d+$/.test(text)) {
                    processedLinks.add(postUrl);
                    let fullUrl = postUrl.startsWith('/') ? "https://www.youtube.com" + postUrl : postUrl;
                    if (!fullUrl.startsWith('http')) fullUrl = href;
                    
                    const titleAttr = link.getAttribute('title');
                    const title = titleAttr ? titleAttr.trim() : text;
                    
                    let timestamp = "Recent";
                    let views = "0";
                    const itemContainer = link.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer');
                    if (itemContainer) {
                        const spans = itemContainer.querySelectorAll('span');
                        const timeSpan = Array.from(spans).find(s => s.textContent && s.textContent.toLowerCase().includes('ago'));
                        if (timeSpan) timestamp = timeSpan.textContent.trim();
                        
                        const viewsSpan = Array.from(spans).find(s => s.textContent && s.textContent.toLowerCase().includes('views'));
                        if (viewsSpan) views = viewsSpan.textContent.trim();
                    }
                    
                    let mediaUrls = "None";
                    const vidIdMatch = fullUrl.match(/(?:youtu\\.be\\/|youtube\\.com\\/(?:embed\\/|v\\/|watch\\?v=|watch\\?.+&v=|shorts\\/))([\\w-]{11})/);
                    if (vidIdMatch && vidIdMatch[1]) {
                        mediaUrls = "https://img.youtube.com/vi/" + vidIdMatch[1] + "/hqdefault.jpg";
                    }
                    
                    results.push({
                        caption: title,
                        timestamp: timestamp,
                        mediaType: "Video",
                        mediaUrls: mediaUrls,
                        likes: views,
                        comments: "Hidden",
                        postUrl: fullUrl
                    });
                }
            }
            
            return results;
        `);
        
        if (data && (data as any).isPrivate) {
            throw new Error("PRIVATE_ACCOUNT");
        }
        
        if (!data || (Array.isArray(data) && data.length === 0)) {
            throw new Error("Could not locate any videos on the official YouTube channel.");
        }
        
        return data;
    }

    private formatOutput(platform: string, profileUrl: string, data: any): string {
        if (typeof data === "string" && data.startsWith("Status:")) {
            return data;
        }

        const posts = Array.isArray(data) ? data : [data];

        const validPosts = posts.filter(p => {
            if (!p) return false;
            const hasCaption = p.caption && p.caption.trim().length > 0 && p.caption !== "No caption";
            const hasMedia = p.mediaUrls && p.mediaUrls.length > 5 && p.mediaUrls !== "None";
            const hasUrl = p.postUrl && p.postUrl.length > 5;
            return hasCaption || hasMedia || hasUrl;
        });

        if (validPosts.length === 0) {
            return `Status: Extraction Failed - No valid posts extracted from profile.`;
        }
        
        let formatted = `====================================================\n\nPlatform:\n${platform}\n\nProfile:\n${profileUrl}\n\n`;
        
        for (let i = 0; i < validPosts.length; i++) {
            const post = validPosts[i];
            const captionText = post.caption && post.caption.trim().length > 0 ? post.caption.trim() : `${platform} Post ${i + 1}`;
            formatted += `Post ${i + 1}\n\n`;
            formatted += `Date:\n${post.timestamp || "Recent"}\n\n`;
            formatted += `Caption:\n${captionText}\n\n`;
            formatted += `Media Type:\n${post.mediaType || "Image"}\n\n`;
            formatted += `Media URLs:\n${post.mediaUrls || "None"}\n\n`;
            formatted += `Likes:\n${post.likes || "Hidden"}\n\n`;
            formatted += `Comments:\n${post.comments || "Hidden"}\n\n`;
            formatted += `Post URL:\n${post.postUrl || profileUrl}\n\n`;
            formatted += `----------------------------------------------------\n\n`;
        }
        
        formatted += `====================================================`;
        return formatted;
    }
}
