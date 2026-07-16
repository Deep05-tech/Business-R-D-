import axios from 'axios';
import * as cheerio from 'cheerio';

async function searchDDGLite(query) {
  try {
    const res = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36)'
      }
    });
    const $ = cheerio.load(res.data);
    const results = [];
    $('tr').each((i, el) => {
      const titleEl = $(el).find('td.result-snippet').prev('td').find('a.result-url'); // Not accurate
    });
    // Let's just print HTML and inspect
    console.log(res.data.substring(0, 1000));
  } catch (e) {
    console.error(e.message);
  }
}
searchDDGLite("manufacturers in Rajkot");
