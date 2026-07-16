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
        console.log("Navigating directly to Instagram Reel...");
        await driver.get("https://www.instagram.com/reel/C7m-K8sO_3H/");
        await driver.sleep(3000);
        
        const instaMeta = await driver.executeScript(`
            const ogVideo = document.querySelector('meta[property="og:video"]');
            const ogImage = document.querySelector('meta[property="og:image"]');
            const vid = document.querySelector('video');
            return {
                ogVideo: ogVideo ? ogVideo.content : null,
                ogImage: ogImage ? ogImage.content : null,
                vidSrc: vid ? vid.src : null
            };
        `);
        console.log("Insta Post Meta:", instaMeta);

        console.log("Navigating directly to Facebook Video...");
        await driver.get("https://www.facebook.com/thyssenkruppdach/videos/314220371404177");
        await driver.sleep(3000);

        const fbMeta = await driver.executeScript(`
            const ogVideo = document.querySelector('meta[property="og:video"]');
            const ogVideoUrl = document.querySelector('meta[property="og:video:url"]');
            const ogImage = document.querySelector('meta[property="og:image"]');
            return {
                ogVideo: ogVideo ? ogVideo.content : null,
                ogVideoUrl: ogVideoUrl ? ogVideoUrl.content : null,
                ogImage: ogImage ? ogImage.content : null,
            };
        `);
        console.log("FB Post Meta:", fbMeta);
    } catch(e) {
        console.error(e);
    } finally {
        await driver.quit();
    }
}
run();
