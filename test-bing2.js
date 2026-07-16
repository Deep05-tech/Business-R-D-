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
    console.log(res.data.substring(0, 1500));
  } catch (e) {
    console.error(e.message);
  }
}
searchBing("manufacturers in Rajkot");
