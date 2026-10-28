#!/usr/bin/env node
/**
 * Deployment Verification Script for Business R&D Agent
 *
 * Requires: npm install playwright
 * Run with: node test-deployment-verification.cjs
 */
const playwright = require('playwright');

const CONFIG = {
  baseUrl:   'https://business-rd-agent.onrender.com',
  username:  'demo',
  password:  'demo1234',
  headless:  false,   // set true for CI / headless runs
  slowMo:    100,     // visual delay – 0 for no delay
  timeout:   180000   // 3 min; adjust if the pipeline takes longer
};

const SELECTORS = {
  // login (overlay on root page)
  usernameInput: '#login-username',
  passwordInput: '#login-password',
  loginButton:   '#login-submit-btn',

  // project picker
  projectSelector: 'select[name="project"]',
  projectCards:    '.project-item, .project-card',

  // navigation tabs
  navCompetitors: '#nav-competitors, a[href*="competitors"]',
  navSocialFeed:  '#nav-social-feed,      a[href*="social-feed"]',

  // competitors tab
  btnFindCompetitors:    '#btn-find-comp, button:has-text("Find Competitors")',
  btnRecrawlDeeply:      '#btn-regen-comp, button:has-text("Re‑crawl Deeply")',
  competitorList:        '#competitor-list',
  competitorCard:        '.competitor-card',
  liveCompHeader:        '#live-comp-header',
  liveCompCards:         '#live-comp-cards',

  // social‑feed tab
  btnRunTracker: '#btn-cron, button:has-text("Run Competitor Tracker Now")',
  feedList:      '#feed-list',
  feedCard:      '.feed-card-item',
  trackerRunningCard: '[style*="Competitor Social Tracker in Progress"]',
  trackerProgress:    '#tracker-elapsed-text',

  // lightbox
  mediaLightbox:    '#media-lightbox, .media-lightbox',
  lightboxContent:  '#media-lightbox-content',
  lightboxClose:    '.media-lightbox-close, button[aria-label="Close post preview"]',
  postPreviewMedia: '.post-preview-media',
  postPreviewDetails: '.post-preview-details',
  postPreviewCaption: '.post-preview-caption',
  postPreviewAuthor:  '.post-preview-author'
};

async function waitForElement(page, selector, options={timeout:30000,state:'visible'}) {
  try { return await page.waitForSelector(selector,{...options}); }
  catch(_) { console.log(`⚠️ Element not found: ${selector}`); return null; }
}

async function clickAndWait(page, selector, waitMs=1000) {
  const el = await waitForElement(page, selector);
  if (!el) return false;
  await el.click(); await page.waitForTimeout(waitMs);
  return true;
}

async function login(page) {
  console.log('\n🔐 Logging in...');
  await page.goto(`${CONFIG.baseUrl}/`);
  await page.waitForSelector(SELECTORS.usernameInput, {timeout: 30000, state: 'visible'});
  await page.fill(SELECTORS.usernameInput, CONFIG.username);
  await page.fill(SELECTORS.passwordInput, CONFIG.password);
  await clickAndWait(page, SELECTORS.loginButton);
  // Wait for login overlay to disappear and dashboard to show
  await page.waitForSelector('#login-overlay', {state: 'hidden', timeout: 30000});
  await page.waitForTimeout(2000);
  console.log('✅ Logged in.');
}

async function getProjects(page) {
  console.log('\n📋 Fetching projects...');

  // First try to load projects via API
  try {
    const response = await fetch(`${CONFIG.baseUrl}/api/sites`);
    if (response.ok) {
      const projects = await response.json();
      console.log(`Found ${projects.length} projects via API`);
      return projects.map(p => ({url: p.url, text: p.name || p.url}));
    }
  } catch (err) {
    console.log(`API call failed: ${err.message}`);
  }

  // Fallback to UI elements
  try {
    const cards = await page.$$(SELECTORS.projectCards);
    const out = [];
    for (const card of cards) {
      const url = await card.getAttribute('data-project-url') || await card.getAttribute('href');
      const txt = await card.evaluate(el => el.textContent, card);
      if (url) out.push({url, text: txt?.trim() || 'Unnamed'});
    }
    console.log(`Found ${out.length} projects (cards)`);
    return out;
  } catch (err) {
    console.log(`UI element parsing failed: ${err.message}`);
    return [];
  }
}

