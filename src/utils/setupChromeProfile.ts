import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupProfile() {
    console.log("Launching Chrome to set up persistent profile...");
    
    const profilePath = path.resolve(__dirname, '../../chrome_profile');
    console.log(`Profile will be saved to: ${profilePath}`);
    
    const options = new chrome.Options();
    options.addArguments(`--user-data-dir=${profilePath}`);
    
    // We intentionally DO NOT run headless here so the user can log in
    // options.addArguments('--headless');
    
    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build();
        
    // Automatically open the login pages to save time
    await driver.get('https://www.linkedin.com/login');
    await driver.switchTo().newWindow('tab');
    await driver.get('https://www.instagram.com/accounts/login/');
        
    console.log("==========================================================");
    console.log("BROWSER OPEN!");
    console.log("1. Please log into your LinkedIn account.");
    console.log("2. Please log into your Instagram account.");
    console.log('3. Once you are fully logged in and have checked "Remember Me", close the browser window manually.');
    console.log("==========================================================");
    
    // Wait until the user closes the window
    try {
        while (true) {
            await driver.getTitle();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    } catch (e: any) {
        console.log("Browser window closed. Profile setup complete!");
    }
}

setupProfile();
