# Facebook Birthdays Scraper

Scrapes your friends' birthdays from Facebook and saves them to a CSV file. No API, no app registration — just browser automation using your own login session.

## Setup

```bash
cd fb-birthdays
npm install
```

This installs Playwright. On first run it may need to download Chromium:

```bash
npx playwright install chromium
```

## Usage

```bash
node scrape.js
```

1. A Chrome window opens
2. Log into Facebook normally
3. Come back to the terminal and press Enter
4. The script scrolls through your birthdays page and collects everything
5. Output saved to `birthdays.csv` (Name,Birthday format, sorted by date)

## Output

```
Name,Birthday
John Smith,March 15
Jane Doe,July 22
...
```

## Notes

- Facebook changes their page layout frequently. If the scraper finds 0 birthdays, check `birthdays-raw.txt` (the raw page text dump) to see what changed and adjust the parsing.
- The script runs the browser in visible mode so you can see what's happening.
- Scroll speed is intentionally slow to let Facebook's lazy-loading work.
- Takes about 1-2 minutes depending on how many friends you have.

## Why not use the Facebook API?

Facebook deprecated the `friends_birthday` permission after Cambridge Analytica (2018). The Graph API no longer returns friends' birthdays — only your own. The only way to get this data is by scraping the birthdays page while logged in, which is what this script does.
