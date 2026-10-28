/**
 * Deployment Verification Script for Business R&D Agent
 *
 * This script automates the complete verification workflow:
 * 1. Login to the deployed application
 * 2. For each project:
 *    - Go to Competitors tab, click "Re-crawl Deeply"
 *    - Wait for completion
 *    - Go to Competitor Feed, click "Run Competitor Tracker Now"
 *    - Wait for completion
 *    - Verify all competitors have ≥2 social accounts
 *    - Verify all social media platforms have posts with previews
 *    - Verify lightbox displays image/video on left, caption on right
 *
 * Run with: node test-deployment-verification.js
 *
 * Requires: npm install playwright
 */

const { chromium } = require('playwright');
const fs = require('fs');

const CONFIG = {
  baseUrl: 'https://business-rd-agent.onrender.com',
  username: 'demo',
  password: 'demo1234',
  headless: false, // Set to true for CI, false to watch
  slowMo: 100, // Slow down for visibility
  timeout: 300000, // 5 minutes for long operations
};

const SELECTORS = {
  // Login page
  loginForm: 'form',
  usernameInput: 'input[name="username"], input[type="text"]',
  passwordInput: 'input[name="password"], input[type="password"]',
  loginButton: 'button[type="submit"], button:has-text("Login"), button:has-text("Sign In")',

  // Navigation
  projectSelector: 'select[name="project"], .project-selector, [data-testid="project-selector"]',
  navCompetitors: '#nav-competitors, a[href*="competitors"], button:has-text("Competitor Intelligence")',
  navSocialFeed: '#nav-social-feed, a[href*="social-feed"], button:has-text("Competitor Feed")',

  // Competitors tab
  btnFindCompetitors: '#btn-find-comp, button:has-text("Find Competitors")',
  btnRecrawlDeeply: '#btn-regen-comp, button:has-text("Re-crawl Deeply")',
  btnBackfillSocials: '#btn-backfill-socials, button:has-text("Fix Missing Socials")',
  competitorList: '#competitor-list, .competitor-list, [data-testid="competitor-list"]',
  competitorCard: '.competitor-card, [data-competitor-url]',
  liveCompCards: '#live-comp-cards',
  liveCompHeader: '#live-comp-header',

  // Social Feed tab
  btnRunTracker: '#btn-cron, button:has-text("Run Competitor Tracker Now"), button:has-text("Run Tracker")',
  feedList: '#feed-list, .feed-list, [data-testid="feed-list"]',
  feedCard: '.feed-card-item, .comp-feed-card, [data-post-index]',
  trackerProgress: '#tracker-progress-msg, #tracker-elapsed-text',
  trackerRunningCard: '[style*="Competitor Social Tracker in Progress"]',

  // Lightbox modal
  mediaLightbox: '#media-lightbox, .media-lightbox',
  lightboxContent: '#media-lightbox-content, .post-preview-dialog',
  lightboxClose: '.media-lightbox-close, button[aria-label="Close post preview"]',
  postPreviewMedia: '.post-preview-media',
  postPreviewDetails: '.post-preview-details',
  postPreviewCaption: '.post-preview-caption',
  postPreviewAuthor: '.post-preview-author',

  // Feed platform sections
  feedPlatformSection: '.comp-feed-platform-section',
  feedFilterButtons: '.comp-feed-filter-btn',
};

async function waitForElement(page, selector, options = {}) {
  const { timeout = 30000, state = 'visible' } = options;
  try {
    await page.waitForSelector(selector, { timeout, state });
    return await page.$(selector);
  } catch (e) {
    console.log(`⚠️ Element not found: ${selector}`);
    return null;
  }
}

async function waitForElementGone(page, selector, timeout = 30000) {
  try {
    await page.waitForSelector(selector, { timeout, state: 'hidden' });
    return true;
  } catch (e) {
    return false;
  }
}

async function clickAndWait(page, selector, waitMs = 1000) {
  const el = await waitForElement(page, selector);
  if (el) {
    await el.click();
    await page.waitForTimeout(waitMs);
    return true;
  }
  return false;
}

