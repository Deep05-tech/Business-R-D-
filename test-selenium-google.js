import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';
import * as cheerio from 'cheerio';

async function searchGoogleSelenium(query) {
  const options = new chrome.Options();
  options.addArguments('--headless=new');
  options.addArguments('--disable-gpu');
  options.addArguments('--no-sandbox');
  options.addArguments('--disable-dev-shm-usage');
  options.addArguments('--window-size=1920,1080');

  let driver;
  try {
    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build();
    await driver.get(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    // Wait for results
    await driver.wait(until.elementLocated(By.css('div.g')), 10000);
    const html = await driver.getPageSource();
    
    const $ = cheerio.load(html);
    const results = [];
    $('div.g').each((i, el) => {
      const title = $(el).find('h3').text().trim();
      const url = $(el).find('a').first().attr('href');
      const snippet = $(el).find('div[style="-webkit-line-clamp:2"]').text().trim() || $(el).find('.VwiC3b').text().trim() || $(el).text().substring(0, 150);
      if (title && url) {
        results.push({ title, url, content: snippet });
      }
    });
    console.log("Success! Found:", results.length);
    console.log(results[0]);
  } catch (e) {
    console.error(e.message);
  } finally {
    if (driver) await driver.quit();
  }
}

searchGoogleSelenium("manufacturers in Rajkot");
