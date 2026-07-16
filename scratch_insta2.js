import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

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
            const isArticle = document.querySelector('article') !== null;
            const imgs = Array.from(document.querySelectorAll('img')).map(i => ({
                src: i.src,
                style: i.getAttribute('style'),
                alt: i.getAttribute('alt'),
                inArticle: i.closest('article') !== null
            }));
            const vids = Array.from(document.querySelectorAll('video')).map(v => ({
                src: v.src,
                poster: v.poster,
                inArticle: v.closest('article') !== null
            }));
            return { isArticle, imgs: imgs.slice(0, 8), vids };
        `);
        console.log("Insta Modal:", JSON.stringify(instaResult, null, 2));
    } catch(e) {
        console.error(e);
    } finally {
        await driver.quit();
    }
}
run();
