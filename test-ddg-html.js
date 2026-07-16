import axios from 'axios';
import * as cheerio from 'cheerio';

async function searchDDG(query) {
  try {
    const res = await axios.post('https://html.duckduckgo.com/html/', `q=${encodeURIComponent(query)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const $ = cheerio.load(res.data);
    const results = [];
    $('.result__body').each((i, el) => {
      const title = $(el).find('.result__title a').text().trim();
      const url = $(el).find('.result__url').attr('href') || $(el).find('.result__snippet').attr('href');
      const snippet = $(el).find('.result__snippet').text().trim();
      if (title && url) {
        // DDG html urls are often relative redirect links
        // We can just grab the text of the URL for simplicity if needed, but let's grab the actual href or the visible url string
        const visibleUrl = $(el).find('.result__url').text().trim();
        results.push({ title, url: visibleUrl || url, content: snippet });
      }
    });
    console.log(results);
  } catch (e) {
    console.error(e);
  }
}
searchDDG("manufacturers in Rajkot");
