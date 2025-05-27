const puppeteer = require('puppeteer-core');
const fs = require('fs');

const delay = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222'
  });

  const pages = await browser.pages();
  const page = pages[0];

  console.log('✅ Connected to Chrome. Starting human-like scraping...\n');

  let allJobs = new Set();
  let currentPage = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const url = `https://www.upwork.com/nx/search/jobs?sort=recency&page=${currentPage}`;
    console.log(`🌐 Navigating to Page ${currentPage}: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });

    // Wait for job cards or exit if Cloudflare blocks
    try {
      await page.waitForSelector('[data-test="job-tile-list"] article', { timeout: 10000 });
    } catch {
      const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
      if (bodyText.includes('verify you are human') || bodyText.includes('cloudflare')) {
        console.log('❌ Blocked by Cloudflare or verification screen.');
        break;
      } else {
        console.log('⚠️ No job cards found. Possibly loading issue. Skipping this page.\n');
        currentPage++;
        await delay(7000 + Math.random() * 2000);
        continue;
      }
    }

    const jobCards = await page.$$('[data-test="job-tile-list"] article');
    console.log(`📄 Page ${currentPage}: Found ${jobCards.length} job cards`);

    for (let i = 0; i < jobCards.length; i++) {
      const job = jobCards[i];

      const data = await page.evaluate(el => {
        const getText = (selector) => {
          const node = el.querySelector(selector);
          return node ? node.innerText.trim() : '';
        };

        const relativeTime = getText('[data-test="posted-on"]');
        const title = getText('[data-test="job-tile-title"]');
        const description = getText('[data-test="job-description"]');
        const spendText = Array.from(el.querySelectorAll('span, strong'))
          .find(e => e.innerText.toLowerCase().includes('spent'))?.innerText || '';
        const hireText = Array.from(el.querySelectorAll('span, strong'))
          .find(e => e.innerText.toLowerCase().includes('hire rate'))?.innerText || '';
        const link = el.querySelector('a')?.href || '';

        return { relativeTime, title, description, spendText, hireText, link };
      }, job);

      // Stop if job is too old
      if (data.relativeTime.toLowerCase().includes('2 days ago')) {
        console.log('🛑 Found job from 2 days ago. Stopping.\n');
        hasMorePages = false;
        break;
      }

      if (allJobs.has(data.link)) continue;
      allJobs.add(data.link);

      // Keyword filter
      const combinedText = `${data.title} ${data.description}`.toLowerCase();
      if (!combinedText.includes('marketing')) continue;

      // Spend filter
      const spendMatch = data.spendText.match(/\$([\d,.]+)\s*[kK]?/);
      let spendValue = 0;
      if (spendMatch) {
        spendValue = parseFloat(spendMatch[1].replace(/,/g, ''));
        if (data.spendText.toLowerCase().includes('k')) spendValue *= 1000;
      }
      if (spendValue < 1000) continue;

      // Hire rate filter
      const hireMatch = data.hireText.match(/(\d+)\s*%/);
      const hireRateValue = hireMatch ? parseInt(hireMatch[1], 10) : 0;
      if (hireRateValue <= 30) continue;

      fs.appendFileSync('filtered_jobs.csv',
        `"${data.title}","${data.link}","${data.relativeTime}","${data.spendText}","${data.hireText}"\n`
      );

      console.log(`✅ MATCHED: ${data.title}`);
    }

    currentPage++;
    console.log(`⏳ Waiting before next page...\n`);
    await delay(8000 + Math.random() * 3000); // slow + random pause to mimic human
  }

  console.log('\n✅ Scraping finished.');
})();
