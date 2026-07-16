const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

async function run() {
    const options = new chrome.Options();
    options.addArguments('--headless=new');
    options.addArguments('--disable-gpu');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    options.addArguments('--user-data-dir=/home/uday/Agents/Business R&D/chrome_profile');

    let driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    try {
        await driver.get('https://www.instagram.com/reel/Cw-l4_Nq68t/');
        await driver.sleep(5000);
        
        const data = await driver.executeScript(`
            const scripts = Array.from(document.querySelectorAll('script'));
            const stateScript = scripts.find(s => s.textContent.includes('video_versions') || s.textContent.includes('video_url'));
            if (!stateScript) return "No state script found";
            
            // Try to regex out the video url
            const matches = stateScript.textContent.match(/"video_url":\s*"([^"]+)"/);
            if (matches) return matches[1].replace(/\\\\u0026/g, '&');
            
            return "Found script but no video_url regex match";
        `);
        console.log("Extracted:", data);
        
    } catch (e) {
        console.error(e);
    } finally {
        await driver.quit();
    }
}
run();
