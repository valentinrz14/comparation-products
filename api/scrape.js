/**
 * Vercel Serverless Function — /api/scrape
 * Scrapes all supermarkets in parallel and merges NINI prices from precios.json.
 */

const path = require('path');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// ── Scoring helpers ──────────────────────────────────────────────────────────
function norm(str) {
  return (str ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokens(str) {
  const stop = new Set(['de', 'la', 'el', 'los', 'las', 'con', 'y', 'x', 'en', 'un', 'una']);
  return norm(str).split(/\s+/).filter((w) => w.length > 1 && !stop.has(w));
}

function tokenMatch(q, p) {
  if (q === p) return true;
  const [short, long] = q.length <= p.length ? [q, p] : [p, q];
  return long.length / short.length <= 1.5 && long.startsWith(short);
}

function scoreMatch(nombre, query) {
  const qToks = tokens(query);
  const nToks = tokens(nombre);
  return qToks.filter(qt => nToks.some(nt => tokenMatch(qt, nt))).length;
}

function rankear(items, query) {
  const qToks = tokens(query);
  const min   = Math.ceil(qToks.length * 0.8);
  return items
    .filter((i) => i.precio > 0)
    .map((i) => ({ ...i, _score: scoreMatch(i.nombre, query) }))
    .filter((i) => i._score >= min)
    .sort((a, b) => b._score - a._score || a.precio - b.precio);
}

// ── Store adapters ───────────────────────────────────────────────────────────
function parsearVtex(data) {
  return data.map((p) => {
    const offer = p.items?.[0]?.sellers?.[0]?.commertialOffer ?? {};
    return {
      nombre:     p.productName ?? '',
      marca:      p.brand ?? '',
      precio:     offer.Price ?? null,
      disponible: offer.IsAvailable ?? false,
    };
  }).filter((p) => p.precio !== null && p.precio > 0 && p.disponible);
}

async function buscarVtex(baseUrl, query) {
  const url = `${baseUrl}?ft=${encodeURIComponent(query)}&_from=0&_to=14`;
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    return rankear(parsearVtex(await res.json()), query);
  } catch { return []; }
}

const SUPERMERCADOS = [
  { nombre: 'DIA',       buscar: (q) => buscarVtex('https://diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search', q) },
  { nombre: 'CARREFOUR', buscar: (q) => buscarVtex('https://www.carrefour.com.ar/api/catalog_system/pub/products/search', q) },
  { nombre: 'JUMBO',     buscar: (q) => buscarVtex('https://www.jumbo.com.ar/api/catalog_system/pub/products/search', q) },
  { nombre: 'DISCO',     buscar: (q) => buscarVtex('https://www.disco.com.ar/api/catalog_system/pub/products/search', q) },
  {
    nombre: 'COTO',
    buscar: async (query) => {
      const url = `https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1/products/search/${encodeURIComponent(query)}?key=key_r6xzz4IAoTWcipni&num_results_per_page=15`;
      try {
        const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
        if (!res.ok) return [];
        const data = await res.json();
        const items = (data.response?.results ?? [])
          .filter((r) => r.data?.price?.[0]?.priceWithoutTax != null)
          .map((r) => ({
            nombre:     r.value ?? r.data?.sku_display_name ?? '',
            marca:      r.data?.product_brand ?? '',
            precio:     r.data?.product_list_price ?? null,
            disponible: true,
          })).filter((p) => p.precio !== null && p.precio > 0);
        return rankear(items, query);
      } catch { return []; }
    },
  },
];

// ── Concurrency limiter ──────────────────────────────────────────────────────
async function pLimit(tasks, concurrency) {
  const results = new Array(tasks.length);
  let idx = 0;
  const worker = async () => {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Handler ──────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const { productos } = require(path.resolve(__dirname, '../productos.json'));
    const preciosGuardados = require(path.resolve(__dirname, '../precios.json'));

    const tasks = productos.map((producto) => async () => {
      const searches = await Promise.allSettled(SUPERMERCADOS.map((s) => s.buscar(producto)));
      const result = {};
      for (let i = 0; i < SUPERMERCADOS.length; i++) {
        result[SUPERMERCADOS[i].nombre] = searches[i].status === 'fulfilled' ? searches[i].value : [];
      }
      // Preserve NINI prices (added manually from receipts — not scraped)
      if (preciosGuardados[producto]?.NINI?.length) {
        result.NINI = preciosGuardados[producto].NINI;
      }
      return result;
    });

    const results = await pLimit(tasks, 8);

    const data = {};
    for (let i = 0; i < productos.length; i++) {
      data[productos[i]] = results[i];
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
