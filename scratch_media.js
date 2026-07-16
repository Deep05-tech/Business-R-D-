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
        console.log("Navigating to Instagram...");
        await driver.get("https://www.instagram.com/scot_forge/");
        await driver.sleep(5000);
        
        const pageSource = await driver.executeScript(`
            const articles = document.querySelectorAll('article');
            const images = document.querySelectorAll('img');
            const videos = document.querySelectorAll('video');
            const posts = document.querySelectorAll('a[href^="/p/"]');
            
            return {
                imgCount: images.length,
                videoCount: videos.length,
                postCount: posts.length,
                imgUrls: Array.from(images).map(i => i.src).filter(s => !s.includes('data:')).slice(0, 10),
                postHrefs: Array.from(posts).map(p => p.href).slice(0, 5)
            };
        `);
        console.log("Insta Results:", pageSource);

        console.log("Navigating to Facebook...");
        await driver.get("https://www.facebook.com/thyssenkruppdach/");
        await driver.sleep(5000);
        
        await driver.executeScript('window.scrollBy(0, 1000)');
        await driver.sleep(3000);

        const fbSource = await driver.executeScript(`
            const videos = document.querySelectorAll('video');
            return {
                vidCount: videos.length,
                vids: Array.from(videos).map(v => ({
                    src: v.src,
                    poster: v.poster,
                    outer: v.outerHTML
                }))
            };
        `);
        console.log("FB Results:", fbSource);
    } catch(e) {
        console.error(e);
    } finally {
        await driver.quit();
    }
}
run();
