import * as cheerio from "cheerio";

async function testMobileFetch() {
  const testPages = [
    "ScheererBearing",
    "deltabearings",
    "rhdbearings",
    "iskbearingsindustries"
  ];

  for (const slug of testPages) {
    const mobileUrl = `https://mbasic.facebook.com/${slug}`;
    try {
      const res = await fetch(mobileUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });

      console.log(`\n=== mbasic Fetch for ${slug} (Status: ${res.status}) ===`);
      const html = await res.text();
      const $ = cheerio.load(html);

      const postLinks: string[] = [];
      $("a").each((i, el) => {
        const href = $(el).attr("href") || "";
        if (href.includes("/story.php") || href.includes("/posts/") || href.includes("story_fbid") || href.includes("pfbid")) {
          postLinks.push(href);
        }
      });

      console.log(`Found ${postLinks.length} post links:`, postLinks.slice(0, 5));
    } catch (err: any) {
      console.error(`Error for ${slug}:`, err.message);
    }
  }
}

testMobileFetch();
