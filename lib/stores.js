/**
 * Adaptadores por supermercado: convierten la respuesta cruda de cada API
 * en ítems normalizados con la misma forma.
 *
 * Ítem normalizado:
 * { nombre, marca, precio, disponible, ean, contenido, variantes, categoria, promos, precioEfectivo }
 */

const { extractContent, extractVariants } = require('./text');
const { parsePromosVtex, parsePromosCoto, precioEfectivo } = require('./promos');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};
const TIMEOUT_MS = 8000;
const RESULTADOS_POR_TIENDA = 50;

function normalizarItem(base) {
  const promos = base.promos ?? [];
  return {
    nombre:         base.nombre ?? '',
    marca:          base.marca ?? '',
    precio:         base.precio,
    disponible:     true,
    ean:            base.ean ? String(base.ean) : null,
    contenido:      base.contenido ?? extractContent(base.nombre),
    variantes:      extractVariants(base.nombre),
    categoria:      base.categoria ?? '',
    promos,
    precioEfectivo: precioEfectivo(base.precio, promos),
  };
}

// ─── VTEX (DIA, Carrefour, Jumbo, Disco) ─────────────────────────────────────
function contenidoDesdeSpecs(p) {
  // Carrefour: "Gramaje de unidad de consumo" = ["500.00"], "Gramaje de unidad de medida" = ["CM3"]
  const gramaje = p['Gramaje de unidad de consumo']?.[0];
  const unidad  = p['Gramaje de unidad de medida']?.[0];
  if (gramaje && unidad) {
    const c = extractContent(`${gramaje} ${unidad.replace(/^CM3$/i, 'ml').replace(/^GR$/i, 'g')}`);
    if (c) return c;
  }
  // Jumbo / Disco: "Contenido" = ["250 Grs"]
  const contenido = p.Contenido?.[0];
  if (contenido) {
    const c = extractContent(contenido);
    if (c) return c;
  }
  return null;
}

function parsearVtex(data) {
  const items = [];
  for (const p of Array.isArray(data) ? data : []) {
    for (const sku of p.items ?? []) {
      const offer = sku.sellers?.[0]?.commertialOffer ?? {};
      if (!(offer.Price > 0) || !offer.IsAvailable) continue;
      items.push(normalizarItem({
        nombre:    sku.name || p.productName,
        marca:     p.brand,
        precio:    offer.Price,
        ean:       sku.ean,
        contenido: extractContent(sku.name || p.productName) ?? contenidoDesdeSpecs(p),
        categoria: p.categories?.[0] ?? '',
        promos:    parsePromosVtex(offer, p.clusterHighlights),
      }));
    }
  }
  return items;
}

function urlBusquedaVtex(baseUrl, query) {
  return `${baseUrl}?ft=${encodeURIComponent(query)}&_from=0&_to=${RESULTADOS_POR_TIENDA - 1}`;
}
function urlEanVtex(baseUrl, ean) {
  return `${baseUrl}?fq=alternateIds_Ean:${encodeURIComponent(ean)}`;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── COTO ────────────────────────────────────────────────────────────────────
function categoriaCoto(data) {
  const g = data.groups?.[0];
  if (!g) return '';
  const partes = (g.path_list ?? []).map((x) => x.display_name).filter((n) => n && n !== 'Categorias');
  partes.push(g.display_name);
  return `/${partes.join('/')}/`;
}

function parsearCoto(data) {
  const items = [];
  for (const r of data?.response?.results ?? []) {
    const d = r.data ?? {};
    // priceWithoutTax === null indica que el precio en el índice de búsqueda está
    // desactualizado (puede ser 10x o 20x más barato que el precio real en tienda).
    if (d.price?.[0]?.priceWithoutTax == null) continue;
    const precio = d.product_list_price;
    if (!(precio > 0)) continue;
    const nombre = r.value ?? d.sku_display_name ?? '';
    let contenido = extractContent(nombre);
    if (d.product_weighable === 1) contenido = { valor: 1000, unidad: 'g', pesable: true };
    items.push(normalizarItem({
      nombre,
      marca:     d.product_brand,
      precio,
      ean:       d.product_main_ean,
      contenido,
      categoria: categoriaCoto(d),
      promos:    parsePromosCoto(d),
    }));
  }
  return items;
}

const COTO_KEY = 'key_r6xzz4IAoTWcipni';
function urlBusquedaCoto(query) {
  return `https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1/products/search/${encodeURIComponent(query)}?key=${COTO_KEY}&num_results_per_page=${RESULTADOS_POR_TIENDA}`;
}

// ─── REGISTRO DE SUPERMERCADOS ───────────────────────────────────────────────
function vtexStore(nombre, baseUrl) {
  return {
    nombre,
    buscar:       async (q)   => parsearVtex(await fetchJson(urlBusquedaVtex(baseUrl, q))),
    buscarPorEan: async (ean) => parsearVtex(await fetchJson(urlEanVtex(baseUrl, ean))),
  };
}

const SUPERMERCADOS = [
  vtexStore('DIA',       'https://diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search'),
  vtexStore('CARREFOUR', 'https://www.carrefour.com.ar/api/catalog_system/pub/products/search'),
  vtexStore('JUMBO',     'https://www.jumbo.com.ar/api/catalog_system/pub/products/search'),
  vtexStore('DISCO',     'https://www.disco.com.ar/api/catalog_system/pub/products/search'),
  {
    nombre: 'COTO',
    buscar:       async (q) => parsearCoto(await fetchJson(urlBusquedaCoto(q))),
    buscarPorEan: null, // Coto no expone búsqueda por EAN
  },
];

module.exports = {
  SUPERMERCADOS, parsearVtex, parsearCoto, urlBusquedaVtex, urlEanVtex, urlBusquedaCoto, normalizarItem, HEADERS,
};
