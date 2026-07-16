import axios from 'axios';
import * as cheerio from 'cheerio';

async function searchDDGProxy(query) {
  try {
    const targetUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    
    const res = await axios.get(proxyUrl);
    // allorigins returns JSON: { contents: "<html>..." }
    const html = res.data.contents;
    
    const $ = cheerio.load(html);
    const results = [];
    $('.result__body').each((i, el) => {
      const title = $(el).find('.result__title a').text().trim();
      const url = $(el).find('.result__url').attr('href') || $(el).find('.result__snippet').attr('href');
      const snippet = $(el).find('.result__snippet').text().trim();
      if (title && url) {
        results.push({ title, url, content: snippet });
      }
    });
    console.log(results);
  } catch (e) {
    console.error(e.message);
  }
}
searchDDGProxy("manufacturers in Rajkot");
