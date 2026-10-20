/**
 * Utilidades de texto compartidas por el scraper CLI y la API.
 */

function norm(str) {
  if (str == null) return '';
  return (Array.isArray(str) ? str.join(' ') : String(str))
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// "sin" y "por" no son stopwords: "sin sal"≠"con sal", "por salut"↔"port salut"
const STOPWORDS = new Set(['de', 'la', 'el', 'los', 'las', 'con', 'y', 'x', 'en', 'un', 'una']);

function tokens(str) {
  return norm(str).split(/\s+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

// Devuelve true si el token de query (q) matchea el token del producto (p).
// Permite variantes mínimas de escritura (yogurt≈yogur, pro≈pro+)
// pero bloquea falsos positivos (pro≠provitalis, ser≠serenisima).
// Regla: match si son iguales O si uno es prefijo del otro con ratio de largo ≤ 1.5
// Además: tokens numéricos ("000" vs "0000") solo matchean si son iguales,
// y tokens largos (≥6) toleran un error de tipeo (luchetti≈lucchetti).
function tokenMatch(q, p) {
  if (q === p) return true;
  if (/^\d+$/.test(q) || /^\d+$/.test(p)) return false;
  const shorter = q.length <= p.length ? q : p;
  const longer  = q.length <= p.length ? p : q;
  if (longer.length / shorter.length <= 1.5 && longer.startsWith(shorter)) return true;
  return shorter.length >= 6 && longer.length - shorter.length <= 1 && levenshtein(q, p) <= 1;
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Score: cuántos tokens del query matchean algún token del nombre
function scoreMatch(nombre, query) {
  const nombreTokens = tokens(nombre);
  return tokens(query).filter((qt) => nombreTokens.some((nt) => tokenMatch(qt, nt))).length;
}

// Ordena resultados por relevancia al query, filtra irrelevantes y $0.
// Requiere que el resultado matchee al menos el 80% de los tokens del query
// para evitar falsos positivos cuando hay marcas específicas en el nombre del producto.
function rankear(items, query) {
  const minScore = Math.ceil(tokens(query).length * 0.8);
  return items
    .filter((item) => item.precio > 0)
    .map((item) => ({ ...item, _score: scoreMatch(item.nombre, query) }))
    .filter((item) => item._score >= minScore)
    .sort((a, b) => b._score - a._score || a.precio - b.precio);
}

// ─── CONTENIDO (peso / volumen / unidades) ───────────────────────────────────
const UNIDADES = {
  g:  { unidad: 'g',  factor: 1 },     gr: { unidad: 'g', factor: 1 }, grs: { unidad: 'g', factor: 1 }, grm: { unidad: 'g', factor: 1 }, gramos: { unidad: 'g', factor: 1 },
  kg: { unidad: 'g',  factor: 1000 },  kgm: { unidad: 'g', factor: 1000 }, kilo: { unidad: 'g', factor: 1000 }, kilos: { unidad: 'g', factor: 1000 },
  ml: { unidad: 'ml', factor: 1 },     cc: { unidad: 'ml', factor: 1 }, cm3: { unidad: 'ml', factor: 1 }, cmq: { unidad: 'ml', factor: 1 }, mililitros: { unidad: 'ml', factor: 1 },
  l:  { unidad: 'ml', factor: 1000 },  lt: { unidad: 'ml', factor: 1000 }, lts: { unidad: 'ml', factor: 1000 }, ltr: { unidad: 'ml', factor: 1000 }, litro: { unidad: 'ml', factor: 1000 }, litros: { unidad: 'ml', factor: 1000 },
  u:  { unidad: 'un', factor: 1 },     un: { unidad: 'un', factor: 1 }, ud: { unidad: 'un', factor: 1 }, uni: { unidad: 'un', factor: 1 }, unid: { unidad: 'un', factor: 1 }, unidades: { unidad: 'un', factor: 1 },
  saq: { unidad: 'un', factor: 1 },    saquitos: { unidad: 'un', factor: 1 }, sobres: { unidad: 'un', factor: 1 }, cubos: { unidad: 'un', factor: 1 }, sob: { unidad: 'un', factor: 1 },
};
const UNIDAD_RE = Object.keys(UNIDADES).sort((a, b) => b.length - a.length).join('|');
// número + unidad: "500 Gr", "1kg", "0.130 Kg", "x 25 uni", "X6 Ud"
const CONTENIDO_RE = new RegExp(`(?:^|[^a-z0-9.,])x?\\s*(\\d+(?:[.,]\\d+)?)\\s*(${UNIDAD_RE})(?![a-z])`, 'g');
const POR_KILO_RE  = /(?:^|[^a-z0-9])x\s*kg\b|\bpor\s+kilo\b|\bx\s+kilo\b/;

/**
 * Extrae el contenido neto de un nombre de producto.
 * @returns {{valor:number, unidad:'g'|'ml'|'un', pesable?:true}|null}
 */
function extractContent(nombre) {
  const s = norm(nombre);
  if (!s) return null;

  if (POR_KILO_RE.test(s)) return { valor: 1000, unidad: 'g', pesable: true };

  const encontrados = [];
  for (const m of s.matchAll(CONTENIDO_RE)) {
    const def = UNIDADES[m[2]];
    const valor = parseFloat(m[1].replace(',', '.')) * def.factor;
    if (Number.isFinite(valor) && valor > 0) encontrados.push({ valor, unidad: def.unidad });
  }
  if (encontrados.length === 0) return null;

  // Peso o volumen tienen prioridad sobre el conteo de unidades
  const medida = encontrados.find((c) => c.unidad !== 'un');
  return medida ?? encontrados[0];
}

// ─── VARIANTES (cambian el producto aunque marca y tamaño coincidan) ─────────
const VARIANTES = [
  ['light',       /\blight\b|\blivian[ao]\b|\blite\b/],
  ['descremada',  /\bdescremad[ao]\b|\bmagr[ao]\b|\bparcialmente descremad[ao]\b/],
  ['entera',      /\benter[ao]\b/],
  ['sin sal',     /\bsin sal\b|\bbajo sodio\b|\bbajo en sodio\b|\bs\/sal\b|\bsin sal agregada\b/],
  ['sin lactosa', /\bsin lactosa\b|\bzero lactosa\b|\bdeslactosad[ao]\b|\b0% lactosa\b/],
  ['sin azucar',  /\bsin azucar\b|\bzero azucar\b|\bcero azucar\b|\bsin azucares\b/],
  ['sin tacc',    /\bsin tacc\b|\bsin gluten\b|\blibre de gluten\b/],
  ['integral',    /\bintegral(?:es)?\b/],
  ['rallado',     /\brallad[ao]\b/],
  ['fraccionado', /\bfraccionad[ao]\b/],
  ['organico',    /\borganic[ao]\b/],
  ['leudante',    /\bleudante\b/],
];

function extractVariants(nombre) {
  const s = norm(nombre);
  return VARIANTES.filter(([, re]) => re.test(s)).map(([nombreVariante]) => nombreVariante);
}

// ─── FILTRO DE RELEVANCIA ────────────────────────────────────────────────────
const MASCOTAS_RE       = /mascota|\bgato|\bperro|\bcat\b|\bdog\b|\bpet\b/;
const MASCOTAS_QUERY_RE = /mascota|\bgat[oa]s?\b|\bperr[oa]s?\b|\bcat\b|\bdog\b/;

function marcaCoincide(item, marca) {
  const objetivo = tokens(marca);
  if (objetivo.length === 0) return true;
  const enMarca  = tokens(item.marca);
  const enNombre = tokens(item.nombre);
  return objetivo.every((t) => enMarca.some((m) => tokenMatch(t, m)) || enNombre.some((n) => tokenMatch(t, n)));
}

/**
 * Quita resultados que matchean por texto pero son otro tipo de producto.
 * - Categoría Mascotas queda afuera salvo que el query sea de mascotas
 *   o nombre la marca del ítem.
 * - Si se indica `marca`, el ítem debe tenerla en su marca o en su nombre.
 */
function filtrarRelevantes(items, query, { marca } = {}) {
  const q = norm(query);
  const queryMascotas = MASCOTAS_QUERY_RE.test(q);
  return items.filter((item) => {
    if (MASCOTAS_RE.test(norm(item.categoria)) && !queryMascotas) {
      const marcaTokens = tokens(item.marca);
      const marcaEnQuery = marcaTokens.length > 0 && marcaTokens.every((m) => tokens(q).some((t) => tokenMatch(t, m)));
      if (!marcaEnQuery) return false;
    }
    if (marca && !marcaCoincide(item, marca)) return false;
    return true;
  });
}

module.exports = { norm, tokens, tokenMatch, scoreMatch, rankear, extractContent, extractVariants, filtrarRelevantes, marcaCoincide };
