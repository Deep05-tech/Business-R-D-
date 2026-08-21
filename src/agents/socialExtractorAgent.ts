import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

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
        
        // Use the persistent profile for Instagram, but a clean temporary profile for LinkedIn, Facebook, and YouTube to bypass banned burner accounts and authenticated DOM structures
        if (platform !== "LinkedIn" && platform !== "Facebook" && platform !== "YouTube") {
            options.addArguments(`--user-data-dir=${this.profilePath}`);
        }
        
        // Proxy Support (If you want to use a rotating proxy service instead of a desktop VPN)
        if (process.env.PROXY_URL) {
            options.addArguments(`--proxy-server=${process.env.PROXY_URL}`);
        }
        
        // Run completely in the background (headless) to prevent stealing screen focus
        options.addArguments('--headless=new');
        options.addArguments('--disable-gpu');
        options.addArguments('--no-sandbox');
        options.addArguments('--disable-dev-shm-usage');
        options.addArguments('--window-size=1920,1080');
        
        // Stealth arguments to bypass authwalls on LinkedIn & FB
        options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        this.driver = await new Builder()
            .forBrowser('chrome')
            .setChromeOptions(options)
            .build();
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

    public async extract(platform: "Instagram" | "LinkedIn" | "Facebook" | "YouTube", profileUrl: string, compName?: string): Promise<string> {
        if (platform === "YouTube") {
            const apiResult = await this.extractYouTubeAPI(profileUrl, compName);
            if (apiResult && Array.isArray(apiResult) && apiResult.length > 0) {
                return this.formatOutput(platform, profileUrl, apiResult);
            }
        }

        let attempts = 0;
        const maxAttempts = platform === "LinkedIn" ? 5 : 2;

        while (attempts < maxAttempts) {
            try {
                attempts++;
                await this.initBrowser(platform);

                let result = "";
                if (platform === "Instagram") {
                    result = await this.extractInstagram(profileUrl);
                } else if (platform === "LinkedIn") {
                    result = await this.extractLinkedIn(profileUrl);
                } else if (platform === "Facebook") {
                    result = await this.extractFacebook(profileUrl);
                } else if (platform === "YouTube") {
                    result = await this.extractYouTube(profileUrl);
                }

                await this.closeBrowser();
                return this.formatOutput(platform, profileUrl, result);
            } catch (error: any) {
                await this.closeBrowser();
                if (attempts >= maxAttempts) {
                    return `Status:\nExtraction Failed\n\nReason:\n${error.message}`;
                }
                // Wait briefly before retry
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        return "Status:\nExtraction Failed\n\nReason:\nUnknown error";
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
                
                const urls: string[] = await this.driver.executeScript(`
                    const main = document.querySelector('main');
                    const links = main ? Array.from(main.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) : Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
                    return links.map(a => a.href).slice(0, 8);
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
            await this.driver.sleep(3000);
            
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
                            return src.includes('scontent') && !src.includes('p150x150') && !alt.toLowerCase().includes('profile picture') && !src.startsWith('data:');
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
                    mediaUrls: mediaUrls,
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
                const isVideo = (data as any).mediaType === "Video";
                const isReel = (data as any).isReel === true || String((data as any).postUrl || "").includes('/reel/');
                if (isVideo && !isReel) {
                    console.log(`[SocialExtractorAgent] Skipping non-reel Instagram video post: ${(data as any).postUrl}`);
                    continue;
                }
                results.push(data);
                if (results.length >= 4) break;
            }
        }
        
        return results;
    }

    private async extractLinkedIn(profileUrl: string): Promise<any> {
        if (!this.driver) throw new Error("Driver not initialized");
        
        // Ensure URL goes to the root company page, unauthenticated posts tab is often broken
        const cleanUrl = profileUrl.split('/posts')[0];
        
        await this.driver.get(cleanUrl);
        await this.driver.sleep(3000); // Give it time to redirect if it's going to
        
        const currentUrl = await this.driver.getCurrentUrl();
        const pageSource = await this.driver.getPageSource();
        
        if (currentUrl.includes('authwall') || currentUrl.includes('/login') || currentUrl.includes('/signup') || pageSource.includes('join LinkedIn')) {
            console.log(`[LinkedIn] Authwall detected. Closing browser and retrying...`);
            throw new Error("LINKEDIN_AUTHWALL");
        }
        
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
        
        const data = await this.driver.executeScript(`
            // Dismiss login modal if present (unauthenticated view)
            const modalClose = document.querySelector('button.modal__dismiss, button[aria-label="Dismiss"]');
            if (modalClose) modalClose.click();
            
            // Check for private / unavailable profile
            const isPrivateText = document.body.innerText.toLowerCase().includes('this profile is not available');
            if (isPrivateText) return { isPrivate: true };
            
            // Find the posts (try authenticated and unauthenticated selectors)
            const posts = document.querySelectorAll('.feed-shared-update-v2, [data-urn], article[data-id="main-feed-card"], .main-feed-activity-card');
            if (!posts || posts.length === 0) return null;
            
            const results = [];
            const maxPosts = Math.min(posts.length, 5); // Extract up to 5 posts
            
            for (let i = 0; i < maxPosts; i++) {
                const post = posts[i];
                try {
                    // Click "See more" if exists
                    const seeMore = post.querySelector('.see-more') || post.querySelector('button[data-test-id="see-more-button"]');
                    if (seeMore) seeMore.click();
                } catch(e) {}
                
                const capEl = post.querySelector('.feed-shared-update-v2__description-wrapper, .update-components-text, .attributed-text-segment-list__content, p[data-test-id="main-feed-activity-card__commentary"]');
                const caption = capEl && capEl.textContent ? capEl.textContent.trim() : post.textContent.substring(0, 500).trim();
                
                const timeEl = post.querySelector('.update-components-actor__sub-description, .feed-shared-actor__sub-description, time');
                const timestamp = timeEl && timeEl.textContent ? timeEl.textContent.trim() : "Recent";
                
                const likeEl = post.querySelector('.social-details-social-counts__reactions-count') || post.querySelector('[data-test-id="social-actions__reaction-count"]');
                const likes = likeEl && likeEl.textContent ? likeEl.textContent.trim() : "0";
                
                const comEl = post.querySelector('.social-details-social-counts__comments');
                const comments = comEl && comEl.textContent ? comEl.textContent.trim() : "0";
                
                let mediaType = "Text";
                let mediaUrls = "";
                if (post.querySelector('video')) {
                    mediaType = "Video";
                    const vid = post.querySelector('video');
                    mediaUrls = vid.getAttribute('src') || vid.getAttribute('poster') || "";
                    if (!mediaUrls) {
                         const img = post.querySelector('img.update-components-image__image, img.update-components-linkedin-video__poster');
                         if (img) mediaUrls = img.getAttribute('src') || "";
                    }
                } else if (post.querySelector('img')) {
                    let imgs = Array.from(post.querySelectorAll('img.update-components-image__image, ul[data-test-id="feed-images-content"] img, [data-test-id="feed-images-content__list-item"] img, img.ivm-view-attr__img--centered'));
                    if (imgs.length === 0) {
                        imgs = Array.from(post.querySelectorAll('img')).filter(img => {
                            const width = img.getAttribute('width');
                            const src = img.getAttribute('data-delayed-url') || img.getAttribute('src') || "";
                            return src.length > 20 && !src.startsWith('data:') && (!width || parseInt(width) > 50) && !src.includes('profile');
                        });
                    }
                    if (imgs.length > 0) {
                        mediaType = imgs.length > 1 ? "Carousel" : "Image";
                        mediaUrls = imgs.map(function(img) { return img.getAttribute('data-delayed-url') || img.getAttribute('src'); }).filter(Boolean).join(', ');
                    }
                }
                
                // Extract post URL
                let postUrl = "";
                const urn = post.getAttribute('data-activity-urn') || post.getAttribute('data-urn');
                if (urn) {
                    postUrl = "https://www.linkedin.com/feed/update/" + urn + "/";
                } else {
                    const links = post.querySelectorAll('a[href*="/activity/"], a[href*="/posts/"], a.main-feed-card__overlay-link');
                    if (links.length > 0) {
                        postUrl = links[0].getAttribute('href') || "";
                    }
                    if (postUrl.startsWith('/')) {
                        postUrl = "https://www.linkedin.com" + postUrl;
                    }
                    if (!postUrl) {
                        postUrl = window.location.href; // Fallback to company URL
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
            const modalClose = document.querySelector('div[aria-label="Close"]');
            if (modalClose) modalClose.click();
        `).catch(() => {});
        
        // Expand 'See more' before extracting to prevent truncated captions
        await this.driver.executeScript(`
            const firstPost = document.querySelector('div[role="article"]');
            if (firstPost) {
                const buttons = firstPost.querySelectorAll('div[role="button"]');
                for (const btn of buttons) {
                    if (btn.textContent && btn.textContent.toLowerCase().includes('see more')) {
                        btn.click();
                        break;
                    }
                }
            }
        `).catch(() => {});
        
        // Give React time to render the expanded caption text
        await this.driver.sleep(1000);
        
        const data = await this.driver.executeScript(`
            // Check for private / unavailable content
            const isPrivateFb = document.body.innerText.toLowerCase().includes("content isn't available");
            if (isPrivateFb) return { isPrivate: true };
            
            const posts = document.querySelectorAll('div[role="article"]');
            if (!posts || posts.length === 0) return null;
            
            const results = [];
            const processedLinks = new Set();
            
            for (let i = 0; i < posts.length; i++) {
                if (results.length >= 5) break;
                
                const post = posts[i];
                
                // Extract Timestamp & URL dynamically
                let postUrl = "";
                let timestamp = "Recent";
                const pageUrl = window.location.href.split('?')[0].replace(/\/$/, '');
                const anchors = Array.from(post.querySelectorAll('a'));
                
                // Prioritize permalink anchors matching specific Facebook post URL patterns
                let permalinkAnchor = anchors.find(a => {
                    const href = (a.getAttribute('href') || "").toLowerCase();
                    return href.includes('/posts/') || 
                           href.includes('fbid=') || 
                           href.includes('story_fbid=') ||
                           href.includes('pfbid') ||
                           href.includes('/videos/') || 
                           href.includes('/reel/') || 
                           href.includes('/photo') || 
                           href.includes('/photos/') ||
                           href.includes('story.php') ||
                           href.includes('permalink') ||
                           href.includes('/share/p/') ||
                           href.includes('/share/v/') ||
                           href.includes('/share/r/') ||
                           href.includes('/watch');
                });
                
                // If no permalink anchor matched keywords, find any non-root profile anchor inside the post card
                if (!permalinkAnchor) {
                    permalinkAnchor = anchors.find(a => {
                        const href = a.getAttribute('href') || "";
                        if (!href || href === '#' || href.startsWith('javascript:')) return false;
                        const full = href.startsWith('/') ? ("https://www.facebook.com" + href) : href;
                        const cleanFull = full.split('?')[0].replace(/\/$/, '');
                        return cleanFull !== pageUrl && !cleanFull.endsWith('/about') && !cleanFull.endsWith('/photos') && !cleanFull.endsWith('/videos');
                    });
                }
                
                if (permalinkAnchor) {
                    postUrl = permalinkAnchor.getAttribute('href') || "";
                    if (permalinkAnchor.textContent && permalinkAnchor.textContent.trim().length > 0) {
                        timestamp = permalinkAnchor.textContent.trim();
                    }
                }
                
                if (postUrl.startsWith('/')) {
                    postUrl = "https://www.facebook.com" + postUrl;
                }
                if (!postUrl) {
                    postUrl = window.location.href; // Fallback to company URL
                }
                
                // Deduplicate by URL
                if (processedLinks.has(postUrl)) continue;
                processedLinks.add(postUrl);
                
                // Extract Caption
                let caption = "";
                const capEl = post.querySelector('div[data-ad-comet-preview="message"]');
                if (capEl) {
                    caption = capEl.textContent.trim();
                } else {
                    // Fallback for caption
                    const autoEls = post.querySelectorAll('div[dir="auto"]');
                    for (const el of autoEls) {
                        const txt = el.textContent.trim();
                        if (txt.length > 50) { 
                            caption = txt;
                            break;
                        }
                    }
                }
                
                // Extract Likes
                const likeEl = post.querySelector('span.x1e558r4');
                const likes = likeEl && likeEl.textContent ? likeEl.textContent.trim() : "0";
                
                // Extract Media
                const fbIsVideo = postUrl.includes('/videos/') || postUrl.includes('/reel/') || postUrl.includes('/watch');
                let mediaType = fbIsVideo ? "Video" : "Text";
                let mediaUrls = "";
                
                if (post.querySelector('video') || fbIsVideo) {
                    mediaType = "Video";
                    const vid = post.querySelector('video');
                    if (vid) {
                        mediaUrls = vid.getAttribute('src') || "";
                        if (mediaUrls.startsWith('blob:')) mediaUrls = "";
                        if (!mediaUrls) mediaUrls = vid.getAttribute('poster') || "";
                    }
                    
                    if (!mediaUrls || mediaUrls.startsWith('blob:')) {
                        const imgs = Array.from(post.querySelectorAll('img'));
                        const validImgs = imgs.filter(img => {
                            const src = img.getAttribute('data-src') || img.getAttribute('src') || "";
                            const isIcon = src.includes('emoji') || src.includes('rsrc.php');
                            const isProfile = src.includes('p100x100') || src.includes('p75x75') || src.includes('p50x50') || src.includes('p36x36') || src.includes('/cp0/e15/q65/');
                            return !isIcon && !isProfile && !src.startsWith('data:') && !src.startsWith('blob:') && src.length > 20;
                        });
                        if (validImgs.length > 0) {
                            mediaUrls = validImgs[0].getAttribute('data-src') || validImgs[0].getAttribute('src') || "";
                        }
                    }
                } else if (post.querySelector('img')) {
                    const imgs = Array.from(post.querySelectorAll('img'));
                    const validImgs = imgs.filter(img => {
                        const src = img.getAttribute('data-src') || img.getAttribute('src') || "";
                        const isIcon = src.includes('emoji') || src.includes('rsrc.php');
                        const isProfile = src.includes('p100x100') || src.includes('p75x75') || src.includes('p50x50') || src.includes('p36x36') || src.includes('/cp0/e15/q65/');
                        return !isIcon && !isProfile && !src.startsWith('data:') && src.length > 20;
                    });
                    
                    if (validImgs.length > 0) {
                        mediaType = validImgs.length > 1 ? "Carousel" : "Image";
                        mediaUrls = validImgs.map(img => img.getAttribute('data-src') || img.getAttribute('src')).filter(Boolean).join(', ');
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

        const validPosts = posts.filter(p => p && p.caption && p.caption.trim().length > 10 && p.caption !== "No caption");
        if (validPosts.length === 0) {
            return `Status: Extraction Failed - No valid post captions extracted from profile.`;
        }
        
        let formatted = `====================================================\n\nPlatform:\n${platform}\n\nProfile:\n${profileUrl}\n\n`;
        
        for (let i = 0; i < posts.length; i++) {
            const post = posts[i];
            formatted += `Post ${i + 1}\n\n`;
            formatted += `Date:\n${post.timestamp || "Not found"}\n\n`;
            formatted += `Caption:\n${post.caption || "No caption"}\n\n`;
            formatted += `Media Type:\n${post.mediaType || "Unknown"}\n\n`;
            formatted += `Media URLs:\n${post.mediaUrls || "None"}\n\n`;
            formatted += `Likes:\n${post.likes || "Unknown"}\n\n`;
            formatted += `Comments:\n${post.comments || "Unknown"}\n\n`;
            formatted += `Post URL:\n${post.postUrl || "Not found"}\n\n`;
            formatted += `----------------------------------------------------\n\n`;
        }
        
        formatted += `====================================================`;
        return formatted;
    }
}
