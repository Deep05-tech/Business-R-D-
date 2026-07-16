import axios from 'axios';
import * as cheerio from 'cheerio';

async function searchDDG(query) {
  try {
    const res = await axios.post('https://html.duckduckgo.com/html/', `q=${encodeURIComponent(query)}`, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://html.duckduckgo.com',
        'Referer': 'https://html.duckduckgo.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    console.log("Success! status:", res.status);
    const $ = cheerio.load(res.data);
    console.log("Results count:", $('.result__body').length);
  } catch (e) {
    console.error("Failed:", e.response ? e.response.status : e.message);
  }
}
searchDDG("manufacturers in Rajkot");
