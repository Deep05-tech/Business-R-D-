import * as cheerio from "cheerio";

async function testDdgSearch() {
  const queries = [
    `site:instagram.com "rhd_bearings"`,
    `site:facebook.com "Scheerer Bearing"`,
    `site:facebook.com "Delta Bearing"`
  ];

  for (const q of queries) {
    console.log(`\n=== DDG Search: ${q} ===`);
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      const html = await res.text();
      const $ = cheerio.load(html);
      const results: any[] = [];
      $(".result").each((_, el) => {
        const title = $(el).find(".result__title").text().trim();
        const link = $(el).find(".result__url").text().trim();
        const snippet = $(el).find(".result__snippet").text().trim();
        results.push({ title, link, snippet });
      });
      console.log(`Found ${results.length} results:`);
      results.slice(0, 3).forEach((r, i) => console.log(`  [#${i+1}] ${r.title}\n       Link   : ${r.link}\n       Snippet: ${r.snippet.slice(0, 90)}`));
    } catch (e: any) {
      console.log("Error:", e.message);
    }
  }
}

testDdgSearch();
