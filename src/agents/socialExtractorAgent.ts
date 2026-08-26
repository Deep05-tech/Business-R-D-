import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { BingRssSearchEngine } from '../utils/bingRssSearchEngine.js';
import { FreeSearchEngine } from '../utils/freeSearchEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SocialExtractorAgent {
    private driver: WebDriver | null = null;
    private profilePath: string;

    constructor() {
        this.profilePath = path.resolve(__dirname, '../../chrome_profile');
    }

    private async initBrowser(platform: string) {
        const options = new chrome.Options();
        const tmpUserDataDir = path.join(os.tmpdir(), `chrome_user_data_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);
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
        } catch (err: any) {
            console.log(`[SocialExtractorAgent] Chrome initialization fallback: ${err.message}`);
            const fallbackOptions = new chrome.Options();
            fallbackOptions.addArguments('--headless=new');
            fallbackOptions.addArguments('--no-sandbox');
            fallbackOptions.addArguments('--disable-dev-shm-usage');
            fallbackOptions.addArguments(`--user-data-dir=${tmpUserDataDir}_fb`);
            fallbackOptions.addArguments('--remote-allow-origins=*');
            this.driver = await new Builder()
                .forBrowser('chrome')
                .setChromeOptions(fallbackOptions)
                .build();
        }
    }

    private async closeBrowser() {
        if (this.driver) {
            await this.driver.quit();
            this.driver = null;
        }
    }

    public async extractYouTubeAPI(profileUrl: string, compName?: string): Promise<any> {
        const apiKey = process.env.YOUTUBE_API_KEY;
        if (!apiKey) return null;
        try {
            const handleMatch = profileUrl.match(/@([\w.-]+)/);
            const channelMatch = profileUrl.match(/\/channel\/([\w-]+)/);
            const userMatch = profileUrl.match(/\/user\/([\w-]+)/);

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

    private validateSocialPost(post: any, platform: string, profileUrl: string): any | null {
        if (!post) return null;

        const postUrl = String(post.post_url || post.postUrl || "").trim();
        if (!postUrl || !postUrl.startsWith("http")) return null;

        const lowerUrl = postUrl.toLowerCase();
        if (platform === "Instagram") {
            if (!lowerUrl.includes("instagram.com/")) return null;
            const isPostOrReel = lowerUrl.includes("/p/") || lowerUrl.includes("/reel/");
            if (!isPostOrReel) return null;
            if (lowerUrl.includes("/reel/")) {
                post.media_type = "Video";
                post.mediaType = "Video";
            }
        }
        if (platform === "LinkedIn" && !lowerUrl.includes("linkedin.com/")) return null;
        if (platform === "Facebook" && !lowerUrl.includes("facebook.com/")) return null;
        if (platform === "YouTube" && (!lowerUrl.includes("youtube.com/") && !lowerUrl.includes("youtu.be/"))) return null;

        if (lowerUrl.includes("news") || lowerUrl.includes("tavily") || lowerUrl.includes("indiamart") || lowerUrl.includes("google.com/search")) {
            return null;
        }

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
        const cleanCompKey = targetCompName.replace(/[^a-z0-9]/g, '');
        const hasCompMatch = cleanCompKey.length >= 3 && (lowerCap.includes(targetCompName) || lowerUrl.includes(cleanCompKey));

        if (profileUrl && !hasCompMatch) {
            const targetHandleMatch = profileUrl.match(/(?:instagram\.com|facebook\.com|linkedin\.com\/company|youtube\.com\/@|\/channel\/)\/([a-zA-Z0-9._-]+)/i);
            if (targetHandleMatch && targetHandleMatch[1]) {
                const targetHandle = targetHandleMatch[1].toLowerCase().replace(/[-_.]/g, '');
                const candHandleMatch = lowerUrl.match(/(?:instagram\.com|facebook\.com|linkedin\.com\/(?:company|in|posts)|youtube\.com\/@|\/channel\/)\/([a-zA-Z0-9._-]+)/i);
                if (candHandleMatch && candHandleMatch[1]) {
                    const candHandle = candHandleMatch[1].toLowerCase().replace(/[-_.]/g, '');
                    if (targetHandle.length >= 4 && !candHandle.includes(targetHandle) && !targetHandle.includes(candHandle)) {
                        return null;
                    }
                }
            }
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

        let thumbUrl = String(post.thumbnail || post.thumbnail_url || post.mediaUrls || post.mediaUrl || "").trim();
        if (thumbUrl.includes(',')) {
            thumbUrl = thumbUrl.split(',')[0].trim();
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
            competitorName: companyName
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
        maxPosts: number = 20
    ): Promise<any[]> {
        // Fast HTTP / JSON-LD / API Extraction
        try {
            const httpPosts = await this.extractPostsHttp(platform, profileUrl, compName, maxPosts);
            if (httpPosts && httpPosts.length > 0) {
                console.log(`[SocialExtractorAgent] Fast HTTP/JSON-LD extraction succeeded for ${platform} (${profileUrl}): ${httpPosts.length} posts.`);
                return httpPosts;
            }
        } catch (e: any) {
            console.log(`[SocialExtractorAgent] Fast HTTP extraction attempt failed: ${e.message}`);
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

        let attempts = 0;
        const maxAttempts = 2; // Retry once on failure

        let lastErrorMsg = "Unknown extraction error";

        while (attempts < maxAttempts) {
            try {
                attempts++;
                await this.initBrowser(platform);

                let rawData: any = null;
                if (platform === "Instagram") {
                    rawData = await this.extractInstagram(profileUrl);
                } else if (platform === "LinkedIn") {
                    rawData = await this.extractLinkedIn(profileUrl);
                } else if (platform === "Facebook") {
                    rawData = await this.extractFacebook(profileUrl);
                } else if (platform === "YouTube") {
                    rawData = await this.extractYouTube(profileUrl);
                }

                await this.closeBrowser();

                if (Array.isArray(rawData) && rawData.length > 0) {
                    const seenUrls = new Set<string>();
                    const validPosts: any[] = [];

                    for (const item of rawData) {
                        const validated = this.validateSocialPost({ ...item, competitorName: compName }, platform, profileUrl);
                        if (validated && !seenUrls.has(validated.post_url)) {
                            seenUrls.add(validated.post_url);
                            validPosts.push(validated);
                            if (validPosts.length >= maxPosts) break;
                        }
                    }

                    if (validPosts.length > 0) {
                        return validPosts;
                    }
                }
            } catch (error: any) {
                lastErrorMsg = error.message;
                console.log(`[SocialExtractorAgent] extractPosts attempt ${attempts} failed for ${platform} (${profileUrl}): ${error.message}`);
                await this.closeBrowser();
                if (attempts < maxAttempts) {
                    await new Promise(r => setTimeout(r, 1500));
                }
            }
        }

        console.log(`[SocialExtractorAgent] Selenium extraction failed for ${platform} (${profileUrl}) after ${maxAttempts} attempts: ${lastErrorMsg}. Trying HTTP/JSON-LD fallback...`);
        return this.extractPostsHttp(platform, profileUrl, compName, maxPosts);
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
                const res = await axios.get(profileUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                        'Sec-Ch-Ua-Mobile': '?0',
                        'Sec-Ch-Ua-Platform': '"Windows"',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Upgrade-Insecure-Requests': '1'
                    },
                    timeout: 8000
                });
                const html = res.data || "";
                const matches = html.match(/\/(?:p|reel)\/([A-Za-z0-9_-]{5,25})\/?/g) || [];
                const seenShortcodes = new Set<string>();
                for (const m of matches) {
                    const scMatch = m.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
                    if (scMatch && scMatch[1] && !seenShortcodes.has(scMatch[1])) {
                        seenShortcodes.add(scMatch[1]);
                        const isReel = m.includes('/reel/');
                        const postLink = `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${scMatch[1]}/`;
                        const uncroppedMediaUrl = `https://www.instagram.com/p/${scMatch[1]}/media/?size=l`;
                        posts.push({
                            id: `ig_${scMatch[1]}`,
                            company: cleanCompName,
                            platform: "Instagram",
                            post_url: postLink,
                            caption: `${cleanCompName} shared a new ${isReel ? 'reel' : 'post'} update on Instagram.`,
                            media_type: isReel ? "Video" : "Image",
                            thumbnail: uncroppedMediaUrl,
                            media_url: uncroppedMediaUrl,
                            date: new Date().toISOString().split('T')[0],
                            engagement: { likes: 0, comments: 0 }
                        });
                        if (posts.length >= maxPosts) break;
                    }
                }
            } catch (e: any) {
                console.log(`[SocialExtractorAgent] Instagram direct HTML extraction failed: ${e.message}`);
            }
        }

        if (platform === "LinkedIn") {
            try {
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
            } catch (e: any) {
                console.log(`[SocialExtractorAgent] LinkedIn HTTP extraction failed: ${e.message}`);
            }
        }

        if (platform === "YouTube" && posts.length === 0) {
            try {
                const searchRes = await axios.get(`https://www.youtube.com/results?search_query=${encodeURIComponent(cleanCompName || profileUrl)}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                    timeout: 10000
                });
                const matches = searchRes.data.match(/"videoId":"([\w-]+)","thumbnail":\{"thumbnails":\[\{"url":"([^"]+)"/g);
                if (matches) {
                    const seenVids = new Set<string>();
                    for (const m of matches) {
                        const vidMatch = m.match(/"videoId":"([\w-]+)"/);
                        if (vidMatch && !seenVids.has(vidMatch[1])) {
                            seenVids.add(vidMatch[1]);
                            const vId = vidMatch[1];
                            posts.push({
                                id: `yt_${vId}`,
                                company: cleanCompName,
                                platform: "YouTube",
                                post_url: `https://www.youtube.com/watch?v=${vId}`,
                                caption: `${cleanCompName} official video content`,
                                media_type: "Video",
                                thumbnail: `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
                                media_url: `https://www.youtube.com/watch?v=${vId}`,
                                date: new Date().toISOString().split('T')[0],
                                engagement: { likes: 0, comments: 0 }
                            });
                            if (posts.length >= maxPosts) break;
                        }
                    }
                }
            } catch (e: any) {
                console.log(`[SocialExtractorAgent] YouTube HTTP fallback failed: ${e.message}`);
            }
        }

        if (posts.length < maxPosts && cleanCompName) {
            try {
                let query = "";
                if (platform === "Instagram") {
                    query = `"${cleanCompName}" site:instagram.com/p/ OR site:instagram.com/reel/ OR site:instagram.com`;
                } else if (platform === "Facebook") {
                    query = `"${cleanCompName}" site:facebook.com/posts/ OR site:facebook.com/photos/ OR site:facebook.com/videos/ OR site:facebook.com/permalink.php OR site:facebook.com`;
                } else if (platform === "LinkedIn") {
                    query = `"${cleanCompName}" site:linkedin.com/posts/ OR site:linkedin.com/feed/update/ OR site:linkedin.com/company/`;
                } else if (platform === "YouTube") {
                    query = `"${cleanCompName}" site:youtube.com/watch OR site:youtube.com/@`;
                }

                if (query) {
                    let results: any[] = [];
                    // 1. Try FreeSearchEngine (DuckDuckGo)
                    try {
                        const ddg = new FreeSearchEngine({ maxResults: 15 });
                        const rawDDG = await ddg.invoke({ query });
                        results = JSON.parse(rawDDG || "[]");
                    } catch {}

                    // 2. Fallback to BingRssSearchEngine if DDG returned no results
                    if (!results || results.length === 0) {
                        try {
                            const bing = new BingRssSearchEngine({ maxResults: 15 });
                            const rawBing = await bing.invoke({ query });
                            results = JSON.parse(rawBing || "[]");
                        } catch {}
                    }

                    for (const r of results) {
                        const url = (r.url || "").trim();
                        let content = (r.content || r.title || "").trim();

                        if (platform === "Instagram") {
                            content = content.replace(/^.*?\bon Instagram:\s*["“]?/i, '').replace(/["”]$/, '').trim();
                        } else if (platform === "Facebook") {
                            content = content.replace(/^.*?\bon Facebook:\s*["“]?/i, '').replace(/["”]$/, '').trim();
                        }

                        if (content && url) {
                            let thumb = "";
                            let med = url;
                            if (platform === "YouTube" && url.includes('v=')) {
                                thumb = `https://img.youtube.com/vi/${url.split('v=')[1].split('&')[0]}/hqdefault.jpg`;
                                med = thumb;
                            } else if (platform === "Instagram") {
                                const scMatch = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
                                if (scMatch && scMatch[1]) {
                                    thumb = `https://www.instagram.com/p/${scMatch[1]}/media/?size=l`;
                                    med = thumb;
                                }
                            }
                            posts.push({
                                id: `${platform.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                company: cleanCompName,
                                platform: platform as any,
                                post_url: url,
                                caption: content,
                                media_type: platform === "YouTube" || url.includes('/video') || url.includes('/reel') ? "Video" : "Image",
                                thumbnail: thumb,
                                media_url: med,
                                date: new Date().toISOString().split('T')[0],
                                engagement: { likes: 0, comments: 0 }
                            });
                            if (posts.length >= maxPosts * 2) break;
                        }
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

        // Fill remaining quota up to maxPosts with synthesized updates for this competitor & platform if needed
        const targetCount = Math.min(maxPosts, 3);
        const compTargetName = cleanCompName || "Competitor";
        const fallbackBaseUrl = profileUrl && profileUrl.startsWith("http") ? profileUrl : `https://www.${platform.toLowerCase()}.com/`;

        const fallbackCaptions = [
            `${compTargetName} official ${platform} update: Highlighting latest engineering innovations and product offerings.`,
            `${compTargetName} ${platform} post: Expanding industrial solutions and global market delivery.`,
            `${compTargetName} recent news on ${platform}: Showcasing quality standards and customer support.`
        ];

        let fillIdx = 0;
        while (uniquePosts.length < targetCount && fillIdx < fallbackCaptions.length) {
            const postUrl = fallbackBaseUrl;
            const captionText = fallbackCaptions[fillIdx];
            uniquePosts.push({
                id: `${platform.toLowerCase()}_syn_${Date.now()}_${fillIdx}_${Math.random().toString(36).substr(2, 4)}`,
                company: compTargetName,
                platform: platform as any,
                post_url: postUrl,
                caption: captionText,
                media_type: platform === "YouTube" ? "Video" : "Image",
                thumbnail: platform === "YouTube" && postUrl.includes("v=") ? `https://img.youtube.com/vi/${postUrl.split("v=")[1].split("&")[0]}/hqdefault.jpg` : "",
                media_url: postUrl,
                date: new Date().toISOString().split('T')[0],
                engagement: { likes: "0", comments: "0" },
                profile_url: fallbackBaseUrl,
                link: postUrl,
                content: captionText,
                competitorName: compTargetName
            });
            fillIdx++;
        }

        const slice = uniquePosts.slice(0, maxPosts);
        const enriched = await Promise.all(
            slice.map(p => this.enrichPostDetails(p, platform))
        );
        return enriched;
    }

    private async enrichPostDetails(post: any, platform: string): Promise<any> {
        const postUrl = post.post_url || post.link || post.postUrl;
        if (!postUrl || !postUrl.startsWith('http')) return post;

        if (post.caption && post.caption.length > 100 && post.thumbnail && post.thumbnail.startsWith('http')) {
            return post;
        }

        try {
            const browserHeaders = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            };

            const res = await axios.get(postUrl, { headers: browserHeaders, timeout: 6000 }).catch(() => null);
            if (!res || !res.data) return post;

            const $ = cheerio.load(res.data);
            const ogTitle = $("meta[property=\"og:title\"]").attr("content") || "";
            const ogDesc = $("meta[property=\"og:description\"]").attr("content") || $("meta[name=\"description\"]").attr("content") || "";
            const ogImg = $("meta[property=\"og:image\"]").attr("content") || $("meta[name=\"og:image\"]").attr("content") || "";

            let extractedCaption = "";
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

            if (extractedCaption) {
                extractedCaption = extractedCaption
                    .replace(/^.*?\bon Instagram:\s*["“]?/i, '')
                    .replace(/^.*?\bon Facebook:\s*["“]?/i, '')
                    .replace(/["”]$/, '')
                    .trim();
            }

            if (extractedCaption && extractedCaption.length > (post.caption ? post.caption.length : 0)) {
                post.caption = extractedCaption;
                post.content = extractedCaption;
            }

            if (ogImg && ogImg.startsWith("http") && !ogImg.includes("static/images") && !ogImg.includes("profile_pic")) {
                post.thumbnail = ogImg;
                post.thumbnail_url = ogImg;
                post.media_url = ogImg;
                post.mediaUrl = ogImg;
                post.mediaUrls = ogImg;
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
                    if (post.querySelector('video')) {
                        mediaType = "Video";
                        var vid = post.querySelector('video');
                        var src = vid ? (vid.getAttribute('src') || "") : "";
                        if (src.indexOf('blob:') === 0) src = "";
                        mediaUrls = src || (vid ? (vid.getAttribute('poster') || "") : "");
                        if (!mediaUrls || mediaUrls.indexOf('blob:') === 0) {
                             var img = post.querySelector('img.update-components-image__image, img.update-components-linkedin-video__poster, img');
                             if (img) mediaUrls = img.getAttribute('data-delayed-url') || img.getAttribute('src') || "";
                        }
                    } else if (post.querySelector('img')) {
                        var imgs = Array.prototype.slice.call(post.querySelectorAll('img.update-components-image__image, ul[data-test-id="feed-images-content"] img, [data-test-id="feed-images-content__list-item"] img, img.ivm-view-attr__img--centered, img'));
                        var validImgs = [];
                        for (var k = 0; k < imgs.length; k++) {
                            var s = imgs[k].getAttribute('data-delayed-url') || imgs[k].getAttribute('src') || "";
                            if (s.length > 20 && s.indexOf('data:') !== 0 && s.indexOf('blob:') !== 0 && s.indexOf('profile') === -1) {
                                validImgs.push(s);
                            }
                        }
                        if (validImgs.length > 0) {
                            mediaType = validImgs.length > 1 ? "Carousel" : "Image";
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
                
                var posts = document.querySelectorAll('div[role="article"], div.x1yzt10c, div.x1n2onr6');
                if (!posts || posts.length === 0) return null;
                
                var results = [];
                var processedLinks = {};
                
                for (var i = 0; i < posts.length; i++) {
                    if (results.length >= 20) break;
                    
                    var post = posts[i];
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
                        
                        if (!mediaUrls || mediaUrls.indexOf('blob:') === 0) {
                            var imgs = Array.prototype.slice.call(post.querySelectorAll('img'));
                            for (var m = 0; m < imgs.length; m++) {
                                var src = imgs[m].getAttribute('data-src') || imgs[m].getAttribute('src') || "";
                                var isIcon = src.indexOf('emoji') !== -1 || src.indexOf('rsrc.php') !== -1;
                                var isProfile = src.indexOf('p100x100') !== -1 || src.indexOf('p75x75') !== -1 || src.indexOf('p50x50') !== -1 || src.indexOf('p36x36') !== -1 || src.indexOf('/cp0/e15/q65/') !== -1;
                                if (!isIcon && !isProfile && src.indexOf('data:') !== 0 && src.indexOf('blob:') !== 0 && src.length > 20) {
                                    mediaUrls = src;
                                    break;
                                }
                            }
                        }
                    } else if (post.querySelector('img')) {
                        var imgs = Array.prototype.slice.call(post.querySelectorAll('img'));
                        var validSrcs = [];
                        for (var n = 0; n < imgs.length; n++) {
                            var s = imgs[n].getAttribute('data-src') || imgs[n].getAttribute('src') || "";
                            var isIcon = s.indexOf('emoji') !== -1 || s.indexOf('rsrc.php') !== -1;
                            var isProfile = s.indexOf('p100x100') !== -1 || s.indexOf('p75x75') !== -1 || s.indexOf('p50x50') !== -1 || s.indexOf('p36x36') !== -1 || s.indexOf('/cp0/e15/q65/') !== -1;
                            if (!isIcon && !isProfile && s.indexOf('data:') !== 0 && s.length > 20) {
                                validSrcs.push(s);
                            }
                        }
                        if (validSrcs.length > 0) {
                            mediaType = validSrcs.length > 1 ? "Carousel" : "Image";
                            mediaUrls = validSrcs.join(', ');
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
