import axios from 'axios';
import * as cheerio from 'cheerio';

async function searchYahoo(query) {
  try {
    const res = await axios.get(`https://search.yahoo.com/search?p=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36)'
      }
    });
    const $ = cheerio.load(res.data);
    const results = [];
    $('.algo').each((i, el) => {
      const title = $(el).find('h3.title a').text().trim();
      const url = $(el).find('h3.title a').attr('href');
      const snippet = $(el).find('.compTitle').next().text().trim() || $(el).find('.compText').text().trim() || $(el).find('.fc-falcon').text().trim();
      if (title && url) {
        results.push({ title, url, content: snippet });
      }
    });
    console.log(results);
  } catch (e) {
    console.error(e.message);
  }
}
searchYahoo("manufacturers in Rajkot");
