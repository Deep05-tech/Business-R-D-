import axios from 'axios';
import * as cheerio from 'cheerio';

async function searchGoogle(query) {
  try {
    const res = await axios.get(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const $ = cheerio.load(res.data);
    const results = [];
    $('div.g').each((i, el) => {
      const title = $(el).find('h3').text().trim();
      const url = $(el).find('a').first().attr('href');
      const snippet = $(el).find('div[data-sncf="1"]').text().trim() || $(el).find('div[style="-webkit-line-clamp:2"]').text().trim() || $(el).text().substring(0, 150);
      if (title && url) {
        results.push({ title, url, content: snippet });
      }
    });
    console.log("Google results:", results.length);
    console.log(results[0]);
  } catch (e) {
    console.error(e.message);
  }
}
searchGoogle("manufacturers in Rajkot");
