import * as cheerio from "cheerio";

async function testRealInstaFb() {
  const instaUsers = [
    "deltabearings",
    "rhd_bearings",
    "usabearingsandbelts",
    "scheererbearingcorpcorporateoffice",
    "jtektnorthamerica",
    "findlingwlzlagergmbh"
  ];

  console.log("=== Testing Real Instagram Fetching ===");
  for (const user of instaUsers) {
    try {
      const url = `https://www.instagram.com/${user}/`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });
      const html = await res.text();
      const $ = cheerio.load(html);
      const ogTitle = $('meta[property="og:title"]').attr("content");
      const ogImage = $('meta[property="og:image"]').attr("content");
      const ogDesc = $('meta[property="og:description"]').attr("content");

      console.log(`\n[Instagram: @${user}]`);
      console.log("  Status     :", res.status);
      console.log("  OG Title   :", ogTitle);
      console.log("  OG Image   :", ogImage);
      console.log("  OG Desc    :", ogDesc?.slice(0, 100));
    } catch (e: any) {
      console.log(`[Instagram: @${user}] Error:`, e.message);
    }
  }
}

testRealInstaFb();
