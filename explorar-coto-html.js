const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  const url = 'https://www.cotodigital.com.ar/sitios/cdigi/nuevositio/buscador?query=leche&start=0&sz=10';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Scroll down para que carguen los resultados
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/Users/valentinrodriguez/Downloads/supermarket/debug-COTO-resultados.png', fullPage: false });

  // Obtener HTML de las cards de producto
  const cards = await page.$$eval('.card, [class*="card"]', els =>
    els.slice(0, 3).map(el => ({
      class: el.className.slice(0, 100),
      html: el.innerHTML.slice(0, 600),
    }))
  );
  console.log('Cards encontradas:', JSON.stringify(cards, null, 2));

  // Buscar el selector del nombre del producto
  const nombres = await page.$$eval('*', els =>
    els
      .filter(el =>
        el.children.length === 0 &&
        el.innerText.trim().length > 5 &&
        el.innerText.trim().length < 80 &&
        !el.innerText.includes('$') &&
        /leche/i.test(el.innerText)
      )
      .slice(0, 5)
      .map(el => ({
        tag: el.tagName,
        class: el.className.slice(0, 80),
        texto: el.innerText.trim(),
      }))
  );
  console.log('\nElementos con "leche":', JSON.stringify(nombres, null, 2));

  await ctx.close();
  await browser.close();
}

main().catch(console.error);