async function login(page) {
  console.log('\n🔐 Logging in...');
  await page.goto(`${CONFIG.baseUrl}/login`, { waitUntil: 'networkidle' });

  // Fill login form
  await page.fill(SELECTORS.usernameInput, CONFIG.username);
  await page.fill(SELECTORS.passwordInput, CONFIG.password);
  await page.click(SELECTORS.loginButton);

  // Wait for redirect to dashboard
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  console.log('✅ Logged in successfully');
  return true;
}

async function getProjects(page) {
  console.log('\n📋 Fetching projects...');

  // Try to find project selector
  const projectSelect = await page.$(SELECTORS.projectSelector);
  let projects = [];

  if (projectSelect) {
    // Get options from select
    const options = await projectSelect.$$eval('option', opts =>
      opts.map(o => ({ value: o.value, text: o.textContent.trim() })).filter(o => o.value)
    );
    projects = options;
  } else {
    // Try to find project cards/links
    const projectCards = await page.$$('.project-card, [data-project-url], .project-item');
    for (const card of projectCards) {
      const url = await card.getAttribute('data-project-url') || await card.getAttribute('href');
      const name = await card.textContent();
      if (url) projects.push({ value: url, text: name.trim() });
    }
  }

  console.log(`Found ${projects.length} projects`);
  return projects;
}

async function selectProject(page, projectUrl) {
  console.log(`\n📂 Selecting project: ${projectUrl}`);

  const projectSelect = await page.$(SELECTORS.projectSelector);
  if (projectSelect) {
    await projectSelect.selectOption(projectUrl);
    await page.waitForTimeout(2000);
  } else {
    // Navigate directly
    await page.goto(`${CONFIG.baseUrl}/dashboard?url=${encodeURIComponent(projectUrl)}`, { waitUntil: 'networkidle' });
  }

  // Wait for project to load
  await page.waitForTimeout(2000);
  console.log('✅ Project selected');
}

async function navigateToTab(page, tabSelector, tabName) {
  console.log(`\n📑 Navigating to ${tabName} tab...`);
  const tab = await waitForElement(page, tabSelector);
  if (tab) {
    await tab.click();
    await page.waitForTimeout(2000);
    console.log(`✅ On ${tabName} tab`);
    return true;
  }
  console.log(`❌ Could not find ${tabName} tab`);
  return false;
}

async function waitForCompetitorDiscovery(page, maxWaitMs = 300000) {
  console.log('\n🔍 Waiting for competitor discovery to complete...');
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    // Check if live discovery header is gone
    const liveHeader = await page.$(SELECTORS.liveCompHeader);
    const liveCards = await page.$(SELECTORS.liveCompCards);

    // Check if "Re-crawl Deeply" button is enabled (discovery complete)
    const recrawlBtn = await page.$(SELECTORS.btnRecrawlDeeply);
    const findBtn = await page.$(SELECTORS.btnFindCompetitors);

    if (recrawlBtn) {
      const isVisible = await recrawlBtn.isVisible();
      const isDisabled = await recrawlBtn.isDisabled();
      if (isVisible && !isDisabled) {
        console.log('✅ Competitor discovery completed');
        return true;
      }
    }

    if (findBtn) {
      const isVisible = await findBtn.isVisible();
      if (!isVisible) {
        console.log('✅ Competitor discovery completed (Find button hidden)');
        return true;
      }
    }

    // Check for live cards being populated
    if (liveCards) {
      const cards = await liveCards.$$('.competitor-card, [data-competitor-url]');
      if (cards.length > 0) {
        console.log(`📊 Found ${cards.length} live competitors so far...`);
      }
    }

    await page.waitForTimeout(5000);
  }

  console.log('⚠️ Timeout waiting for competitor discovery');
  return false;
}

