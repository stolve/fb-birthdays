#!/usr/bin/env node
/**
 * Facebook Birthdays Scraper v4
 * 
 * The birthdays page shows profile images grouped by month.
 * Individual birthdays only appear in hover tooltips: "Name's Birthday is Month Day"
 * 
 * This script hovers over each profile image, captures the tooltip text by diffing
 * the page before/after hover, and exports to CSV.
 * 
 * Usage:
 *   npm install playwright
 *   node scrape.js
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

  console.log('\n📅 Facebook Birthdays Scraper v4\n');
  console.log('1. A browser window has opened.');
  console.log('2. Log into your Facebook account.');
  console.log('3. Once you\'re logged in and see your feed, come back here and press Enter.\n');

  await page.goto('https://www.facebook.com');

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  console.log('🔄 Navigating to birthdays page...');
  await page.goto(BIRTHDAYS_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // First scroll through the whole page to load everything
  console.log('🔄 Pre-scrolling to load all content...');
  let lastHeight = 0;
  let stagnantCount = 0;
  while (stagnantCount < 10) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(1500);
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === lastHeight) {
      stagnantCount++;
    } else {
      lastHeight = h;
      stagnantCount = 0;
    }
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);

  // Find all profile images — Facebook uses img tags with src containing "scontent"
  // or profile-specific URLs. Also look for links wrapping profile images.
  const imageSelectors = await page.evaluate(() => {
    const images = [];
    
    // Find all images that could be profile avatars
    const allImgs = document.querySelectorAll('img');
    
    for (const img of allImgs) {
      const src = img.getAttribute('src') || '';
      const alt = img.getAttribute('alt') || '';
      
      // Profile images typically come from scontent*.fbcdn.net or similar
      const isProfile = src.includes('scontent') || 
                       src.includes('fbcdn') ||
                       (alt && alt.length > 1 && alt.length < 80 && !src.includes('emoji') && !src.includes('static'));
      
      if (isProfile && img.offsetWidth > 20 && img.offsetHeight > 20) {
        // Get a unique selector for this image
        const rect = img.getBoundingClientRect();
        images.push({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          alt: alt,
          width: img.offsetWidth,
          height: img.offsetHeight,
        });
      }
    }
    
    return images;
  });

  console.log(`🖼️  Found ${imageSelectors.length} profile images to hover over\n`);

  const allBirthdays = new Map();
  const birthdayPattern = /(.+?)'s Birthday is\s+(\w+\s+\d{1,2}(?:,?\s*\d{4})?)/i;
  const datePattern = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i;

  let hoverCount = 0;
  let foundCount = 0;

  for (const img of imageSelectors) {
    try {
      // Skip if we already found this person by alt name
      if (img.alt && allBirthdays.has(img.alt)) continue;

      // Scroll image into view
      await page.evaluate((x, y) => {
        window.scrollTo(x - window.innerWidth / 2, y - window.innerHeight / 2);
      }, img.x, img.y);
      await page.waitForTimeout(300);

      // Get page text BEFORE hover
      const textBefore = await page.evaluate(() => document.body.innerText);

      // Hover over the image
      await page.mouse.move(img.x, img.y);
      await page.waitForTimeout(800);

      // Get page text AFTER hover
      const textAfter = await page.evaluate(() => document.body.innerText);

      // Find what's new (tooltip text that appeared)
      if (textAfter !== textBefore) {
        // Find lines in textAfter that aren't in textBefore
        const beforeLines = new Set(textBefore.split('\n').map(l => l.trim()));
        const newLines = textAfter.split('\n')
          .map(l => l.trim())
          .filter(l => l && !beforeLines.has(l));

        // Look for birthday pattern in new lines
        for (const line of newLines) {
          const match = line.match(birthdayPattern);
          if (match) {
            const name = match[1].trim();
            const date = match[2].trim();
            if (name && date && !allBirthdays.has(name)) {
              allBirthdays.set(name, date);
              foundCount++;
              process.stdout.write(`\r✅ Found: ${name} — ${date} (${foundCount} total)    `);
            }
          }

          // Also try just a date pattern if the name is in the alt
          if (!match && img.alt && datePattern.test(line)) {
            const dateMatch = line.match(datePattern);
            if (dateMatch && !allBirthdays.has(img.alt)) {
              allBirthdays.set(img.alt, dateMatch[0]);
              foundCount++;
              process.stdout.write(`\r✅ Found: ${img.alt} — ${dateMatch[0]} (${foundCount} total)    `);
            }
          }
        }
      }

      // Move mouse away to dismiss tooltip
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);

      hoverCount++;
      if (hoverCount % 50 === 0) {
        process.stdout.write(`\r📊 Hovered ${hoverCount}/${imageSelectors.length}, found ${allBirthdays.size} birthdays...    `);
      }
    } catch (e) {
      // Skip this image on error
    }
  }

  console.log('\n');

  // Also try: parse month sections + names from page text as a fallback
  // The page shows "September" headers with "Tom Tolve, Michelle Greco Feniello and 25 others" under them
  // We can at least get the month for people we couldn't hover
  const pageText = await page.evaluate(() => document.body.innerText);
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  
  const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
  let currentMonth = '';
  for (const line of lines) {
    if (monthNames.includes(line)) {
      currentMonth = line;
      continue;
    }
    // If this line contains names and we have a month but no individual date
    // we can't use this without a day, so skip
  }

  if (allBirthdays.size === 0) {
    console.log('⚠️  No birthdays found.');
    console.log('   The tooltip format might have changed. Check the page manually.');
  } else {
    // Write CSV
    const csvLines = ['Name,Birthday'];
    const sorted = [...allBirthdays.entries()].sort((a, b) => {
      const dateA = new Date(a[1]);
      const dateB = new Date(b[1]);
      if (isNaN(dateA) && isNaN(dateB)) return 0;
      if (isNaN(dateA)) return 1;
      if (isNaN(dateB)) return -1;
      return dateA - dateB;
    });
    for (const [name, date] of sorted) {
      const safeName = name.includes(',') ? `"${name}"` : name;
      csvLines.push(`${safeName},${date}`);
    }
    fs.writeFileSync(OUTPUT_FILE, csvLines.join('\n'));
    console.log(`✅ Saved ${allBirthdays.size} birthdays to ${OUTPUT_FILE}`);
  }

  console.log('\nPress Enter to close the browser...');
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  await browser.close();
  process.exit(0);
})();
