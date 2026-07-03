const axios = require('axios');
const cheerio = require('cheerio');
async function run() {
  const q = encodeURIComponent('site:linkedin.com/posts/ "Scot Forge"');
  const res = await axios.get('https://html.duckduckgo.com/html/?q=' + q + '&df=m', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const $ = cheerio.load(res.data);
  $('.result__body').each((i, el) => {
    console.log($(el).find('.result__title').text().trim());
    console.log($(el).find('.result__snippet').text().trim());
  });
}
run().catch(console.error);
