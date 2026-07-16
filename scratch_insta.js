import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import fs from 'fs';

async function run() {
    const options = new chrome.Options();
    options.addArguments('--headless=new');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--window-size=1920,1080');
    options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    try {
        console.log("Navigating to Instagram profile...");
        await driver.get("https://www.instagram.com/scot_forge/");
        await driver.sleep(5000);
        
        await driver.executeScript(`
            const firstPost = document.querySelector('a[href^="/p/"], a[href^="/reel/"]');
            if (firstPost) firstPost.click();
        `);
        await driver.sleep(4000); // Wait for modal

        const instaResult = await driver.executeScript(`
            const vids = Array.from(document.querySelectorAll('video')).map(v => ({src: v.src, poster: v.poster}));
            const imgs = Array.from(document.querySelectorAll('img')).map(i => i.src).filter(s => s && s.includes('scontent'));
            return { vids, imgs: imgs.slice(0, 5) };
        `);
        console.log("Insta Modal:", instaResult);

        console.log("Navigating to Facebook profile...");
        await driver.get("https://www.facebook.com/thyssenkruppdach/");
        await driver.sleep(5000);

        const fbResult = await driver.executeScript(`
            const posts = Array.from(document.querySelectorAll('[data-ad-comet-preview="message"], div[dir="auto"]')).slice(0, 5);
            let firstPost = posts.find(p => p.textContent && p.textContent.length > 20);
            if (!firstPost) return null;
            
            // Find parent that holds the whole post
            let parent = firstPost;
            for(let i=0; i<8; i++) { if(parent.parentElement) parent = parent.parentElement; }
            
            const vids = Array.from(parent.querySelectorAll('video')).map(v => ({src: v.src, poster: v.poster}));
            const imgs = Array.from(parent.querySelectorAll('img')).map(i => i.src).filter(s => s && s.includes('scontent'));
            return { vids, imgs };
        `);
        console.log("FB Post:", fbResult);
    } catch(e) {
        console.error(e);
    } finally {
        await driver.quit();
    }
}
run();
