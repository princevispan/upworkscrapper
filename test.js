const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222'
  });

  const pages = await browser.pages();
  const page = pages[0];

  console.log('✅ Connected! Current tab title is:', await page.title());
})();