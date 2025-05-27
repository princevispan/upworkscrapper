const puppeteer = require('puppeteer-core');
const fs = require('fs');

const path = 'filtered_jobs.csv';
const lastPageFile = 'last_scraped_page.txt';

const keywordPhrases = [
  "marketing", "digital marketing", "performance marketing", "social media", "facebook ads", "google ads", "ppc",
  "graphic design", "branding", "logo design", "poster", "canva", "photoshop", "illustrator", "figma",
  "video editing", "reels", "after effects", "premiere pro", "motion graphics", "youtube editing",
  "wordpress", "shopify", "cms", "landing page", "elementor", "woocommerce", "web design", "web development",
  "seo", "on-page", "off-page", "technical seo", "local seo", "link building",
  "content writing", "copywriting", "blog writing", "website content", "article writing", "product description",
  "data analytics", "google analytics", "ga4", "gtm", "google tag manager", "gohighlevel", "go high level", "crm",
  "reporting", "dashboard", "data studio"
];

// Helper delay function
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const RESET_SCRAPE = true;

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  });

  const searchPage = await browser.newPage();

  const stream = fs.createWriteStream(path, { flags: 'a' });
  if (!fs.existsSync(path) || fs.readFileSync(path).length === 0) {
    stream.write(`"Job URL","Spend","Hire Rate","Interviewing","Invites Sent","Matched Keywords"\n`);
  }

  let START_PAGE = 11;
  const END_PAGE = 18;

  const cleanExit = async () => {
    console.log('\n💾 Closing CSV and browser...');
    stream.end();
    if (!searchPage.isClosed()) await searchPage.close();
    await browser.disconnect();
    process.exit();
  };

  process.on('SIGINT', cleanExit);
  process.on('SIGTERM', cleanExit);

  for (let pageNum = START_PAGE; pageNum <= END_PAGE; pageNum++) {
    console.log(`\n📄 Scraping Page ${pageNum}...`);

    fs.writeFileSync(lastPageFile, pageNum.toString());

    const searchUrl = `https://www.upwork.com/nx/search/jobs/?amount=100-499,500-999,1000-4999,5000-&payment_verified=1&proposals=0-4&t=0,1&page=${pageNum}&per_page=50`;

    try {
      await searchPage.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await delay(8000);

      const jobLinks = await searchPage.evaluate(() => {
        return Array.from(document.querySelectorAll('a.air3-link[data-test^="job-tile-title-link"], a[data-test="job-tile-title-link"]'))
          .map(el => el.getAttribute('href'))
          .filter(href => href && href.startsWith('/jobs/'))
          .map(href => 'https://www.upwork.com' + href.split('?')[0]);
      });

      console.log(`🔗 Found ${jobLinks.length} job posts on page ${pageNum}.`);

      if (jobLinks.length === 0) {
        console.log(`⛔ No jobs found on page ${pageNum}, stopping scrape.`);
        break;
      }

      for (const url of jobLinks) {
        console.log(`\n🚀 Scraping job: ${url}`);

        let jobPage = null;
        try {
          jobPage = await browser.newPage();

          const response = await jobPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (!response || !response.ok()) {
            console.log(`⚠️ Failed to load job page: ${url}`);
            await jobPage.close();
            continue;
          }

          await jobPage.waitForSelector('body', { timeout: 3000 }).catch(() => {});

          const jobText = await jobPage.evaluate(() => document.body.innerText.toLowerCase());

          const spend = await jobPage.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('div, span, small')).filter(el =>
              el.innerText?.toLowerCase().includes('total spent')
            );
            for (const label of labels) {
              const sibling = label.nextElementSibling;
              if (sibling && sibling.innerText.includes('$')) {
                return parseInt(sibling.innerText.replace(/[^\d]/g, '')) || 0;
              }
            }
            return 0;
          });

          const hireMatch = jobText.match(/(\d{1,3})%\s+hire rate/);
          const hireRate = hireMatch ? parseInt(hireMatch[1]) : 0;

          const interviewingMatch = jobText.match(/interviewing\s*:\s*(\d+)/);
          const interviewingCount = interviewingMatch ? parseInt(interviewingMatch[1]) : 0;

          const invitesMatch = jobText.match(/invites sent\s*:\s*(\d+)/);
          const invitesCount = invitesMatch ? parseInt(invitesMatch[1]) : 0;

          const matchedKeywords = keywordPhrases.filter(k => jobText.includes(k));

          if (
            spend >= 1000 &&
            hireRate >= 30 &&
            matchedKeywords.length &&
            interviewingCount === 0 &&
            invitesCount === 0
          ) {
            console.log(`✅ MATCHED: Spend = $${spend}, Hire Rate = ${hireRate}%, Interviewing = ${interviewingCount}, Invites Sent = ${invitesCount}, Keywords: ${matchedKeywords.join(', ')}`);
            stream.write(`"${url}","$${spend}","${hireRate}%","${interviewingCount}","${invitesCount}","${matchedKeywords.join('; ')}"\n`);
          } else {
            console.log(`❌ SKIPPED: Spend = $${spend}, Hire Rate = ${hireRate}%, Interviewing = ${interviewingCount}, Invites Sent = ${invitesCount}, Keywords = ${matchedKeywords.length}`);
          }

          await jobPage.close();
        } catch (err) {
          console.log(`⚠️ Job error (${url}): ${err.message}`);
          if (jobPage) await jobPage.close();
        }

        await delay(1500);
      }
    } catch (err) {
      console.log(`⚠️ Error scraping page ${pageNum}: ${err.message}`);
      if (!browser.isConnected()) {
        console.log('❌ Browser disconnected, stopping scraper.');
        break;
      }
    }
  }

  await cleanExit();
})();
