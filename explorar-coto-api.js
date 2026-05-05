const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  // Interceptar requests de red
  const apiCalls = [];
  page.on('request', req => {
    const url = req.url();
    if (url.includes('search') || url.includes('busca') || url.includes('query') || url.includes('product') || url.includes('api')) {
      apiCalls.push({ method: req.method(), url: url.slice(0, 150) });
    }
  });

  await page.goto('https://www.cotodigital.com.ar/sitios/cdigi/nuevositio', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForTimeout(2000);

  // Usar el input de búsqueda
  const input = await page.$('#cio-autocomplete-12-input, input.cio-input, input[placeholder*="comprar"]');
  if (input) {
    console.log('Input encontrado, escribiendo leche...');
    await input.click();
    await input.fill('leche');
    await page.waitForTimeout(1000);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);

    const finalUrl = page.url();
    console.log('URL tras Enter:', finalUrl);

    // Scroll a resultados
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForTimeout(1500);

    // Buscar cards de producto
    const cards = await page.$$eval('.card-container', els =>
      els.slice(0, 5).map(el => {
        const precio = el.querySelector('h4.card-title')?.innerText?.trim();
        const nombre = el.querySelector('p, span:not([class*="promo"]):not([class*="cucarda"])')?.innerText?.trim();
        const link = el.querySelector('a')?.href;
        return { nombre, precio, link: link?.slice(0, 80) };
      })
    );
    console.log('\nCards de producto:', JSON.stringify(cards, null, 2));
  } else {
    console.log('Input NO encontrado');
  }

  console.log('\nAPI calls capturadas:');
  apiCalls.forEach(c => console.log(`  ${c.method} ${c.url}`));

  await ctx.close();
  await browser.close();
}

main().catch(console.error);