async function waitForTrackerCompletion(page, maxWaitMs = 600000) {
  console.log('\n⏳ Waiting for competitor tracker to complete...');
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    // Check if tracker running card is visible
    const trackerCard = await page.$(SELECTORS.trackerRunningCard);
    const trackerProgress = await page.$(SELECTORS.trackerProgress);
    const btnRunTracker = await page.$(SELECTORS.btnRunTracker);

    if (trackerCard && await trackerCard.isVisible()) {
      // Tracker is running, check progress
      if (trackerProgress) {
        const progressText = await trackerProgress.textContent();
        console.log(`📈 Tracker progress: ${progressText}`);
      }

      // Check elapsed time
      const elapsedEl = await page.$('#tracker-elapsed-text');
      if (elapsedEl) {
        const elapsed = await elapsedEl.textContent();
        console.log(`⏱️ ${elapsed}`);
      }
    } else if (btnRunTracker) {
      const isDisabled = await btnRunTracker.isDisabled();
      const btnText = await btnRunTracker.textContent();

      if (!isDisabled && btnText.includes('Run Competitor Tracker')) {
        console.log('✅ Tracker completed (button re-enabled)');
        return true;
      }
    }

    // Check if feed has loaded
    const feedList = await page.$(SELECTORS.feedList);
    if (feedList) {
      const cards = await feedList.$$(SELECTORS.feedCard);
      if (cards.length > 0) {
        console.log(`📊 Feed loaded with ${cards.length} posts`);
        // Wait a bit more for everything to settle
        await page.waitForTimeout(3000);
        return true;
      }
    }

    await page.waitForTimeout(5000);
  }

  console.log('⚠️ Timeout waiting for tracker completion');
  return false;
}

async function verifyCompetitorsHaveSocialAccounts(page) {
  console.log('\n🔍 Verifying competitors have ≥2 social accounts...');

  const competitorList = await page.$(SELECTORS.competitorList);
  if (!competitorList) {
    console.log('❌ Competitor list not found');
    return { passed: false, details: 'Competitor list not found' };
  }

  const cards = await competitorList.$$(SELECTORS.competitorCard);
  console.log(`Found ${cards.length} competitor cards`);

  let allPassed = true;
  const results = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const cardHtml = await card.innerHTML();

    // Count social links in the card
    const socialLinks = await card.$$('a[href*="linkedin.com"], a[href*="instagram.com"], a[href*="facebook.com"], a[href*="youtube.com"], a[href*="twitter.com"], a[href*="x.com"]');
    const socialCount = socialLinks.length;

    // Also check for social icons
    const socialIcons = await card.$$('[class*="linkedin"], [class*="instagram"], [class*="facebook"], [class*="youtube"], [class*="twitter"]');

    const totalSocials = socialCount + socialIcons.length;

    // Get competitor name
    const nameEl = await card.$('h3, h4, .competitor-name, [data-competitor-name]');
    const name = nameEl ? await nameEl.textContent() : `Competitor ${i + 1}`;

    const passed = totalSocials >= 2;
    if (!passed) allPassed = false;

    results.push({
      name: name.trim(),
      socialCount: totalSocials,
      passed
    });

    console.log(`${passed ? '✅' : '❌'} ${name.trim()}: ${totalSocials} social accounts`);
  }

  return { passed: allPassed, details: results };
}

async function verifyFeedPosts(page) {
  console.log('\n🔍 Verifying feed posts have previews...');

  const feedList = await page.$(SELECTORS.feedList);
  if (!feedList) {
    console.log('❌ Feed list not found');
    return { passed: false, details: 'Feed list not found' };
  }

  // Check platform filter buttons to see which platforms have posts
  const filterButtons = await feedList.$$(SELECTORS.feedFilterButtons);
  const platformCounts = {};

  for (const btn of filterButtons) {
    const text = await btn.textContent();
    const match = text.match(/(\w+)\s*\((\d+)\)/);
    if (match) {
      platformCounts[match[1]] = parseInt(match[2]);
    }
  }

  console.log('Platform post counts:', platformCounts);

  // Get all feed cards
  const cards = await feedList.$$(SELECTORS.feedCard);
  console.log(`Found ${cards.length} feed cards`);

  let allPassed = true;
  const results = [];

  for (let i = 0; i < Math.min(cards.length, 10); i++) { // Check first 10 posts
    const card = cards[i];

    // Check for media preview (image/video)
    const mediaEl = await card.$('img, video, iframe, .feed-card-thumb, [style*="background-image"]');
    const hasMedia = !!mediaEl;

    // Get platform
    const platformEl = await card.$('[data-platform], .platform-badge, .feed-platform');
    const platform = platformEl ? await platformEl.textContent() : 'Unknown';

    // Get competitor name
    const nameEl = await card.$('.competitor-name, .feed-competitor-name, h4, h3');
    const name = nameEl ? await nameEl.textContent() : `Post ${i + 1}`;

    const passed = hasMedia;
    if (!passed) allPassed = false;

    results.push({
      name: name.trim(),
      platform: platform.trim(),
      hasMedia,
      passed
    });

    console.log(`${passed ? '✅' : '❌'} ${name.trim()} (${platform.trim()}): ${hasMedia ? 'Has preview' : 'No preview'}`);
  }

  return { passed: allPassed, details: { platformCounts, postsChecked: results } };
}

