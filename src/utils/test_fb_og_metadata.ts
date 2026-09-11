import * as cheerio from "cheerio";

async function testOgMetadata() {
  const testPages = [
    "https://www.facebook.com/iskbearingsindustries/",
    "https://www.facebook.com/deltabearings/",
    "https://www.facebook.com/rhdbearings/",
    "https://www.facebook.com/ScheererBearing/",
    "https://www.facebook.com/JTEKTNAMERICA/",
    "https://www.facebook.com/findlingwaelzlager/"
  ];

  for (const pageUrl of testPages) {
    console.log(`\n=== Testing OG Metadata for ${pageUrl} ===`);
    try {
      // Test fetching via Googlebot User-Agent
      const res = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });

      const html = await res.text();
      const $ = cheerio.load(html);

      const ogTitle = $('meta[property="og:title"]').attr("content") || $("title").text();
      const ogDesc = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content");
      const ogImage = $('meta[property="og:image"]').attr("content");

      console.log("Status:", res.status);
      console.log("OG Title:", ogTitle);
      console.log("OG Description:", ogDesc?.slice(0, 150));
      console.log("OG Image:", ogImage);
    } catch (err: any) {
      console.error("Error:", err.message);
    }
  }
}

testOgMetadata();
