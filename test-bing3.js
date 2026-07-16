import axios from 'axios';
import * as cheerio from 'cheerio';

async function searchBing(query) {
  try {
    const res = await axios.get(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const $ = cheerio.load(res.data);
    const results = [];
    $('li.b_algo').each((i, el) => {
      const title = $(el).find('h2 a').text().trim();
      const url = $(el).find('h2 a').attr('href');
      const snippet = $(el).find('.b_caption p').text().trim() || $(el).find('.b_algoSlug').text().trim();
      if (title && url) {
        results.push({ title, url, content: snippet });
      }
    });
    console.log(results);
  } catch (e) {
    console.error(e.message);
  }
}
searchBing("manufacturers in Rajkot");
