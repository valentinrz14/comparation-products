/**
 * Comparador de precios - Supermercados AR
 * Supermercados: DIA, Carrefour, Jumbo, Disco, Coto
 *
 * Editar lista:  productos.json  (strings o { q, marca, ean })
 * Ejecutar:      node scraper.js
 *
 * La lógica de búsqueda, matching y promos vive en lib/ (compartida con api/scrape.js).
 */

const fs   = require('fs');
const path = require('path');
const { SUPERMERCADOS } = require('./lib/stores');
const { compararTodos, claveEntrada } = require('./lib/pipeline');

const PRODUCTOS = JSON.parse(fs.readFileSync(path.join(__dirname, 'productos.json'), 'utf8')).productos;
const SUPER_NAMES = SUPERMERCADOS.map((s) => s.nombre);

// ─── FORMATO ─────────────────────────────────────────────────────────────────
function formatPrecio(n) {
  if (n == null) return null;
  return `$${Number(n).toLocaleString('es-AR')}`;
}

function truncar(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function etiquetaPromo(item) {
  const abierta = (item.promos ?? []).find((p) => p.tipo !== 'medio_pago' && p.tipo !== 'campania');
  return abierta ? ` [${abierta.etiqueta}]` : '';
}

// Tabla general: primer resultado (alineado si lo hay) por tienda + variantes
function formatTablaGeneral(resultados) {
  const COL_PROD = 26, COL_PRECIO = 12, COL_NOMBRE = 30;
  const COL_SUPER = COL_PRECIO + 1 + COL_NOMBRE;
  const sepLine = `${'-'.repeat(COL_PROD)}+${SUPER_NAMES.map(() => '-'.repeat(COL_SUPER + 1)).join('+')}`;

  const lines = [
    '='.repeat(sepLine.length),
    'COMPARACIÓN GENERAL - PRIMER RESULTADO POR TIENDA',
    `Generado: ${new Date().toLocaleString('es-AR')}`,
    '='.repeat(sepLine.length),
    'PRODUCTO'.padEnd(COL_PROD) + '|' + SUPER_NAMES.map((n) => n.padEnd(COL_SUPER + 1)).join('|'),
    ' '.repeat(COL_PROD) + '|' + SUPER_NAMES.map(() => 'PRECIO'.padEnd(COL_PRECIO) + ' ' + 'VARIANTE ENCONTRADA'.padEnd(COL_NOMBRE + 1)).join('|'),
    sepLine,
  ];

  for (const [producto, precios] of Object.entries(resultados)) {
    const tops = SUPER_NAMES.map((n) => precios[n]?.[0]?.precio ?? null).filter((v) => v !== null);
    const minPrecio = tops.length ? Math.min(...tops) : null;

    lines.push(
      producto.padEnd(COL_PROD) + '|' +
      SUPER_NAMES.map((n) => {
        const top = precios[n]?.[0];
        if (!top) return '—'.padEnd(COL_SUPER + 1);
        const precioStr = ((formatPrecio(top.precio) ?? '—') + (top.precio === minPrecio ? ' ✓' : '')).padEnd(COL_PRECIO);
        return `${precioStr} ${truncar(top.nombre + etiquetaPromo(top), COL_NOMBRE).padEnd(COL_NOMBRE + 1)}`;
      }).join('|'),
    );

    for (let i = 1; i < 4; i++) {
      if (!SUPER_NAMES.some((n) => precios[n]?.[i])) break;
      lines.push(
        ' '.repeat(COL_PROD) + '|' +
        SUPER_NAMES.map((n) => {
          const v = precios[n]?.[i];
          if (!v) return ' '.repeat(COL_SUPER + 1);
          return `${(formatPrecio(v.precio) ?? '—').padEnd(COL_PRECIO)} ${('  └ ' + truncar(v.nombre, COL_NOMBRE - 4)).padEnd(COL_NOMBRE + 1)}`;
        }).join('|'),
      );
    }
  }

  lines.push(sepLine, '✓ = precio más bajo de la fila');
  return lines.join('\n');
}

// Tabla exacta: solo productos alineados (mismo EAN o misma marca+envase+variante)
function formatTablaExacta(resultados) {
  const COL_PROD = 45, COL_SUPER = 16;
  const sepLine = `${'-'.repeat(COL_PROD)}+${SUPER_NAMES.map(() => '-'.repeat(COL_SUPER)).join('+')}`;
  const lines = [
    '',
    '='.repeat(sepLine.length),
    'COMPARACIÓN DE PRODUCTO EXACTO (mismo ítem entre supermercados)',
    '✓ = más barato | — = no encontrado el mismo envase | ~ = aproximado (marca+envase+variante) | * = con promo',
    '='.repeat(sepLine.length),
    'PRODUCTO'.padEnd(COL_PROD) + '|' + SUPER_NAMES.map((n) => n.padEnd(COL_SUPER)).join('|'),
    sepLine,
  ];

  let filas = 0;
  for (const [producto, precios] of Object.entries(resultados)) {
    const m = precios._match;
    if (!m || m.tipo === 'ninguno') continue;
    filas++;
    const alineados = SUPER_NAMES.map((s) => (m.porTienda[s] ? precios[s]?.[0] : null));
    const validos = alineados.filter(Boolean).map((i) => i.precio);
    const minPrecio = Math.min(...validos);

    lines.push(
      truncar(`${producto} → ${m.nombre}${m.ean ? ` [${m.ean}]` : ''}`, COL_PROD).padEnd(COL_PROD) + '|' +
      SUPER_NAMES.map((s, i) => {
        const it = alineados[i];
        if (!it) return '—'.padEnd(COL_SUPER);
        const marcas = (it.precio === minPrecio ? ' ✓' : '') + (m.porTienda[s] === 'aprox' ? ' ~' : '') + (etiquetaPromo(it) ? ' *' : '');
        return (formatPrecio(it.precio) + marcas).padEnd(COL_SUPER);
      }).join('|'),
    );
  }
  if (filas === 0) return '';
  lines.push(sepLine);
  return lines.join('\n');
}

// Promos detectadas en los ítems alineados
function formatPromos(resultados) {
  const lines = [];
  for (const [producto, precios] of Object.entries(resultados)) {
    for (const s of SUPER_NAMES) {
      const it = precios[s]?.[0];
      if (!it) continue;
      const abiertas = (it.promos ?? []).filter((p) => p.tipo !== 'medio_pago' && p.tipo !== 'campania');
      for (const p of abiertas) {
        const efectivo = it.precioEfectivo < it.precio ? ` → ${formatPrecio(it.precioEfectivo)} c/u` : '';
        lines.push(`  ${s.padEnd(10)} ${truncar(producto, 28).padEnd(28)} ${p.etiqueta.padEnd(22)} ${formatPrecio(it.precio)}${efectivo}  ${truncar(it.nombre, 40)}`);
      }
    }
  }
  if (!lines.length) return '';
  return ['', '='.repeat(100), 'PROMOCIONES DETECTADAS (2x1, 2do al X%, descuentos directos)', '='.repeat(100), ...lines].join('\n');
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nComparando ${PRODUCTOS.length} productos en ${SUPERMERCADOS.length} supermercados...\n`);

  let preciosGuardados = {};
  const jsonPath = path.join(__dirname, 'precios.json');
  try { preciosGuardados = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { /* primera corrida */ }

  let hechos = 0;
  const resultados = await compararTodos(PRODUCTOS, SUPERMERCADOS, {
    preciosGuardados,
    concurrencia: 4,
    onProgreso: (_i, clave, r) => {
      hechos++;
      const m = r._match;
      const tag = m.tipo === 'ean' ? `EAN ${m.cobertura}/${SUPER_NAMES.length}` : m.tipo === 'aprox' ? `~   ${m.cobertura}/${SUPER_NAMES.length}` : 'sin match';
      const precios = SUPER_NAMES.map((s) => `${s}:${r[s]?.[0] ? formatPrecio(r[s][0].precio) : '✗'}`).join(' ');
      console.log(`  [${String(hechos).padStart(2)}/${PRODUCTOS.length}] ${truncar(clave, 28).padEnd(28)} ${tag.padEnd(9)} ${precios}`);
    },
  });

  // Mantener el orden original de productos.json
  const ordenado = {};
  for (const e of PRODUCTOS) ordenado[claveEntrada(e)] = resultados[claveEntrada(e)];

  fs.writeFileSync(jsonPath, JSON.stringify(ordenado, null, 2));

  const salida = formatTablaGeneral(ordenado) + '\n' + formatTablaExacta(ordenado) + '\n' + formatPromos(ordenado);
  const txtPath = path.join(__dirname, 'precios-tabla.txt');
  fs.writeFileSync(txtPath, salida);

  console.log('\n' + salida);
  console.log(`\n✓ JSON detallado:     ${jsonPath}`);
  console.log(`✓ Tabla completa:     ${txtPath}`);
  console.log('\nPara cambiar productos: editá productos.json y volvé a correr node scraper.js');
}

if (require.main === module) main().catch(console.error);

module.exports = { formatTablaGeneral, formatTablaExacta, formatPromos };