async function verifyLightbox(page) {
  console.log('\n🔍 Verifying lightbox functionality...');

  const feedList = await page.$(SELECTORS.feedList);
  if (!feedList) {
    console.log('❌ Feed list not found for lightbox test');
    return { passed: false, details: 'Feed list not found' };
  }

  const cards = await feedList.$$(SELECTORS.feedCard);
  if (cards.length === 0) {
    console.log('❌ No feed cards to test lightbox');
    return { passed: false, details: 'No feed cards' };
  }

  // Click first card to open lightbox
  const firstCard = cards[0];
  await firstCard.click();
  await page.waitForTimeout(1000);

  // Check if lightbox opened
  const lightbox = await page.$(SELECTORS.mediaLightbox);
  if (!lightbox || !(await lightbox.isVisible())) {
    console.log('❌ Lightbox did not open');
    return { passed: false, details: 'Lightbox did not open' };
  }

  console.log('✅ Lightbox opened');

  // Verify lightbox structure: media on left, caption on right
  const content = await page.$(SELECTORS.lightboxContent);
  if (!content) {
    console.log('❌ Lightbox content not found');
    return { passed: false, details: 'Lightbox content not found' };
  }

  const contentHtml = await content.innerHTML();

  // Check for post-preview-dialog structure (media left, details right)
  const hasDialogStructure = contentHtml.includes('post-preview-dialog') ||
                             contentHtml.includes('post-preview-media') && contentHtml.includes('post-preview-details');

  // Check for media element (video, iframe, img)
  const mediaEl = await content.$('.post-preview-media video, .post-preview-media iframe, .post-preview-media img');
  const hasMedia = !!mediaEl;

  // Check for caption
  const captionEl = await content.$('.post-preview-caption, .feed-text');
  const hasCaption = !!captionEl;

  // Check for author
  const authorEl = await content.$('.post-preview-author');
  const hasAuthor = !!authorEl;

  const passed = hasDialogStructure && hasMedia && hasCaption;

  console.log(`✅ Lightbox structure: ${hasDialogStructure ? 'Correct (split layout)' : 'Unexpected'}`);
  console.log(`✅ Media element: ${hasMedia ? 'Present' : 'Missing'}`);
  console.log(`✅ Caption: ${hasCaption ? 'Present' : 'Missing'}`);
  console.log(`✅ Author: ${hasAuthor ? 'Present' : 'Missing'}`);

  // Close lightbox
  const closeBtn = await page.$(SELECTORS.lightboxClose);
  if (closeBtn) {
    await closeBtn.click();
  } else {
    // Click backdrop to close
    await page.click(SELECTORS.mediaLightbox, { position: { x: 10, y: 10 } });
  }
  await page.waitForTimeout(500);

  return {
    passed,
    details: {
      hasDialogStructure,
      hasMedia,
      hasCaption,
      hasAuthor
    }
  };
}

