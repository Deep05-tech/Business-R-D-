import { Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import path from 'path';
import { fileURLToPath } from 'url';

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

    public async extract(platform: "Instagram" | "LinkedIn" | "Facebook" | "YouTube", profileUrl: string): Promise<string> {
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

    private async extractInstagram(profileUrl: string): Promise<any> {
        if (!this.driver) throw new Error("Driver not initialized");
        
        // Always load the profile URL directly
        // Always load the URL directly
        await this.driver.get(profileUrl);
        await this.driver.sleep(3000); // Wait for SPA to load
        
        // If it's a profile page, find the first post on the grid and navigate to it
        if (!profileUrl.includes('/p/') && !profileUrl.includes('/reel/')) {
            try {
                const firstPost = await this.driver.wait(
                    until.elementLocated(By.css('a[href*="/p/"], a[href*="/reel/"]')), 
                    10000
                );
                
                const postUrl = await firstPost.getAttribute('href');
                if (!postUrl) throw new Error("Could not find post URL on Instagram page");
                await this.driver.get(postUrl); 
                await this.driver.sleep(3000);
            } catch (e) {
                throw new Error("Could not locate any post grid on this Instagram profile.");
            }
        }
        
        const data: any = await this.driver.executeScript(`
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
            
            // Find caption (meta og:title is very reliable when page is loaded directly)
            let caption = "";
            const ogTitle = document.querySelector('meta[property="og:title"]');
            if (ogTitle && ogTitle.content) {
                caption = ogTitle.content;
                if (caption.includes('on Instagram: "')) {
                    caption = caption.split('on Instagram: "')[1];
                    if (caption.endsWith('"')) caption = caption.slice(0, -1);
                }
            }
            
            // Fallback to h1/span
            if (!caption || caption.length < 5) {
                const textNodes = document.querySelectorAll('h1[dir="auto"], span[dir="auto"]');
                for (let i = 0; i < textNodes.length; i++) {
                    const nodeText = textNodes[i].textContent || "";
                    if (nodeText.length > 20) {
                        caption = nodeText.trim();
                        break;
                    }
                }
            }
            
            // Media
            const isReel = window.location.href.includes('/reel/') || window.location.href.includes('/tv/');
            let mediaType = isReel ? "Video" : "Image";
            let mediaUrls = "";
            
            if (document.querySelector('video') || isReel) {
                mediaType = "Video";
                const vid = document.querySelector('video');
                if (vid) {
                    mediaUrls = vid.getAttribute('src') || "";
                    if (mediaUrls.startsWith('blob:')) mediaUrls = "";
                    if (!mediaUrls) mediaUrls = vid.getAttribute('poster') || "";
                }
                
                if (!mediaUrls || mediaUrls.startsWith('blob:')) {
                    const img = document.querySelector('img[style*="object-fit: cover"]');
                    if (img) mediaUrls = img.getAttribute('src') || "";
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
            
            // Likes
            const likeSpan = Array.from(document.querySelectorAll('span')).find(function(s) { return s.textContent && s.textContent.includes('likes'); });
            const likes = likeSpan ? likeSpan.textContent.trim() : "Hidden";
            
            return {
                caption: caption,
                timestamp: timestamp,
                mediaType: mediaType,
                mediaUrls: mediaUrls,
                likes: likes,
                comments: "Not extracted",
                postUrl: window.location.href
            };
        `);
        
        if (data && (data as any).isPrivate) {
            throw new Error("PRIVATE_ACCOUNT");
        }
        
        return data;
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
            
            // Find the first post (try authenticated and unauthenticated selectors)
            const firstPost = document.querySelector('.feed-shared-update-v2') || document.querySelector('[data-urn]') || document.querySelector('article[data-id="main-feed-card"]') || document.querySelector('.main-feed-activity-card');
            if (!firstPost) return null;
            
            // Click "See more" if exists
            const seeMore = firstPost.querySelector('.see-more') || firstPost.querySelector('button[data-test-id="see-more-button"]');
            if (seeMore) seeMore.click();
            
            const capEl = firstPost.querySelector('.feed-shared-update-v2__description-wrapper, .update-components-text, .attributed-text-segment-list__content, p[data-test-id="main-feed-activity-card__commentary"]');
            const caption = capEl && capEl.textContent ? capEl.textContent.trim() : firstPost.textContent.substring(0, 500).trim();
            
            const timeEl = firstPost.querySelector('.update-components-actor__sub-description, .feed-shared-actor__sub-description, time');
            const timestamp = timeEl && timeEl.textContent ? timeEl.textContent.trim() : "Recent";
            
            const likeEl = firstPost.querySelector('.social-details-social-counts__reactions-count') || firstPost.querySelector('[data-test-id="social-actions__reaction-count"]');
            const likes = likeEl && likeEl.textContent ? likeEl.textContent.trim() : "0";
            
            const comEl = firstPost.querySelector('.social-details-social-counts__comments');
            const comments = comEl && comEl.textContent ? comEl.textContent.trim() : "0";
            
            let mediaType = "Text";
            let mediaUrls = "";
            if (firstPost.querySelector('video')) {
                mediaType = "Video";
                const vid = firstPost.querySelector('video');
                mediaUrls = vid.getAttribute('src') || vid.getAttribute('poster') || "";
                if (!mediaUrls) {
                     const img = firstPost.querySelector('img.update-components-image__image, img.update-components-linkedin-video__poster');
                     if (img) mediaUrls = img.getAttribute('src') || "";
                }
            } else if (firstPost.querySelector('img')) {
                let imgs = Array.from(firstPost.querySelectorAll('img.update-components-image__image, ul[data-test-id="feed-images-content"] img, [data-test-id="feed-images-content__list-item"] img, img.ivm-view-attr__img--centered'));
                if (imgs.length === 0) {
                    imgs = Array.from(firstPost.querySelectorAll('img')).filter(img => {
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
            
            // Extract post URL (Unauthenticated views hide direct links, but expose the URN)
            let postUrl = "";
            const urn = firstPost.getAttribute('data-activity-urn') || firstPost.getAttribute('data-urn');
            if (urn) {
                postUrl = "https://www.linkedin.com/feed/update/" + urn + "/";
            } else {
                const links = firstPost.querySelectorAll('a[href*="/activity/"], a[href*="/posts/"], a.main-feed-card__overlay-link');
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
            
            return {
                caption: caption,
                timestamp: timestamp,
                mediaType: mediaType,
                mediaUrls: mediaUrls,
                likes: likes,
                comments: comments,
                postUrl: postUrl
            };
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
            
            const firstPost = document.querySelector('div[role="article"]');
            if (!firstPost) return null;
            
            // Extract Caption
            let caption = "";
            const capEl = firstPost.querySelector('div[data-ad-comet-preview="message"]');
            if (capEl) {
                caption = capEl.textContent.trim();
            } else {
                // Fallback for caption
                const autoEls = firstPost.querySelectorAll('div[dir="auto"]');
                for (const el of autoEls) {
                    const txt = el.textContent.trim();
                    if (txt.length > 50) { 
                        caption = txt;
                        break;
                    }
                }
            }
            
            // Extract Timestamp & URL dynamically
            let postUrl = "";
            let timestamp = "Recent";
            const anchors = Array.from(firstPost.querySelectorAll('a'));
            
            // The post permalink anchor usually contains /posts/, fbid=, /videos/, /reel/, /photo, or story.php
            const permalinkAnchor = anchors.find(a => {
                const href = a.getAttribute('href') || "";
                return href.includes('/posts/') || href.includes('fbid=') || href.includes('/videos/') || href.includes('/reel/') || href.includes('/photo') || href.includes('story.php');
            });
            
            if (permalinkAnchor) {
                postUrl = permalinkAnchor.getAttribute('href') || "";
                // The inner text of the permalink anchor is almost always the post timestamp
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
            
            // Extract Likes
            const likeEl = firstPost.querySelector('span.x1e558r4');
            const likes = likeEl && likeEl.textContent ? likeEl.textContent.trim() : "0";
            
            // Extract Media
            const fbIsVideo = postUrl.includes('/videos/') || postUrl.includes('/reel/') || postUrl.includes('/watch');
            let mediaType = fbIsVideo ? "Video" : "Text";
            let mediaUrls = "";
            
            if (firstPost.querySelector('video') || fbIsVideo) {
                mediaType = "Video";
                const vid = firstPost.querySelector('video');
                if (vid) {
                    mediaUrls = vid.getAttribute('src') || "";
                    if (mediaUrls.startsWith('blob:')) mediaUrls = "";
                    if (!mediaUrls) mediaUrls = vid.getAttribute('poster') || "";
                }
                
                if (!mediaUrls || mediaUrls.startsWith('blob:')) {
                    const imgs = Array.from(firstPost.querySelectorAll('img'));
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
            } else if (firstPost.querySelector('img')) {
                const imgs = Array.from(firstPost.querySelectorAll('img'));
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
            
            return {
                caption: caption,
                timestamp: timestamp,
                mediaType: mediaType,
                mediaUrls: mediaUrls,
                likes: likes,
                comments: "Hidden",
                postUrl: postUrl
            };
        `);
        
        if (data && (data as any).isPrivate) {
            throw new Error("PRIVATE_ACCOUNT");
        }
        
        if (!data) {
            throw new Error("Could not locate any posts on the Facebook page.");
        }
        
        return data;
    }

    private async extractYouTube(profileUrl: string): Promise<any> {
        if (!this.driver) throw new Error("Driver not initialized");
        
        let targetUrl = profileUrl;
        if (!targetUrl.endsWith('/videos')) {
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
            // Wait for the modal to dismiss and videos to load
            await this.driver.sleep(1500);
        } catch (e) {
            // Ignore if no modal present
        }
        
        try {
            await this.driver.wait(
                until.elementLocated(By.css('a[href*="/watch?v="]')),
                15000
            );
        } catch (e) {
            await this.driver.sleep(2000); 
        }
        
        const data = await this.driver.executeScript(`
            const links = document.querySelectorAll('a[href*="/watch?v="]');
            if (links.length === 0) return null;
            
            let firstVideo = null;
            let container = null;
            for (const link of links) {
                const text = link.textContent ? link.textContent.trim() : "";
                // Skip if empty or if it's just a time duration like "4:05" or "1:04:05"
                if (text.length > 3 && !/^(\\d+:)?\\d+:\\d+$/.test(text)) {
                    firstVideo = link;
                    container = link.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, ytd-video-renderer') || link.parentElement.parentElement;
                    break;
                }
            }
            
            if (!firstVideo) return null;
            
            const titleAttr = firstVideo.getAttribute('title');
            const title = titleAttr ? titleAttr.trim() : firstVideo.textContent.trim();
            
            let postUrl = firstVideo.getAttribute('href');
            if (postUrl && postUrl.startsWith('/')) {
                postUrl = "https://www.youtube.com" + postUrl;
            }
            if (!postUrl) postUrl = window.location.href;
            
            let timestamp = "Recent";
            let views = "0";
            if (container) {
                const spans = container.querySelectorAll('span');
                const timeSpan = Array.from(spans).find(s => s.textContent && s.textContent.toLowerCase().includes('ago'));
                if (timeSpan) timestamp = timeSpan.textContent.trim();
                
                const viewsSpan = Array.from(spans).find(s => s.textContent && s.textContent.toLowerCase().includes('views'));
                if (viewsSpan) views = viewsSpan.textContent.trim();
            }
            
            let mediaUrls = "None";
            if (postUrl && postUrl.includes("watch?v=")) {
                const vidIdMatch = postUrl.match(/watch\\?v=([^&]+)/);
                if (vidIdMatch && vidIdMatch[1]) {
                    mediaUrls = "https://img.youtube.com/vi/" + vidIdMatch[1] + "/hqdefault.jpg";
                }
            }

            return {
                caption: title,
                timestamp: timestamp,
                mediaType: "Video",
                mediaUrls: mediaUrls,
                likes: views,
                comments: "Hidden",
                postUrl: postUrl
            };
        `);
        
        if (data && (data as any).isPrivate) {
            throw new Error("PRIVATE_ACCOUNT");
        }
        
        if (!data) {
            throw new Error("Could not locate any videos on the YouTube channel.");
        }
        
        return data;
    }

    private formatOutput(platform: string, profileUrl: string, data: any): string {
        return `====================================================

Platform:
${platform}

Profile:
${profileUrl}

Latest Post

Date:
${data.timestamp || "Not found"}

Caption:
${data.caption || "No caption"}

Media Type:
${data.mediaType || "Unknown"}

Media URLs:
${data.mediaUrls || "None"}

Likes:
${data.likes || "Unknown"}

Comments:
${data.comments || "Unknown"}

Post URL:
${data.postUrl || "Not found"}

====================================================`;
    }
}
