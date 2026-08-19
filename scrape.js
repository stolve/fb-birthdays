#!/usr/bin/env node
/**
 * Facebook Birthdays Scraper v3
 * 
 * Birthdays on Facebook's birthdays page show up as tooltips on user avatars/images.
 * This script hovers over each image to trigger the tooltip, reads the name + birthday,
 * and exports to CSV.
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
const DEBUG_TXT = path.join(__dirname, 'birthdays-debug.txt');
const DEBUG_HTML = path.join(__dirname, 'birthdays-debug.html');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  console.log('\n📅 Facebook Birthdays Scraper v3\n');
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

  // Save debug info
  await page.screenshot({ path: path.join(__dirname, 'birthdays-start.png') });
  const html = await page.content();
  fs.writeFileSync(DEBUG_HTML, html);
  const pageText = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(DEBUG_TXT, pageText);

  const allBirthdays = new Map();
  const monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
  const dateRegex = new RegExp(`(${monthNames})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'i');

  console.log('🔄 Scrolling to load all birthday entries...');

  // First, scroll through the entire page to make sure everything is loaded
  let lastHeight = 0;
  let scrollCount = 0;
  while (scrollCount < 60) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(1500);
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === lastHeight) {
      scrollCount++;
      if (scrollCount > 8) break;
    } else {
      lastHeight = h;
      scrollCount = 0;
    }
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);

  console.log('🔄 Collecting birthdays from tooltips and attributes...');

  // Strategy 1: Check all images and links for title/aria-label attributes containing dates
  const attrEntries = await page.evaluate((dateRegexStr) => {
    const dateRegex = new RegExp(dateRegexStr, 'i');
    const results = [];
    const seen = new Set();

    // Check ALL elements for title or aria-label containing a date
    const allElements = document.querySelectorAll('[title], [aria-label], [data-tooltip-content], [data-hover="tooltip"]');
    
    for (const el of allElements) {
      const attrs = [
        el.getAttribute('title'),
        el.getAttribute('aria-label'),
        el.getAttribute('data-tooltip-content'),
        el.getAttribute('data-tooltip'),
      ].filter(Boolean);

      for (const attr of attrs) {
        if (dateRegex.test(attr)) {
          const dateMatch = attr.match(dateRegex);
          if (dateMatch) {
            // Try to find the name — could be in the same attribute, a child element, or a nearby link
            let name = '';
            
            // Check if the attribute contains both name and date
            // e.g. "John Smith — March 15" or "John Smith, March 15, 1990"
            const attrText = attr;
            const dateIdx = attrText.indexOf(dateMatch[0]);
            if (dateIdx > 0) {
              name = attrText.substring(0, dateIdx).replace(/[—\-:,|]\s*$/, '').trim();
            }
            
            // If no name in attribute, look for nearby link text
            if (!name) {
              const nearbyLink = el.querySelector('a') || el.closest('a');
              if (nearbyLink) {
                name = nearbyLink.textContent?.trim() || '';
              }
            }
            
            // If still no name, look at img alt text
            if (!name) {
              const img = el.querySelector('img') || (el.tagName === 'IMG' ? el : null);
              if (img) {
                name = img.getAttribute('alt')?.trim() || '';
              }
            }
            
            // Clean up name
            if (name && name.length > 1 && name.length < 80 && !dateRegex.test(name)) {
              if (!seen.has(name)) {
                seen.add(name);
                results.push({ name, date: dateMatch[0], source: 'attribute' });
              }
            }
          }
        }
      }
    }

    return results;
  }, dateRegex.source);

  for (const entry of attrEntries) {
    allBirthdays.set(entry.name, entry.date);
  }
  console.log(`📋 Found ${allBirthdays.size} from attributes/tooltips`);

  // Strategy 2: Hover over each avatar/profile image to trigger tooltips
  console.log('🔄 Hovering over profile images to trigger tooltips...');

  // Find all images that look like profile avatars
  const profileImages = await page.$$('img[src*="scontent"], img[role="img"], img[alt]:not([alt=""])');
  console.log(`🖼️  Found ${profileImages.length} images to check`);

  let hoverCount = 0;
  for (const img of profileImages) {
    try {
      // Check if this image has a date in its alt/title already
      const alt = await img.getAttribute('alt') || '';
      const title = await img.getAttribute('title') || '';
      const existing = alt + ' ' + title;
      
      if (dateRegex.test(existing)) {
        const dateMatch = existing.match(dateRegex);
        const name = alt.replace(dateMatch[0], '').replace(/[—\-:,|]\s*$/, '').trim() || title.replace(dateMatch[0], '').trim();
        if (name && name.length > 1 && name.length < 80 && !allBirthdays.has(name)) {
          allBirthdays.set(name, dateMatch[0]);
          continue;
        }
      }

      // Hover to trigger tooltip
      await img.hover();
      await page.waitForTimeout(500);

      // Check for tooltip that appeared
      const tooltipText = await page.evaluate(() => {
        // Facebook tooltips usually appear in elements with role="tooltip"
        const tooltips = document.querySelectorAll('[role="tooltip"], [data-testid="tooltip"]');
        for (const t of tooltips) {
          const text = t.textContent?.trim();
          if (text) return text;
        }
        // Also check for floating tooltip divs
        const floaters = document.querySelectorAll('div[style*="position: absolute"][style*="z-index"]');
        for (const f of floaters) {
          const text = f.textContent?.trim();
          if (text && text.length > 3) return text;
        }
        return '';
      });

      if (tooltipText && dateRegex.test(tooltipText)) {
        const dateMatch = tooltipText.match(dateRegex);
        // Extract name from tooltip text (everything before the date)
        const dateIdx = tooltipText.indexOf(dateMatch[0]);
        let name = dateIdx > 0 ? tooltipText.substring(0, dateIdx).replace(/[—\-:,|]\s*$/, '').trim() : '';
        
        // Fallback to alt text
        if (!name) {
          name = alt.replace(/['s ]+birthday.*/i, '').trim();
        }
        
        if (name && name.length > 1 && name.length < 80 && !dateRegex.test(name)) {
          if (!allBirthdays.has(name)) {
            allBirthdays.set(name, dateMatch[0]);
          }
        }
      }

      hoverCount++;
      if (hoverCount % 20 === 0) {
        process.stdout.write(`\r📊 Hovered ${hoverCount}/${profileImages.length} images, found ${allBirthdays.size} birthdays...`);
      }
    } catch (e) {
      // Skip this image
    }
  }

  console.log('\n');

  // Strategy 3: Parse the debug text for any date-name pairs we might have missed
  const textLines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < textLines.length; i++) {
    if (dateRegex.test(textLines[i])) {
      const dateMatch = textLines[i].match(dateRegex);
      // Look at previous lines for a name
      for (let j = Math.max(0, i - 3); j < i; j++) {
        const candidate = textLines[j].trim();
        if (candidate && candidate.length > 1 && candidate.length < 80 && 
            !dateRegex.test(candidate) && !allBirthdays.has(candidate) &&
            !['Today\'s Birthdays', 'This Week', 'Recent Birthdays', 'Upcoming Birthdays', 
              'Birthdays', 'See All', 'Comments', 'Like', 'Comment', 'Share'].includes(candidate)) {
          if (/^[A-Z][a-zA-Z\s'.-]+$/.test(candidate) && candidate.split(' ').length <= 4) {
            allBirthdays.set(candidate, dateMatch[0]);
            break;
          }
        }
      }
    }
  }

  if (allBirthdays.size === 0) {
    console.log('⚠️  Still no birthdays found.');
    console.log('   Sending debug files will help me fix the parser.');
    console.log(`   - ${DEBUG_TXT}`);
    console.log(`   - ${DEBUG_HTML}`);
    console.log('   Also check birthdays-start.png to see what the page looks like.');
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
