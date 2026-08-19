#!/usr/bin/env node
/**
 * Facebook Birthdays Scraper
 * 
 * Launches a browser, you log into Facebook manually,
 * then it scrapes all your friends' birthdays and saves to CSV.
 * 
 * Usage:
 *   npm install playwright
 *   node scrape.js
 * 
 * The browser will open — log into Facebook when prompted.
 * After you log in, press Enter in the terminal to start scraping.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BIRTHDAYS_URL = 'https://www.facebook.com/events/birthdays';
const OUTPUT_FILE = path.join(__dirname, 'birthdays.csv');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  console.log('\n📅 Facebook Birthdays Scraper\n');
  console.log('1. A browser window has opened.');
  console.log('2. Log into your Facebook account.');
  console.log('3. Once you\'re logged in and see your feed, come back here and press Enter.\n');

  await page.goto('https://www.facebook.com');

  // Wait for user to press Enter after logging in
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  console.log('🔄 Navigating to birthdays page...');
  await page.goto(BIRTHDAYS_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  console.log('🔄 Scrolling to load all birthdays...');

  // Facebook lazy-loads birthdays as you scroll.
  // Scroll down in steps and collect data until we stop finding new entries.
  const allBirthdays = new Map(); // use Map to dedupe by name
  let scrollAttempts = 0;
  let maxScrollAttempts = 50;
  let lastHeight = 0;

  while (scrollAttempts < maxScrollAttempts) {
    // Try multiple selector strategies since Facebook changes their layout often
    // Strategy 1: Look for birthday entries in the events/birthdays page
    const entries = await page.evaluate(() => {
      const results = [];

      // Facebook birthdays page typically has sections with headings like
      // "Today's Birthdays", "This Week", "Recent Birthdays", "Upcoming Birthdays"
      // Each entry usually has a person's name (link) and a date string

      // Try to find all links that look like profile links within birthday context
      const allLinks = Array.from(document.querySelectorAll('a[href*="/user/"], a[href*="facebook.com/profile.php"]'));

      // Also try grabbing text from birthday cards/entries
      const textBlocks = Array.from(document.querySelectorAll('[data-visualcompletion="ignore-dynamic"] > div, [role="article"], div[style*="flex"]'));

      // Try to find name + date pairs by scanning the page text
      // Facebook birthday entries typically show: "John Smith\nMarch 15" or similar
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const allText = [];
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text) allText.push({ text, parent: node.parentElement });
      }

      // Look for date patterns near names
      const datePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s*\d{4})?/i;
      const today = new Date();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                          'July', 'August', 'September', 'October', 'November', 'December'];

      for (let i = 0; i < allText.length; i++) {
        const { text, parent } = allText[i];
        const dateMatch = text.match(datePattern);
        if (dateMatch) {
          // Look backwards for a name (usually in a nearby element)
          for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
            const candidate = allText[j].text.trim();
            // Name heuristic: 2-4 words, not a date, not a generic label
            if (candidate && candidate.length > 2 && candidate.length < 60 &&
                !datePattern.test(candidate) &&
                !['Today\'s Birthdays', 'This Week', 'Recent Birthdays', 
                  'Upcoming Birthdays', 'Birthdays', 'See All', 'Comments',
                  'Like', 'Comment', 'Share', 'Write a comment'].includes(candidate)) {
              // Check if it looks like a name (starts with capital letter, mostly letters)
              if (/^[A-Z][a-zA-Z\s'.-]+$/.test(candidate) && candidate.split(' ').length <= 4) {
                results.push({ name: candidate, date: dateMatch[0] });
                break;
              }
            }
          }
        }
      }

      return results;
    });

    for (const entry of entries) {
      if (!allBirthdays.has(entry.name)) {
        allBirthdays.set(entry.name, entry.date);
      }
    }

    // Scroll down
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 2);
    });
    await page.waitForTimeout(1500);

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === lastHeight) {
      // No new content loaded, try a few more times then stop
      scrollAttempts++;
      if (scrollAttempts > 5 && allBirthdays.size > 0) {
        break;
      }
    } else {
      lastHeight = currentHeight;
      scrollAttempts = 0;
    }

    process.stdout.write(`\r📊 Found ${allBirthdays.size} birthdays so far...`);
  }

  console.log('\n');

  if (allBirthdays.size === 0) {
    // Fallback: grab the raw page text and let the user see what's there
    console.log('⚠️  No birthdays found via automatic parsing.');
    console.log('   Dumping page text to birthdays-raw.txt for debugging...');
    const pageText = await page.evaluate(() => document.body.innerText);
    fs.writeFileSync(
      path.join(__dirname, 'birthdays-raw.txt'),
      pageText
    );
    console.log('   Check birthdays-raw.txt to see what the page looks like.');
    console.log('   You may need to adjust the parsing logic based on Facebook\'s current layout.');
  } else {
    // Write CSV
    const csvLines = ['Name,Birthday'];
    const sorted = [...allBirthdays.entries()].sort((a, b) => {
      const dateA = new Date(a[1]);
      const dateB = new Date(b[1]);
      return dateA - dateB;
    });
    for (const [name, date] of sorted) {
      // Escape any commas in names
      const safeName = name.includes(',') ? `"${name}"` : name;
      csvLines.push(`${safeName},${date}`);
    }
    fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n'));
    console.log(`✅ Saved ${allBirthdays.size} birthdays to ${OUTPUT_FILE}`);
    console.log(`📁 File location: ${OUTPUT_FILE}`);
  }

  console.log('\nPress Enter to close the browser...');
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  await browser.close();
  process.exit(0);
})();
