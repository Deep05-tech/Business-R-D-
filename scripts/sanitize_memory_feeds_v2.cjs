const fs = require('fs');
const path = require('path');
const { isAuthenticCompetitorProfile, verifyPostAuthor, extractDistinctiveBrandTokens } = require('../dist/utils/socialVerificationUtils.js');

const memoryFiles = [
  path.join(__dirname, '../data/memory/Steelnex_Precision_steelnexprecision_com.json'),
  path.join(__dirname, '../data/memory/Metallic_Technoforge_Limited_metalictechnoforge_com.json')
];

for (const file of memoryFiles) {
  if (!fs.existsSync(file)) continue;
  console.log(`\n======================================================`);
  console.log(`Auditing: ${path.basename(file)}`);
  console.log(`======================================================`);

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  let removedSocialUrls = 0;
  let removedFeedPosts = 0;
  let keptFeedPosts = 0;

  // 1. Audit competitor profiles
  const auditCompetitorList = (comps) => {
    if (!Array.isArray(comps)) return;
    for (const c of comps) {
      if (!c.socials) continue;
      for (const platform of ['instagram', 'facebook', 'youtube', 'linkedin']) {
        const url = c.socials[platform];
        if (url) {
          const capPlat = platform.charAt(0).toUpperCase() + platform.slice(1);
          const valid = isAuthenticCompetitorProfile(url, capPlat, c.name);
          if (!valid) {
            console.log(`[PRUNED SOCIAL URL] ${c.name} -> ${capPlat}: ${url}`);
            c.socials[platform] = null;
            removedSocialUrls++;
          }
        }
      }
    }
  };

  auditCompetitorList(data.competitors);
  if (data.marketingSales && data.marketingSales.competitors) {
    auditCompetitorList(data.marketingSales.competitors);
  }
  if (data.competitive_intelligence && data.competitive_intelligence.competitors) {
    auditCompetitorList(data.competitive_intelligence.competitors);
  }

  // 2. Audit feed items
  const auditFeedArray = (feedName) => {
    let list = data[feedName];
    let isNested = false;
    if (!list && data.competitive_intelligence) {
      list = data.competitive_intelligence[feedName];
      isNested = true;
    }
    if (!Array.isArray(list)) return;

    const filtered = [];
    for (const p of list) {
      const compName = p.company || p.competitorName || '';
      const platform = p.platform || '';
      const postUrl = p.post_url || p.postUrl || p.link || '';
      const cap = (p.caption || p.content || '').toLowerCase();

      // Universal group and spam reject
      if (postUrl.includes('/groups/') || postUrl.includes('/community/') || postUrl.includes('castingcalls')) {
        console.log(`[PRUNED FEED POST - GROUP/SPAM] [${compName}] [${platform}] ${postUrl}`);
        removedFeedPosts++;
        continue;
      }

      // Specific known mismatched captions / authors
      if (
        cap.includes('luxuryvending') ||
        cap.includes('lushrooftopandbar') ||
        cap.includes('perfume vending machine') ||
        cap.includes('branding_wala') ||
        cap.includes('effort steel engineering') ||
        cap.includes('welcome our new members') ||
        cap.includes('pattern shop incharge') ||
        p.profile_url === 'https://www.instagram.com/inverseferrocast' ||
        p.profile_url === 'https://www.instagram.com/castingcallsusa' ||
        p.profile_url === 'https://www.instagram.com/cityofdecatural?hl=en' ||
        p.profile_url === 'https://www.facebook.com/facebook' ||
        p.profile_url === 'https://www.facebook.com/ForceLink.Machine.Tools' ||
        p.profile_url === 'https://www.instagram.com/lmwfoundry'
      ) {
        console.log(`[PRUNED FEED POST - MISMATCH] [${compName}] [${platform}] "${(p.caption || '').slice(0, 60)}..."`);
        removedFeedPosts++;
        continue;
      }

      // Check author verification
      const isAuthorValid = verifyPostAuthor(platform, {
        postUrl,
        ogTitle: p.caption,
        ogDesc: p.caption
      }, compName, p.profile_url || p.profileUrl);

      if (!isAuthorValid) {
        console.log(`[PRUNED FEED POST - AUTHOR MISMATCH] [${compName}] [${platform}] "${(p.caption || '').slice(0, 60)}..."`);
        removedFeedPosts++;
        continue;
      }

      filtered.push(p);
      keptFeedPosts++;
    }

    if (data[feedName]) {
      data[feedName] = filtered;
    } else if (isNested) {
      data.competitive_intelligence[feedName] = filtered;
    }
  };

  auditFeedArray('socialFeed');
  auditFeedArray('social_feed');
  auditFeedArray('feed');
  auditFeedArray('feedItems');

  console.log(`Summary for ${path.basename(file)}:`);
  console.log(` - Pruned bogus competitor social URLs: ${removedSocialUrls}`);
  console.log(` - Pruned mismatched/third-party posts: ${removedFeedPosts}`);
  console.log(` - Kept authentic competitor posts: ${keptFeedPosts}`);

  // Save sanitized memory file
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Successfully saved sanitized ${path.basename(file)}.`);
}