async function selectProject(page, url) {
  console.log(`\n📂 Selecting project: ${url}`);
  const sel = await page.$(SELECTORS.projectSelector);
  if (sel) {
    await sel.selectOption(url);
    await page.waitForTimeout(2000);
  } else {
    await page.goto(`${CONFIG.baseUrl}/dashboard?url=${encodeURIComponent(url)}`);
  }
}

async function navigateToTab(page, tabSel, name) {
  console.log(`\n📑 Navigating to ${name} tab...`);
  await clickAndWait(page, tabSel);
  await page.waitForTimeout(2000);
  console.log(`✅ On ${name} tab`);
}

async function waitForDiscovery(page, maxMs = 300000) {
  console.log('\n🔍 Waiting for competitor discovery...');
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const btn = await page.$(SELECTORS.btnRecrawlDeeply);
    const header = await page.$(SELECTORS.liveCompHeader);
    const cards = await page.$(SELECTORS.liveCompCards);

    if (btn && (await btn.isVisible()) && !(await btn.isDisabled())) {
      console.log('✅ Discovery finished.');
      return true;
    }
    if (header && !(await header.isVisible())) {
      console.log('✅ Discovery finished (header gone).');
      return true;
    }
    if (cards) {
      const cnt = await cards.$$eval('.competitor-card', c => c.length);
      if (cnt > 0) console.log(`🔎 Found ${cnt} live competitors…`);
    }
    await page.waitForTimeout(5000);
  }
  console.log('⚠️ Discovery timeout.');
  return false;
}

async function waitForTracker(page, maxMs = 600000) {
  console.log('\n⏳ Waiting for tracker...');
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const card = await page.$(SELECTORS.trackerRunningCard);
    if (card && await card.isVisible()) {
      const prog = await page.$(SELECTORS.trackerProgress);
      console.log(`📈 ${await prog?.textContent()}`);
    } else {
      const btn = await page.$(SELECTORS.btnRunTracker);
      if (btn && !(await btn.isDisabled())) {
        console.log('✅ Tracker completed.');
        return true;
      }
    }
    const feed = await page.$(SELECTORS.feedList);
    if (feed) {
      const len = await feed.$$eval('.feed-card-item', c => c.length);
      if (len > 0) {
        console.log(`📊 Feed loaded (${len} posts)`);
        return true;
      }
    }
    await page.waitForTimeout(5000);
  }
  console.log('⚠️ Tracker timeout.');
  return false;
}

async function verifySocialAccounts(page) {
  console.log('\n🔍 Checking competitors have ≥ 2 social handles...');
  const list = await page.$(SELECTORS.competitorList);
  if (!list) { console.log('❌ List missing'); return {passed: false, details: []}; }

  const cards = await list.$$(SELECTORS.competitorCard);
  const details = [];
  let ok = true;

  for (const card of cards) {
    const name = await card.$eval('h3, h4, .competitor-name, .info-name', e => e.textContent.trim());
    const links = await card.$$eval(
      'a[href*="linkedin.com"], a[href*="instagram.com"], a[href*="facebook.com"], a[href*="youtube.com"], a[href*="twitter.com"]',
      n => n.length
    );
    const icons = await card.$$eval('[class*="linkedin"], [class*="instagram"], [class*="facebook"], [class*="youtube"], [class*="twitter"]', n => n.length);
    const total = links + icons;
    const passed = total >= 2;
    if (!passed) ok = false;
    details.push({name, total, passed});
    console.log(`${passed ? '✅' : '❌'} ${name} – ${total} socials`);
  }
  return {passed: ok, details};
}

async function verifyFeedPosts(page) {
  console.log('\n🔎 Verifying feed posts contain media previews...');
  const list = await page.$(SELECTORS.feedList);
  if (!list) { console.log('❌ Feed missing'); return {passed: false, details: {} }; }

  const cards = await list.$$(SELECTORS.feedCard);
  const details = { platformCounts: {}, postsChecked: [] };
  let all = true;

  for (let i = 0; i < Math.min(cards.length, 10); i++) {
    const c = cards[i];
    const media = await c.$('img, video, iframe');
    const platform = await c.$eval('.feed-platform, .platform-badge', e => e.textContent.trim());
    const name = await c.$eval('h3, h4, .feed-competitor-name', e => e.textContent.trim());
    const hasMedia = !!media;
    const hasCaption = !!(await c.$('.post-preview-caption'));
    all = all && hasMedia && hasCaption;

    details.postsChecked.push({name, platform, hasMedia, hasCaption});
    console.log(`${hasMedia ? '✅' : '❌'} ${name} – ${platform} ${hasMedia ? 'media' : 'no media'}`);
  }
  return {passed: all, details};
}

