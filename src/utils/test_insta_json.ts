import * as cheerio from "cheerio";

async function testInstaJson() {
  const url = "https://www.instagram.com/rhd_bearings/";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  console.log("Scripts count:", $("script").length);
  $("script").each((i, el) => {
    const text = $(el).html() || "";
    if (text.includes("display_url") || text.includes("thumbnail_src") || text.includes("shared_data") || text.includes("profile_pic_url")) {
      console.log(`\nScript #${i} contains media keys! Length:`, text.length);
      const matches = text.match(/https?:\\\/\\\/[^\s"']+(?:cdninstagram|fbcdn)[^\s"']+/g);
      if (matches) {
        console.log("Found CDN images:", matches.slice(0, 5).map(m => m.replace(/\\/g, "")));
      }
    }
  });
}

testInstaJson();
