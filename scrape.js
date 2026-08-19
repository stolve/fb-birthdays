#!/usr/bin/env node
/**
 * Facebook Birthdays Scraper v2
 * 
 * Launches a browser, you log into Facebook manually,
 * then it scrapes all your friends' birthdays and saves to CSV.
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
const DEBUG_HTML = path.join(__dirname, 'birthdays-debug.html');
const DEBUG_TXT = path.join(__dirname, 'birthdays-debug.txt');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  console.log('\n📅 Facebook Birthdays Scraper v2\n');
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

  // Save debug screenshots and HTML at the start
  await page.screenshot({ path: path.join(__dirname, 'birthdays-start.png'), fullPage: false });
  console.log('📸 Saved screenshot to birthdays-start.png');

  // Collect all birthdays by scrolling and parsing
  const allBirthdays = new Map();
  let noNewCount = 0;
  let maxIterations = 100;
  let iteration = 0;

  console.log('🔄 Scrolling and collecting birthdays...');

  while (iteration < maxIterations) {
    // Parse current viewport
    const entries = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      // Strategy 1: Find all anchor tags that link to user profiles
      // Facebook profile links look like: /user/NAME, /profile.php?id=NUMBER, or /NAME
      const profileLinks = document.querySelectorAll('a[href*="/user/"], a[href*="profile.php?id="]');
      
      for (const link of profileLinks) {
        const name = link.textContent?.trim();
        const href = link.getAttribute('href') || '';
        if (!name || name.length < 2 || name.length > 80) continue;
        if (seen.has(name)) continue;
        
        // Look for a date near this link — check parent and siblings
        let parent = link.parentElement;
        let dateText = '';
        
        // Walk up a few levels looking for date text
        for (let depth = 0; depth < 5 && parent && !dateText; depth++) {
          const text = parent.textContent || '';
          
          // Match "March 15", "March 15, 1990", "Mar 15", etc.
          const monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
          const dateRegex = new RegExp(`(${monthNames})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'i');
          const match = text.match(dateRegex);
          if (match) {
            dateText = match[0];
          }
          parent = parent.parentElement;
        }
        
        if (dateText) {
          seen.add(name);
          results.push({ name, date: dateText, href });
        }
      }

      // Strategy 2: Find elements with birthday-related aria labels or data attributes
      const birthdayElements = document.querySelectorAll('[aria-label*="birthday" i], [data-testid*="birthday" i], [role="article"]');
      for (const el of birthdayElements) {
        const text = el.textContent || '';
        const monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
        const dateRegex = new RegExp(`(${monthNames})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'i');
        const dateMatch = text.match(dateRegex);
        if (dateMatch) {
          // Find the first link in this element for the name
          const nameLink = el.querySelector('a[href*="/user/"], a[href*="profile.php?id="]');
          if (nameLink) {
            const name = nameLink.textContent?.trim();
            if (name && !seen.has(name)) {
              seen.add(name);
              results.push({ name, date: dateMatch[0], href: nameLink.getAttribute('href') || '' });
            }
          }
        }
      }

      // Strategy 3: Brute force — get ALL text nodes, find dates, grab nearest name link above
      const allLinks = Array.from(document.querySelectorAll('a[href*="/user/"], a[href*="profile.php?id="]'));
      const monthNames = 'January|February|March|April|May|June|July|August|September|October|November|December';
      const dateRegex = new RegExp(`(${monthNames})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`, 'i');
      
      // Get all text nodes with dates
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const dateNodes = [];
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text && dateRegex.test(text)) {
          const match = text.match(dateRegex);
          dateNodes.push({ element: node.parentElement, date: match[0], text });
        }
      }

      // For each date node, find the closest preceding profile link
      for (const dn of dateNodes) {
        let closestLink = null;
        let closestDist = Infinity;
        
        for (const link of allLinks) {
          // Check if this link is "near" the date node (same parent or nearby)
          let linkEl = link;
          let dateEl = dn.element;
          
          // Walk up from both to find common ancestor
          for (let i = 0; i < 6; i++) {
            if (!linkEl || !dateEl) break;
            if (linkEl === dateEl || linkEl.contains(dateEl) || dateEl.contains(linkEl)) {
              if (i < closestDist) {
                closestDist = i;
                closestLink = link;
              }
              break;
            }
            linkEl = linkEl.parentElement;
            dateEl = dateEl.parentElement;
          }
        }
        
        if (closestLink) {
          const name = closestLink.textContent?.trim();
          if (name && name.length > 1 && name.length < 80 && !seen.has(name)) {
            // Make sure the name itself isn't a date
            if (!dateRegex.test(name)) {
              seen.add(name);
              results.push({ name, date: dn.date, href: closestLink.getAttribute('href') || '' });
            }
          }
        }
      }

      return results;
    });

    let newCount = 0;
    for (const entry of entries) {
      if (!allBirthdays.has(entry.name)) {
        allBirthdays.set(entry.name, entry.date);
        newCount++;
      }
    }

    process.stdout.write(`\r📊 Total: ${allBirthdays.size} birthdays (found ${newCount} new this pass)...`);

    if (newCount === 0) {
      noNewCount++;
      if (noNewCount >= 5) {
        break;
      }
    } else {
      noNewCount = 0;
    }

    // Scroll down
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 2);
    });
    await page.waitForTimeout(2000);

    iteration++;
  }

  console.log('\n');

  // Save debug HTML and text
  const html = await page.content();
  fs.writeFileSync(DEBUG_HTML, html);
  console.log(`🔍 Debug HTML saved to ${DEBUG_HTML}`);

  const pageText = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(DEBUG_TXT, pageText);
  console.log(`🔍 Debug text saved to ${DEBUG_TXT}`);

  // Take final screenshot
  await page.screenshot({ path: path.join(__dirname, 'birthdays-end.png'), fullPage: false });

  if (allBirthdays.size === 0) {
    console.log('\n⚠️  No birthdays found via automatic parsing.');
    console.log('   Check birthdays-debug.txt and birthdays-debug.html to see the page structure.');
    console.log('   Send me the debug text file and I\'ll update the parser.');
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
    console.log(`\n✅ Saved ${allBirthdays.size} birthdays to ${OUTPUT_FILE}`);
  }

  console.log('\nPress Enter to close the browser...');
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });

  await browser.close();
  process.exit(0);
})();
