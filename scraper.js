/**
 * Comparador de precios - Supermercados AR
 * Supermercados: DIA, Carrefour, Jumbo, Disco, Coto
 *
 * Editar lista:  productos.json
 * Ejecutar:      node scraper.js
 */

const fs   = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const PRODUCTOS_CONFIG = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'productos.json'), 'utf8')
);

const PRODUCTOS = PRODUCTOS_CONFIG.productos;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

// ─── NORMALIZACIÓN ────────────────────────────────────────────────────────────
function norm(str) {
  return (str ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokens(str) {
  const stopWords = new Set(['de', 'la', 'el', 'los', 'las', 'con', 'y', 'x', 'en', 'un', 'una']); // "sin" y "por" no son stopwords: "sin sal"≠"con sal", "por salut"↔"port salut"
  return norm(str).split(/\s+/).filter((w) => w.length > 1 && !stopWords.has(w));
}

// Similitud Jaccard entre dos strings (0 = nada en común, 1 = iguales)
function similitud(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  const interseccion = [...ta].filter((t) => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : interseccion / union;
}

// Devuelve true si el token de query (q) matchea el token del producto (p).
// Permite variantes mínimas de escritura (yogurt≈yogur, pro≈pro+)
// pero bloquea falsos positivos (pro≠provitalis, ser≠serenisima).
// Regla: match si son iguales O si uno es prefijo del otro con ratio de largo ≤ 1.5
function tokenMatch(q, p) {
  if (q === p) return true;
  const shorter = q.length <= p.length ? q : p;
  const longer  = q.length <= p.length ? p : q;
  return longer.length / shorter.length <= 1.5 && longer.startsWith(shorter);
}

// Score: cuántos tokens del query matchean algún token del nombre
function scoreMatch(nombre, query) {
  const queryTokens  = tokens(query);
  const nombreTokens = tokens(nombre);
  return queryTokens.filter(qt => nombreTokens.some(nt => tokenMatch(qt, nt))).length;
}

// Ordena resultados por relevancia al query, filtra irrelevantes y $0.
// Requiere que el resultado matchee al menos el 80% de los tokens del query
// para evitar falsos positivos cuando hay marcas específicas en el nombre del producto.
function rankear(items, query) {
  const queryTokens = tokens(query);
  const minScore = Math.ceil(queryTokens.length * 0.8);
  return items
    .filter((item) => item.precio > 0)
    .map((item) => ({ ...item, _score: scoreMatch(item.nombre, query) }))
    .filter((item) => item._score >= minScore)
    .sort((a, b) => b._score - a._score || a.precio - b.precio);
}

// ─── HELPERS VTEX ─────────────────────────────────────────────────────────────
function parsearVtex(data) {
  return data.map((p) => {
    const sellers = p.items?.[0]?.sellers ?? [];
    const offer   = sellers[0]?.commertialOffer ?? {};
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
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  const data = await res.json();
  const items = parsearVtex(data);
  return rankear(items, query);
}

// ─── SUPERMERCADOS ─────────────────────────────────────────────────────────────
const SUPERMERCADOS = [
  { nombre: 'DIA',       buscar: (q) => buscarVtex('https://diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search', q) },
  { nombre: 'CARREFOUR', buscar: (q) => buscarVtex('https://www.carrefour.com.ar/api/catalog_system/pub/products/search', q) },
  { nombre: 'JUMBO',     buscar: (q) => buscarVtex('https://www.jumbo.com.ar/api/catalog_system/pub/products/search', q) },
  { nombre: 'DISCO',     buscar: (q) => buscarVtex('https://www.disco.com.ar/api/catalog_system/pub/products/search', q) },
  {
    nombre: 'COTO',
    buscar: async (query) => {
      const url = `https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1/products/search/${encodeURIComponent(query)}?key=key_r6xzz4IAoTWcipni&num_results_per_page=15`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) return [];
      const data = await res.json();
      const items = (data.response?.results ?? [])
        // priceWithoutTax === null indica que el precio en el índice de búsqueda está
        // desactualizado (puede ser 10x o 20x más barato que el precio real en tienda).
        // Solo incluimos productos con precio vigente.
        .filter((r) => r.data?.price?.[0]?.priceWithoutTax != null)
        .map((r) => ({
          nombre:     r.value ?? r.data?.sku_display_name ?? '',
          marca:      r.data?.product_brand ?? '',
          precio:     r.data?.product_list_price ?? null,
          disponible: true,
        })).filter((p) => p.precio !== null && p.precio > 0);
      return rankear(items, query);
    },
  },
];

// ─── COMPARACIÓN EXACTA ───────────────────────────────────────────────────────
// Para cada producto busca el mismo ítem (mismo nombre y envase) en los 5 supers
// y muestra cuál es más barato.
// Umbral de similitud: 0.65 (ajustable)
const UMBRAL_SIMILITUD = 0.65;

function generarComparacionExacta(resultados) {
  const superNames = SUPERMERCADOS.map((s) => s.nombre);
  const grupos = []; // { nombre_referencia, items: { SUPER: { nombre, precio } } }

  for (const [_categoria, precios] of Object.entries(resultados)) {
    // Tomar todas las variantes de todos los supers
    const todosItems = [];
    for (const s of superNames) {
      for (const item of (precios[s] ?? [])) {
        todosItems.push({ ...item, super: s });
      }
    }

    // Agrupar por similitud de nombre
    const usados = new Set();
    for (let i = 0; i < todosItems.length; i++) {
      if (usados.has(i)) continue;
      const ref = todosItems[i];
      const grupo = { nombre: ref.nombre, items: {} };
      grupo.items[ref.super] = ref;
      usados.add(i);

      for (let j = i + 1; j < todosItems.length; j++) {
        if (usados.has(j)) continue;
        if (todosItems[j].super === ref.super) continue; // mismo super, saltar
        const sim = similitud(ref.nombre, todosItems[j].nombre);
        if (sim >= UMBRAL_SIMILITUD) {
          // Solo guardar el más barato por super en este grupo
          const s = todosItems[j].super;
          if (!grupo.items[s] || todosItems[j].precio < grupo.items[s].precio) {
            grupo.items[s] = todosItems[j];
          }
          usados.add(j);
        }
      }

      // Solo incluir grupos donde el mismo producto aparece en al menos 2 supers
      const supersConDatos = Object.keys(grupo.items).length;
      if (supersConDatos >= 2) {
        grupos.push(grupo);
      }
    }
  }

  // Deduplicar grupos muy similares entre sí
  const gruposFiltrados = [];
  const nombresVistos = new Set();
  for (const g of grupos) {
    const key = norm(g.nombre).slice(0, 40);
    if (!nombresVistos.has(key)) {
      nombresVistos.add(key);
      gruposFiltrados.push(g);
    }
  }

  return gruposFiltrados;
}

function formatTablaExacta(grupos) {
  if (grupos.length === 0) return '';
  const superNames = SUPERMERCADOS.map((s) => s.nombre);
  const COL_PROD   = 45;
  const COL_SUPER  = 14;
  const sepLine = `${'-'.repeat(COL_PROD)}+${superNames.map(() => '-'.repeat(COL_SUPER)).join('+')}`;

  const lines = [
    '',
    '='.repeat(sepLine.length),
    'COMPARACIÓN DE PRODUCTO EXACTO (mismo ítem entre supermercados)',
    '✓ = más barato | — = no encontrado',
    '='.repeat(sepLine.length),
    'PRODUCTO'.padEnd(COL_PROD) + '|' + superNames.map((n) => n.padEnd(COL_SUPER)).join('|'),
    sepLine,
  ];

  for (const grupo of grupos) {
    const precios = superNames.map((s) => grupo.items[s]?.precio ?? null);
    const validos = precios.filter((p) => p !== null);
    if (validos.length < 2) continue;
    const minPrecio = Math.min(...validos);

    const row =
      truncar(grupo.nombre, COL_PROD).padEnd(COL_PROD) + '|' +
      superNames.map((s, i) => {
        const p = precios[i];
        if (p === null) return '—'.padEnd(COL_SUPER);
        const label = p === minPrecio ? `$${p.toLocaleString('es-AR')} ✓` : `$${p.toLocaleString('es-AR')}`;
        return label.padEnd(COL_SUPER);
      }).join('|');

    lines.push(row);
  }

  lines.push(sepLine);
  return lines.join('\n');
}

// ─── FORMATO TABLA GENERAL ────────────────────────────────────────────────────
function formatPrecio(n) {
  if (n == null) return null;
  return `$${Number(n).toLocaleString('es-AR')}`;
}

function truncar(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function formatTablaGeneral(resultados) {
  const superNames = SUPERMERCADOS.map((s) => s.nombre);
  const COL_PROD   = 26;
  const COL_PRECIO = 12;
  const COL_NOMBRE = 26;
  const COL_SUPER  = COL_PRECIO + 1 + COL_NOMBRE;
  const sepLine = `${'-'.repeat(COL_PROD)}+${superNames.map(() => '-'.repeat(COL_SUPER + 1)).join('+')}`;

  const header    = 'PRODUCTO'.padEnd(COL_PROD) + '|' + superNames.map((n) => n.padEnd(COL_SUPER + 1)).join('|');
  const subheader = ' '.repeat(COL_PROD) + '|' + superNames.map(() => 'PRECIO'.padEnd(COL_PRECIO) + ' ' + 'VARIANTE ENCONTRADA'.padEnd(COL_NOMBRE + 1)).join('|');

  const lines = [
    '='.repeat(sepLine.length),
    'COMPARACIÓN GENERAL - MEJOR PRECIO POR CATEGORÍA',
    `Generado: ${new Date().toLocaleString('es-AR')}`,
    '='.repeat(sepLine.length),
    header, subheader, sepLine,
  ];

  for (const [producto, precios] of Object.entries(resultados)) {
    const todosPrecios = superNames.map((n) => precios[n]?.[0]?.precio ?? null).filter((v) => v !== null);
    const minPrecio = todosPrecios.length ? Math.min(...todosPrecios) : null;

    const row =
      producto.padEnd(COL_PROD) + '|' +
      superNames.map((n) => {
        const top = precios[n]?.[0];
        if (!top) return '—'.padEnd(COL_SUPER + 1);
        const precio = formatPrecio(top.precio) ?? '—';
        const isCheapest = top.precio === minPrecio;
        const precioStr = (isCheapest ? precio + ' ✓' : precio).padEnd(COL_PRECIO);
        const nombreStr = truncar(top.nombre, COL_NOMBRE).padEnd(COL_NOMBRE + 1);
        return `${precioStr} ${nombreStr}`;
      }).join('|');
    lines.push(row);

    for (let i = 1; i < 4; i++) {
      const hasMore = superNames.some((n) => precios[n]?.[i]);
      if (!hasMore) break;
      const varRow =
        ' '.repeat(COL_PROD) + '|' +
        superNames.map((n) => {
          const v = precios[n]?.[i];
          if (!v) return ' '.repeat(COL_SUPER + 1);
          const precio = (formatPrecio(v.precio) ?? '—').padEnd(COL_PRECIO);
          const nombreStr = ('  └ ' + truncar(v.nombre, COL_NOMBRE - 4)).padEnd(COL_NOMBRE + 1);
          return `${precio} ${nombreStr}`;
        }).join('|');
      lines.push(varRow);
    }
  }

  lines.push(sepLine);
  lines.push('✓ = precio más bajo para esa categoría');
  return lines.join('\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nComparando ${PRODUCTOS.length} productos en ${SUPERMERCADOS.length} supermercados...\n`);
  const resultados = {};

  for (const producto of PRODUCTOS) {
    resultados[producto] = {};
    process.stdout.write(`  [${String(Object.keys(resultados).length).padStart(2)}/${PRODUCTOS.length}] ${producto.padEnd(28)}`);

    const busquedas = await Promise.allSettled(SUPERMERCADOS.map((s) => s.buscar(producto)));

    for (let i = 0; i < SUPERMERCADOS.length; i++) {
      const s = SUPERMERCADOS[i];
      if (busquedas[i].status === 'fulfilled') {
        resultados[producto][s.nombre] = busquedas[i].value;
        const top = busquedas[i].value[0];
        process.stdout.write(` ${s.nombre}:${top ? formatPrecio(top.precio) : '✗'}`);
      } else {
        resultados[producto][s.nombre] = [];
        process.stdout.write(` ${s.nombre}:ERR`);
      }
    }
    console.log();
  }

  // Guardar JSON detallado
  const jsonPath = path.join(__dirname, 'precios.json');
  fs.writeFileSync(jsonPath, JSON.stringify(resultados, null, 2));

  // Tabla general
  const tablaGeneral = formatTablaGeneral(resultados);

  // Comparación exacta
  const grupos = generarComparacionExacta(resultados);
  const tablaExacta = formatTablaExacta(grupos);

  const salida = tablaGeneral + '\n' + tablaExacta;

  const txtPath = path.join(__dirname, 'precios-tabla.txt');
  fs.writeFileSync(txtPath, salida);

  console.log('\n' + salida);
  console.log(`\n✓ JSON detallado:     ${jsonPath}`);
  console.log(`✓ Tabla completa:     ${txtPath}`);
  console.log('\nPara cambiar productos: editá productos.json y volvé a correr node scraper.js');
}

main().catch(console.error);
