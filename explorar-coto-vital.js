const { chromium } = require('playwright');
const fs = require('fs');

async function explorar(browser, nombre, fn) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'es-AR',
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  console.log(`\n${'='.repeat(60)}\n${nombre}\n${'='.repeat(60)}`);
  const result = await fn(page).catch(e => ({ error: e.message }));
  await page.screenshot({ path: `/Users/valentinrodriguez/Downloads/supermarket/debug-${nombre}.png` });
  await ctx.close();
  return result;
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ── COTO ──────────────────────────────────────────────────────────────
  await explorar(browser, 'COTO-search-url', async (page) => {
    // Probar URL directa de búsqueda
    const url = 'https://www.cotodigital.com.ar/sitios/cdigi/nuevositio/buscador?query=leche&start=0&sz=10';
    console.log('URL:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    console.log('URL final:', page.url());

    // Volcar todos los textos que contengan $ para detectar precios
    const precios = await page.$$eval('*', els =>
      els
        .filter(el => el.children.length === 0 && /\$\s*[\d.,]+/.test(el.innerText))
        .slice(0, 10)
        .map(el => ({
          tag: el.tagName,
          class: el.className.slice(0, 80),
          texto: el.innerText.trim().slice(0, 60),
        }))
    );
    console.log('Elementos con $:', JSON.stringify(precios, null, 2));

    // Buscar contenedores de producto
    const prods = await page.$$eval('[class*="product"], [class*="Product"], [class*="item"], article', els =>
      els.slice(0, 3).map(el => ({
        class: el.className.slice(0, 100),
        text: el.innerText.trim().slice(0, 150),
      }))
    );
    console.log('\nContenedores de producto:', JSON.stringify(prods, null, 2));

    return { ok: true };
  });

  // ── COTO via form ──────────────────────────────────────────────────────
  await explorar(browser, 'COTO-form', async (page) => {
    await page.goto('https://www.cotodigital.com.ar/sitios/cdigi/nuevositio', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Encontrar el input de búsqueda correcto
    const inputs = await page.$$eval('input', els =>
      els.map(el => ({ type: el.type, name: el.name, id: el.id, placeholder: el.placeholder, class: el.className.slice(0, 60) }))
    );
    console.log('Inputs:', JSON.stringify(inputs, null, 2));

    // Intentar buscar con el input correcto
    const searchInput = await page.$('input[name="query"], input[id*="search"], input[placeholder*="buscar" i], input[placeholder*="Buscar" i]');
    if (searchInput) {
      console.log('Input encontrado, buscando leche...');
      await searchInput.click();
      await searchInput.fill('leche');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(4000);
      console.log('URL después de search:', page.url());
    }

    return { ok: true };
  });

  // ── VITAL ──────────────────────────────────────────────────────────────
  await explorar(browser, 'VITAL-home', async (page) => {
    await page.goto('https://www.vital.com.ar/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    const inputs = await page.$$eval('input', els =>
      els.map(el => ({ type: el.type, name: el.name, id: el.id, placeholder: el.placeholder, class: el.className.slice(0, 60) }))
    );
    console.log('Inputs:', JSON.stringify(inputs, null, 2));

    // Intentar diferentes URLs de búsqueda
    const urlsToTry = [
      'https://www.vital.com.ar/buscar?q=leche',
      'https://www.vital.com.ar/search?q=leche',
      'https://www.vital.com.ar/leche',
    ];

    for (const url of urlsToTry) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(2000);
        const finalUrl = page.url();
        const title = await page.title();
        const precios = await page.$$eval('*', els =>
          els.filter(el => el.children.length === 0 && /\$\s*[\d.,]+/.test(el.innerText))
             .slice(0, 5)
             .map(el => ({ class: el.className.slice(0, 60), texto: el.innerText.trim().slice(0, 40) }))
        );
        console.log(`\nURL: ${url} → ${finalUrl}`);
        console.log(`Title: ${title}`);
        console.log(`Precios: ${JSON.stringify(precios)}`);
        await page.screenshot({ path: `/Users/valentinrodriguez/Downloads/supermarket/debug-VITAL-${urlsToTry.indexOf(url)}.png` });
      } catch (e) {
        console.log(`Error en ${url}: ${e.message}`);
      }
    }

    return { ok: true };
  });

  await browser.close();
  console.log('\nExploración completa. Revisá los screenshots en /Users/valentinrodriguez/Downloads/supermarket/');
}

main().catch(console.error);