async function verifyLightbox(page) {
  console.log('\n🔍 Checking lightbox shows media on left, caption on right...');
  const card = await page.$(SELECTORS.feedCard);
  if (!card) { console.log('❌ No feed card to click'); return {passed: false}; }

  await card.click(); await page.waitForTimeout(1000);
  const lb = await page.$(SELECTORS.mediaLightbox);
  if (!lb || !(await lb.isVisible())) { console.log('❌ Lightbox did not open'); return {passed:false}; }

  const media = await lb.$('.post-preview-media').$eval('img, video, iframe', e => e.tagName);
  const caption = await lb.$('.post-preview-caption');
  const author = await lb.$('.post-preview-author');
  const passed = !!(media && caption && author);
  console.log(`✅ Lightbox layout OK: Media=${!!media} Caption=${!!caption} Author=${!!author}`);
  await page.click(SELECTORS.mediaLightboxClose); await page.waitForTimeout(500);

  return {passed};
}

async function runProjectTest(page, proj) {
  const r = {project: proj.text, url: proj.url, competitorDiscovery: false,
             competitorSocials: false, trackerDone: false,
             feedOK: false, lightboxOK: false};

  await selectProject(page, proj.url);

  // Competitors tab
  await navigateToTab(page, SELECTORS.navCompetitors, 'Competitors');
  let clicked = await clickAndWait(page, SELECTORS.btnRecrawlDeeply);
  if (!clicked) await clickAndWait(page, SELECTORS.btnFindCompetitors);
  r.competitorDiscovery = await waitForDiscovery(page);
  if (r.competitorDiscovery) r.competitorSocials = (await verifySocialAccounts(page)).passed;

  // Competitor feed
  await navigateToTab(page, SELECTORS.navSocialFeed, 'Competitor Feed');
  await clickAndWait(page, SELECTORS.btnRunTracker);
  r.trackerDone = await waitForTracker(page);
  if (r.trackerDone) {
    r.feedOK = (await verifyFeedPosts(page)).passed;
    r.lightboxOK = (await verifyLightbox(page)).passed;
  }

  return r;
}

async function main() {
  console.log('🚀 Starting deployment verification…');
  const browser = await playwright.chromium.launch({headless: CONFIG.headless, slowMo: CONFIG.slowMo});
  const context = await browser.newContext({viewport:{width:1280,height:720}});
  const page = await context.newPage();

  await login(page);

  const projects = await getProjects(page);
  if (!projects.length) { console.log('❌ No projects found.'); await browser.close(); return; }

  const allResults = [];
  for (const p of projects) {
    console.log('═'.repeat(60));
    console.log(`📊 Testing project: ${p.text}`);
    console.log(`   URL: ${p.url}`);
    console.log('═'.repeat(60));

    const res = await runProjectTest(page, p);
    allResults.push(res);
    await page.waitForTimeout(3000);
  }

  await browser.close();

  const allPassed = allResults.every(r =>
    r.competitorDiscovery && r.competitorSocials && r.trackerDone && r.feedOK && r.lightboxOK
  );

  console.log('\n' + '═'.repeat(60));
  console.log('📊 VERIFICATION SUMMARY');
  console.log('═'.repeat(60));
  for (const r of allResults) {
    console.log(`\n📁 ${r.project}`);
    console.log(`   Competitor Discovery:   ${r.competitorDiscovery?'✅PASS':'❌FAIL'}`);
    console.log(`   Socials (≥2):          ${r.competitorSocials?'✅PASS':'❌FAIL'}`);
    console.log(`   Tracker Completed:      ${r.trackerDone?'✅PASS':'❌FAIL'}`);
    console.log(`   Feed posts:             ${r.feedOK?'✅PASS':'❌FAIL'}`);
    console.log(`   Lightbox structure:     ${r.lightboxOK?'✅PASS':'❌FAIL'}`);
  }
  console.log(allPassed ? '\n🎉 All verification steps passed!' : '\n⚠️ Some steps failed.');

  const fs = require('fs');
  fs.writeFileSync('verification-results.json', JSON.stringify(allResults,null,2));
  console.log('\n📄 Detailed results written to verification-results.json');
}

main().catch(e => { console.error(e); process.exit(1); });
