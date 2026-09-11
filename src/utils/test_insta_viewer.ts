import * as cheerio from "cheerio";

async function testInstaViewer() {
  const handles = ["rhd_bearings", "usabearingsandbelts", "jtektnorthamerica", "findlingwlzlagergmbh"];

  for (const handle of handles) {
    console.log(`\n=== Testing Picuki for @${handle} ===`);
    try {
      const res = await fetch(`https://www.picuki.com/profile/${handle}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });

      console.log("Status:", res.status);
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        const posts: any[] = [];
        $(".box-photos .post-item, .profile-posts .post-item").each((_, el) => {
          const img = $(el).find("img").attr("src");
          const caption = $(el).find(".post-info-text, .post-description").text().trim();
          const link = $(el).find("a").attr("href");
          if (img) {
            posts.push({ img, caption: caption.slice(0, 80), link });
          }
        });
        console.log(`Extracted ${posts.length} posts from Picuki:`);
        posts.slice(0, 3).forEach((p, i) => console.log(`  [#${i+1}] Image: ${p.img}\n       Caption: ${p.caption}`));
      }
    } catch (e: any) {
      console.log("Error:", e.message);
    }
  }
}

testInstaViewer();
