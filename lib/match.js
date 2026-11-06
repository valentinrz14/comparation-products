/**
 * Alineación entre tiendas: decide qué ítem de cada supermercado corresponde
 * al MISMO producto (mismo envase, peso, variante).
 *
 * Prioridad:
 *  1. EAN (código de barras) compartido: identidad exacta.
 *  2. Aproximado: misma marca + mismo contenido + mismas variantes.
 *
 * Criterio de elección entre candidatos: mayor cantidad de tiendas donde
 * aparece; a igual cobertura, el más barato.
 */

const { norm, tokens, tokenMatch } = require('./text');

function claveAprox(item) {
  const c = item.contenido;
  if (!c || !item.marca) return null;
  const marca = norm(item.marca).replace(/[^a-z0-9]/g, '');
  if (!marca) return null;
  const unidad = c.pesable ? 'kg' : (c.unidad === 'ml' ? 'g' : c.unidad); // g ≈ ml (densidad ~1)
  const variantes = [...(item.variantes ?? [])].sort().join(',');
  return `${marca}|${c.valor}${unidad}|${variantes}`;
}

// Jumbo y Disco comparten catálogo (Cencosud): a efectos de "en cuántas tiendas
// distintas aparece" cuentan como una sola.
const FAMILIAS = { JUMBO: 'CENCOSUD', DISCO: 'CENCOSUD' };
const familiaDe = (tienda) => FAMILIAS[tienda] ?? tienda;
function coberturaReal(items) {
  return new Set(Object.keys(items).map(familiaDe)).size;
}

// Agrupa candidatos de todas las tiendas por una clave. Por tienda conserva el más barato.
function agrupar(porSuper, claveDe) {
  const grupos = new Map();
  for (const [tienda, items] of Object.entries(porSuper)) {
    for (const item of items) {
      const clave = claveDe(item);
      if (!clave) continue;
      let g = grupos.get(clave);
      if (!g) { g = { clave, items: {}, minPrecio: Infinity, score: 0 }; grupos.set(clave, g); }
      const actual = g.items[tienda];
      if (!actual || item.precio < actual.precio) g.items[tienda] = item;
      g.minPrecio = Math.min(g.minPrecio, item.precio);
      g.score = Math.max(g.score, item._score ?? 0);
    }
  }
  return [...grupos.values()].map((g) => ({ ...g, cobertura: Object.keys(g.items).length, coberturaReal: coberturaReal(g.items) }));
}

// Mayor cantidad de backends distintos → más barato → más relevante al query
function mejorGrupo(grupos) {
  return grupos
    .filter((g) => g.coberturaReal >= 2)
    .sort((a, b) => b.coberturaReal - a.coberturaReal || a.minPrecio - b.minPrecio || b.score - a.score)[0] ?? null;
}

// Un aproximado que cuesta menos de la mitad o más del doble que el resto
// casi seguro es otro producto o un precio roto en la tienda.
const BANDA_PRECIO = { min: 0.5, max: 2 };
function precioPlausible(precio, referencia) {
  if (!referencia) return true;
  return precio >= referencia * BANDA_PRECIO.min && precio <= referencia * BANDA_PRECIO.max;
}
function mediana(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function alinear(porSuper) {
  const tiendas = Object.keys(porSuper);
  const porTienda = Object.fromEntries(tiendas.map((t) => [t, null]));
  const elegidos = {};

  let tipo = 'ninguno';
  let ean = null;
  let referencia = null;

  const ganadorEan = mejorGrupo(agrupar(porSuper, (i) => i.ean));
  if (ganadorEan) {
    tipo = 'ean';
    ean = ganadorEan.clave;
    for (const [t, item] of Object.entries(ganadorEan.items)) { elegidos[t] = item; porTienda[t] = 'ean'; }
    referencia = Object.values(ganadorEan.items).sort((a, b) => a.precio - b.precio)[0];
  }

  // Completar (o resolver todo) por aproximación
  const claveObjetivo = referencia ? claveAprox(referencia) : null;
  if (claveObjetivo) {
    const precioRef = mediana(Object.values(elegidos).map((i) => i.precio));
    for (const t of tiendas) {
      if (elegidos[t]) continue;
      const cand = porSuper[t]
        .filter((i) => claveAprox(i) === claveObjetivo && precioPlausible(i.precio, precioRef))
        .sort((a, b) => a.precio - b.precio)[0];
      if (cand) { elegidos[t] = cand; porTienda[t] = 'aprox'; }
    }
  } else {
    const ganadorAprox = mejorGrupo(agrupar(porSuper, claveAprox));
    if (ganadorAprox) {
      tipo = 'aprox';
      for (const [t, item] of Object.entries(ganadorAprox.items)) { elegidos[t] = item; porTienda[t] = 'aprox'; }
      referencia = Object.values(ganadorAprox.items).sort((a, b) => a.precio - b.precio)[0];
    }
  }

  const cobertura = Object.keys(elegidos).length;
  const salida = {};
  for (const t of tiendas) {
    const e = elegidos[t];
    salida[t] = e ? [e, ...porSuper[t].filter((i) => i !== e)] : porSuper[t];
  }

  return {
    porSuper: salida,
    match: {
      tipo,
      ean,
      nombre: referencia?.nombre ?? null,
      cobertura,
      porTienda,
      faltantes: tiendas.filter((t) => !elegidos[t]),
    },
  };
}

// Si un token del query es la marca de al menos 2 resultados, el query nombra una marca.
function detectarMarca(items, query) {
  for (const qt of tokens(query)) {
    const coincidencias = items.filter((i) => tokens(i.marca).some((m) => tokenMatch(qt, m))).length;
    if (coincidencias >= 2) return qt;
  }
  return null;
}

module.exports = { alinear, claveAprox, detectarMarca, agrupar };