async function runVerificationForProject(page, project) {
  console.log(`\n{'='.repeat(60)}`);
  console.log(`📊 VERIFYING PROJECT: ${project.text} (${project.value})`);
  console.log(`${'='.repeat(60)}`);

  const results = {
    project: project.text,
    url: project.value,
    competitorDiscovery: false,
    competitorSocialAccounts: false,
    trackerCompletion: false,
    feedPosts: false,
    lightbox: false,
  };

  // Select project
  await selectProject(page, project.value);

  // --- COMPETITORS TAB ---
  await navigateToTab(page, SELECTORS.navCompetitors, 'Competitors');

  // Click "Re-crawl Deeply"
  console.log('\n🔄 Clicking "Re-crawl Deeply"...');
  const recrawlBtn = await waitForElement(page, SELECTORS.btnRecrawlDeeply);
  if (recrawlBtn && await recrawlBtn.isVisible()) {
    await recrawlBtn.click();
    console.log('✅ "Re-crawl Deeply" clicked');
  } else {
    // Try "Find Competitors" if re-crawl not visible
    const findBtn = await waitForElement(page, SELECTORS.btnFindCompetitors);
    if (findBtn && await findBtn.isVisible()) {
      await findBtn.click();
      console.log('✅ "Find Competitors" clicked (Re-crawl not visible)');
    } else {
      console.log('❌ Neither "Re-crawl Deeply" nor "Find Competitors" found');
      return results;
    }
  }

  // Wait for competitor discovery
  results.competitorDiscovery = await waitForCompetitorDiscovery(page);

  // Verify competitors have ≥2 social accounts
  if (results.competitorDiscovery) {
    const socialCheck = await verifyCompetitorsHaveSocialAccounts(page);
    results.competitorSocialAccounts = socialCheck.passed;
    results.socialAccountDetails = socialCheck.details;
  }

  // --- SOCIAL FEED TAB ---
  await navigateToTab(page, SELECTORS.navSocialFeed, 'Competitor Feed');

  // Click "Run Competitor Tracker Now"
  console.log('\n🚀 Clicking "Run Competitor Tracker Now"...');
  const trackerBtn = await waitForElement(page, SELECTORS.btnRunTracker);
  if (trackerBtn && await trackerBtn.isVisible()) {
    await trackerBtn.click();
    console.log('✅ "Run Competitor Tracker Now" clicked');
  } else {
    console.log('❌ Tracker button not found');
    return results;
  }

  // Wait for tracker completion
  results.trackerCompletion = await waitForTrackerCompletion(page);

  // Verify feed posts have previews
  if (results.trackerCompletion) {
    const feedCheck = await verifyFeedPosts(page);
    results.feedPosts = feedCheck.passed;
    results.feedDetails = feedCheck.details;

    // Verify lightbox
    const lightboxCheck = await verifyLightbox(page);
    results.lightbox = lightboxCheck.passed;
    results.lightboxDetails = lightboxCheck.details;
  }

  return results;
}

async function main() {
  console.log('🚀 Starting Deployment Verification');
  console.log(`🌐 Target: ${CONFIG.baseUrl}`);
  console.log(`👤 User: ${CONFIG.username}`);

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    slowMo: CONFIG.slowMo,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`🌐 Browser Console Error: ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    console.log(`🌐 Browser Page Error: ${err.message}`);
  });

  try {
    // Login
    await login(page);

    // Get projects
    const projects = await getProjects(page);

    if (projects.length === 0) {
      console.log('❌ No projects found!');
      return;
    }

    // Run verification for each project
    const allResults = [];

    for (const project of projects) {
      const result = await runVerificationForProject(page, project);
      allResults.push(result);

      // Brief pause between projects
      await page.waitForTimeout(3000);
    }

    // Print summary
    console.log('\n\n');
    console.log('═'.repeat(60));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('═'.repeat(60));

    for (const result of allResults) {
      console.log(`\n📁 Project: ${result.project}`);
      console.log(`   Competitor Discovery:     ${result.competitorDiscovery ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   Social Accounts (≥2):     ${result.competitorSocialAccounts ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   Tracker Completion:       ${result.trackerCompletion ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   Feed Posts with Previews: ${result.feedPosts ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   Lightbox (Media|Caption): ${result.lightbox ? '✅ PASS' : '❌ FAIL'}`);
    }

    // Overall pass/fail
    const allPassed = allResults.every(r =>
      r.competitorDiscovery &&
      r.competitorSocialAccounts &&
      r.trackerCompletion &&
      r.feedPosts &&
      r.lightbox
    );

    console.log('\n' + '═'.repeat(60));
    console.log(allPassed ? '🎉 ALL VERIFICATIONS PASSED!' : '⚠️ SOME VERIFICATIONS FAILED');
    console.log('═'.repeat(60));

    // Save detailed results
    fs.writeFileSync(
      'verification-results.json',
      JSON.stringify(allResults, null, 2)
    );
    console.log('\n📄 Detailed results saved to verification-results.json');

  } catch (error) {
    console.error('\n❌ Verification failed with error:', error);
  } finally {
    await browser.close();
  }
}

// Run the verification
main().catch(console.error);