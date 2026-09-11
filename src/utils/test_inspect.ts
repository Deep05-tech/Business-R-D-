import * as cheerio from "cheerio";

async function inspectHtml() {
  const testUrls = [
    "https://www.facebook.com/ScheererBearing/",
    "https://www.facebook.com/deltabearings/",
    "https://www.facebook.com/rhdbearings/"
  ];

  for (const pageUrl of testUrls) {
    const pluginUrl = `https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(pageUrl)}&tabs=timeline&width=500`;

    const res = await fetch(pluginUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const html = await res.text();
    const $ = cheerio.load(html);

    console.log(`\n=== Inspection for ${pageUrl} ===`);
    console.log("Total <a> tags:", $("a").length);

    $("a").each((i, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().trim();
      console.log(`  Link [${i}]: text="${text}" -> href="${href}"`);
    });
  }
}

inspectHtml();
