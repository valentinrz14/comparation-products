/**
 * Normalización de promociones por tienda.
 *
 * Tipos:
 *  - segunda_unidad: "2do al 70%"        → descuento sobre la 2ª unidad, minimo 2
 *  - nxm:            "3x2"               → lleva N paga M
 *  - porcentaje:     "35% OFF"           → descuento directo sobre el precio
 *  - medio_pago:     tarjeta / cuenta / membresía → no cambia el precio efectivo
 *  - campania:       etiqueta genérica de campaña (Jumbo/Disco) → sin precio efectivo
 */

const RE_SEGUNDA = /\b2\s*(?:d[ao]|da\.?|do\.?)\s*(?:unid(?:ad)?\.?)?\s*(?:al\s*)?(\d{1,2})\s*%|\b(\d{1,2})\s*%\s*(?:dto\.?\s*)?(?:en\s+la\s+)?2\s*(?:d[ao]|da|do)\b/i;
const RE_NXM     = /\b(\d)\s*x\s*(\d)\b/i;
const RE_PCT     = /(\d{1,2})\s*%/;
const RE_MEDIO   = /tarjeta|cuenta digital|comunidad|miembros|banco|debito|credito|cencopay|prime|bbva|santander|galicia|macro|mercado ?pago|modo\b/i;
const RE_CAMPANIA_OK = /2d[ao]|2x1|3x2|4x3|%|ahorro|oferta|descuento|promo/i;

function teaserName(t) {
  return t?.['<Name>k__BackingField'] ?? t?.Name ?? '';
}
function teaserMinQty(t) {
  return t?.['<Conditions>k__BackingField']?.['<MinimumQuantity>k__BackingField'] ?? t?.Conditions?.MinimumQuantity ?? 0;
}

function clasificarEtiqueta(raw, minimoHint = 0) {
  const texto = raw.trim();
  if (RE_MEDIO.test(texto)) return { tipo: 'medio_pago', etiqueta: texto };

  const seg = texto.match(RE_SEGUNDA);
  if (seg) {
    const descuento = Number(seg[1] ?? seg[2]);
    return { tipo: 'segunda_unidad', etiqueta: `2do al ${descuento}%`, descuento, minimo: 2 };
  }
  const nxm = texto.match(RE_NXM);
  if (nxm && Number(nxm[1]) > Number(nxm[2])) {
    const lleva = Number(nxm[1]), paga = Number(nxm[2]);
    return { tipo: 'nxm', etiqueta: `${lleva}x${paga}`, lleva, paga, minimo: lleva };
  }
  const pct = texto.match(RE_PCT);
  if (pct && minimoHint <= 1) {
    const descuento = Number(pct[1]);
    return { tipo: 'porcentaje', etiqueta: `${descuento}% OFF`, descuento, minimo: 1 };
  }
  return null;
}

// ─── VTEX (DIA, Carrefour, Jumbo, Disco) ─────────────────────────────────────
function parsePromosVtex(offer = {}, clusterHighlights = null) {
  const promos = [];
  const vistas = new Set();

  for (const t of [...(offer.Teasers ?? []), ...(offer.PromotionTeasers ?? [])]) {
    const nombre = teaserName(t);
    if (!nombre || vistas.has(nombre)) continue;
    vistas.add(nombre);
    const p = clasificarEtiqueta(nombre, teaserMinQty(t));
    if (p) promos.push(p);
  }

  // Precio de lista vs precio actual (DIA lo informa bien; Jumbo/Disco devuelven basura 100x)
  const { Price, ListPrice } = offer;
  if (Price > 0 && ListPrice > Price && ListPrice / Price <= 3) {
    const descuento = Math.round((1 - Price / ListPrice) * 100);
    if (descuento >= 5 && !promos.some((p) => p.tipo === 'porcentaje')) {
      promos.push({ tipo: 'porcentaje', etiqueta: `${descuento}% OFF`, descuento, minimo: 1 });
    }
  }

  // Etiquetas de campaña legibles (Jumbo/Disco no exponen teasers)
  if (clusterHighlights) {
    const vistasCamp = new Set();
    for (const etiqueta of Object.values(clusterHighlights)) {
      if (!etiqueta || /^[A-Z]+_/.test(etiqueta) || !RE_CAMPANIA_OK.test(etiqueta) || vistasCamp.has(etiqueta)) continue;
      vistasCamp.add(etiqueta);
      promos.push({ tipo: 'campania', etiqueta });
    }
  }
  return promos;
}

// ─── COTO ────────────────────────────────────────────────────────────────────
function parsearPesos(str) {
  if (str == null) return null;
  const n = parseFloat(String(str).replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parsePromosCoto(data = {}) {
  const promos = [];
  const saleTypes = (data.sale_type ?? []).map((s) => s.replace(/!+/g, '').trim());

  for (const d of data.discounts ?? []) {
    const taking = (d.takingText ?? '').match(/\d+/);
    const minimo = taking ? Number(taking[0]) : 1;
    const texto  = `${d.takingText ?? ''} ${d.discountText ?? ''}`;
    let p = null;
    if (minimo >= 2) {
      const pct = (d.discountText ?? '').match(RE_PCT);
      if (pct) p = { tipo: 'segunda_unidad', etiqueta: `2do al ${pct[1]}%`, descuento: Number(pct[1]), minimo };
      else { const nxm = texto.match(RE_NXM); if (nxm) p = { tipo: 'nxm', etiqueta: `${nxm[1]}x${nxm[2]}`, lleva: Number(nxm[1]), paga: Number(nxm[2]), minimo }; }
    } else {
      p = clasificarEtiqueta(d.discountText ?? '', 1);
    }
    if (!p) continue;
    // Preferir la etiqueta tal como la muestra Coto ("2da Unid 70% DTO")
    const etiquetaCoto = saleTypes.find((s) => /2d[ao]\s*unid/i.test(s) && s.includes(String(p.descuento ?? '')));
    if (etiquetaCoto) p.etiqueta = etiquetaCoto;
    const precioUnitario = parsearPesos(d.discountPrice);
    if (precioUnitario) p.precioUnitario = precioUnitario;
    promos.push(p);
  }

  for (const s of saleTypes) {
    if (RE_MEDIO.test(s)) promos.push({ tipo: 'medio_pago', etiqueta: s });
  }
  return promos;
}

// ─── PRECIO EFECTIVO ─────────────────────────────────────────────────────────
// Precio por unidad si se aprovecha la mejor promo abierta (no por medio de pago).
function precioEfectivo(precio, promos = []) {
  let mejor = precio;
  for (const p of promos) {
    let unitario = null;
    if (p.precioUnitario) unitario = p.precioUnitario;
    else if (p.tipo === 'segunda_unidad') unitario = (precio + precio * (1 - p.descuento / 100)) / 2;
    else if (p.tipo === 'nxm') unitario = precio * p.paga / p.lleva;
    else if (p.tipo === 'porcentaje') unitario = precio; // el precio publicado ya tiene el descuento aplicado
    if (unitario != null && unitario < mejor) mejor = unitario;
  }
  return Math.round(mejor * 100) / 100;
}

module.exports = { parsePromosVtex, parsePromosCoto, precioEfectivo, clasificarEtiqueta };
