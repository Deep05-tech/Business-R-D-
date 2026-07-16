import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

async function run() {
    const options = new chrome.Options();
    options.addArguments('--headless=new');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--window-size=1920,1080');

    const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    try {
        console.log("Navigating to Facebook...");
        await driver.get("https://www.facebook.com/thyssenkruppdach/");
        await driver.sleep(5000);
        
        await driver.executeScript('window.scrollBy(0, 1000)');
        await driver.sleep(3000);

        const fbSource = await driver.executeScript(`
            const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent);
            let mp4s = [];
            for (const script of scripts) {
                if (!script) continue;
                // find all URLs ending with .mp4 or containing .mp4?
                const matches = script.match(/https:\\\/\\\/[^\"]+\\.mp4[^\"]*/g);
                if (matches) mp4s.push(...matches);
                const matches2 = script.match(/https:\\\/\\\/video[^\"]+/g);
                if (matches2) mp4s.push(...matches2);
            }
            return mp4s;
        `);
        console.log("FB MP4s:", fbSource.length > 0 ? fbSource.slice(0, 5) : "None found");
        
        console.log("Navigating to Instagram...");
        await driver.get("https://www.instagram.com/scot_forge/");
        await driver.sleep(5000);
        
        const instaSource = await driver.executeScript(`
            const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent);
            let mp4s = [];
            for (const script of scripts) {
                if (!script) continue;
                const matches = script.match(/https:\\\/\\\/[^\"]+\\.mp4[^\"]*/g);
                if (matches) mp4s.push(...matches);
                // Also look for display_url for high-res images
                const imgs = script.match(/"display_url":"(https:[^"]+)"/g);
                if (imgs) mp4s.push(...imgs);
            }
            return mp4s;
        `);
        console.log("Insta MP4s:", instaSource.length > 0 ? instaSource.slice(0, 5) : "None found");
    } catch(e) {
        console.error(e);
    } finally {
        await driver.quit();
    }
}
run();
