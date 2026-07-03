const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

async function run() {
  const options = new chrome.Options();
  options.addArguments('--headless=new', '--disable-gpu', '--no-sandbox');
  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
  try {
    await driver.get('http://localhost:3000/');
    const btn = await driver.findElement(By.id('tab-competitor'));
    await btn.click();
    console.log("Clicked successfully!");
    
    // Check if error is logged
    const logs = await driver.manage().logs().get('browser');
    logs.forEach(l => console.log(l.level.name, l.message));
  } catch (err) {
    console.error("Error clicking:", err);
  } finally {
    await driver.quit();
  }
}
run();
