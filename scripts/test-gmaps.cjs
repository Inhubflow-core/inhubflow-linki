const { chromium } = require('playwright');

async function testDirectPlaceNavigation() {
  const query = 'Dentistas en Barcelona España';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'es-ES',
  });
  const page = await context.newPage();

  try {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=es`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3000);

    const items = await page.$$('a[href*="/maps/place/"]');
    console.log(`Found ${items.length} places in search`);

    const placeUrls = [];
    for (const item of items.slice(0, 3)) {
      const href = await item.getAttribute('href');
      const label = await item.getAttribute('aria-label');
      if (href) placeUrls.push({ name: label, href });
    }

    // Direct navigate to each place
    for (const p of placeUrls) {
      console.log(`Navigating directly to: ${p.name}`);
      await page.goto(p.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);

      const placeData = await page.evaluate(() => {
        const titleEl = document.querySelector('h1');
        const phoneEl = document.querySelector('[data-item-id*="phone"]');
        const webEl = document.querySelector('[data-item-id="authority"]');
        const addrEl = document.querySelector('[data-item-id="address"]');
        const ratingEl = document.querySelector('span[role="img"][aria-label*="estrellas"]');

        return {
          title: titleEl ? titleEl.innerText.trim() : '',
          phone: phoneEl ? phoneEl.innerText.trim() : '',
          website: webEl ? (webEl.getAttribute('href') || webEl.innerText.trim()) : '',
          address: addrEl ? addrEl.innerText.trim() : '',
          rating: ratingEl ? ratingEl.getAttribute('aria-label') : ''
        };
      });

      console.log('Place Data:', JSON.stringify(placeData, null, 2));
    }

    await browser.close();
  } catch (err) {
    console.error('Error:', err);
    await browser.close();
  }
}

testDirectPlaceNavigation();
