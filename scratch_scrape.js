import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import fs from 'fs';

async function run() {
    const options = new chrome.Options();
    options.addArguments('--headless=new');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--window-size=1920,1080');
    // Important: LinkedIn and FB block headless user agents easily.
    options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    try {
        console.log("Navigating to LinkedIn...");
        await driver.get("https://www.linkedin.com/company/bharat-forge-ltd/posts/?feedView=all");
        await driver.sleep(5000);
        
        // Scroll down
        await driver.executeScript('window.scrollBy(0, 500)');
        await driver.sleep(2000);

        const firstPost = await driver.executeScript(`
            const post = document.querySelector('.feed-shared-update-v2') || document.querySelector('[data-urn]') || document.querySelector('article[data-id="main-feed-card"]') || document.querySelector('.main-feed-activity-card') || document.querySelector('.top-post');
            return post ? post.outerHTML : "No post found";
        `);
        fs.writeFileSync("linkedin_dump.html", firstPost || "null returned");
        console.log("Saved linkedin_dump.html");

        console.log("Navigating to Facebook...");
        await driver.get("https://www.facebook.com/BharatForgeLtd/");
        await driver.sleep(5000);
        
        await driver.executeScript('window.scrollBy(0, 1000)');
        await driver.sleep(3000);

        const fbPost = await driver.executeScript(`
            const posts = Array.from(document.querySelectorAll('div[role="article"]'));
            // Filter out empty ghost articles
            const realPost = posts.find(p => p.textContent.length > 50);
            return realPost ? realPost.outerHTML : "No post found";
        `);
        fs.writeFileSync("facebook_dump.html", fbPost || "null returned");
        console.log("Saved facebook_dump.html");
    } catch(e) {
        console.error(e);
    } finally {
        await driver.quit();
    }
}
run();
