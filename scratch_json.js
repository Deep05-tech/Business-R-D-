import { Builder } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

async function run() {
    const options = new chrome.Options();
    options.addArguments('--headless=new');
    options.addArguments('--no-sandbox');
    const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    try {
        await driver.get("https://www.instagram.com/reel/C7m-K8sO_3H/?__a=1&__d=dis");
        await driver.sleep(3000);
        const source = await driver.executeScript('return document.body.innerText');
        console.log("JSON Length:", source.length);
        if (source.length < 5000) console.log("JSON:", source);
    } catch(e) {
        console.error(e);
    } finally {
        await driver.quit();
    }
}
run();
