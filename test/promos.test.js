const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePromosVtex, parsePromosCoto, precioEfectivo } = require('../lib/promos');

const fx = (n) => require(`./fixtures/${n}`);
const offer = (p) => p.items[0].sellers[0].commertialOffer;

test('VTEX DIA: teaser "2do al 70%" es segunda unidad con precio efectivo por unidad', () => {
  const p = fx('vtex-dia-yogur.json')[0]; // Yogurísimo 140 Gr, $2190
  const promos = parsePromosVtex(offer(p), p.clusterHighlights);
  assert.deepEqual(promos, [{ tipo: 'segunda_unidad', etiqueta: '2do al 70%', descuento: 70, minimo: 2 }]);
  assert.equal(precioEfectivo(2190, promos), 1423.5); // (2190 + 2190*0.30) / 2
});

test('VTEX Carrefour: "PROMO-3x2 ..." es NxM y se limpia la etiqueta', () => {
  const p = fx('vtex-carrefour-gaseosa.json')[1]; // Mirinda 500 ml, $2100
  const promos = parsePromosVtex(offer(p), p.clusterHighlights);
  const abiertas = promos.filter((x) => x.tipo !== 'medio_pago');
  assert.deepEqual(abiertas, [{ tipo: 'nxm', etiqueta: '3x2', lleva: 3, paga: 2, minimo: 3 }]);
  assert.equal(precioEfectivo(2100, promos), 1400);
});

test('VTEX Carrefour: "PROMO-2do al 50% Iguales" es segunda unidad al 50%', () => {
  const p = fx('vtex-carrefour-gaseosa.json')[0]; // Coca Cola 2,25 lts, $5900
  const promos = parsePromosVtex(offer(p), p.clusterHighlights);
  const abiertas = promos.filter((x) => x.tipo !== 'medio_pago');
  assert.deepEqual(abiertas, [{ tipo: 'segunda_unidad', etiqueta: '2do al 50%', descuento: 50, minimo: 2 }]);
  assert.equal(precioEfectivo(5900, promos), 4425);
});

test('VTEX Carrefour: promos por tarjeta o cuenta se marcan como medio_pago y no bajan el precio efectivo', () => {
  const p = fx('vtex-carrefour-gaseosa.json')[3]; // Coca Cola 1,75 lts, solo tarjeta
  const promos = parsePromosVtex(offer(p), p.clusterHighlights);
  assert.deepEqual(promos.map((x) => x.tipo), ['medio_pago', 'medio_pago']);
  assert.deepEqual(promos.map((x) => x.etiqueta), ['Tarjeta Carrefour 15%', 'Cuenta Digital Carrefour 15% Off Viernes']);
  assert.equal(precioEfectivo(4900, promos), 4900);
});

test('VTEX: precio de lista mayor al precio es un descuento porcentual (solo si es creíble)', () => {
  const promos = parsePromosVtex({ Price: 2590, ListPrice: 3990, Teasers: [] }, null);
  assert.deepEqual(promos, [{ tipo: 'porcentaje', etiqueta: '35% OFF', descuento: 35, minimo: 1 }]);
  assert.equal(precioEfectivo(2590, promos), 2590);
  // Jumbo devuelve ListPrice basura (100x): se ignora
  assert.deepEqual(parsePromosVtex({ Price: 4950, ListPrice: 409091, Teasers: [] }, null), []);
});

test('VTEX Jumbo: clusterHighlights legibles se informan como campaña sin precio efectivo', () => {
  const p = fx('vtex-jumbo-gaseosa.json')[0];
  const promos = parsePromosVtex(offer(p), p.clusterHighlights);
  assert.deepEqual(promos, [
    { tipo: 'campania', etiqueta: 'Zona de ahorro' },
    { tipo: 'campania', etiqueta: 'Hasta 2do al 70% en Almacén y Bebidas' },
  ]);
  assert.equal(precioEfectivo(4950, promos), 4950);
});

test('Coto: "Llevando 2 / 70% 2da" es segunda unidad y usa el precio promo que informa Coto', () => {
  const x = fx('coto-yogur.json').response.results[0]; // Yogurísimo 300g, $4915 → $3194.75
  const promos = parsePromosCoto(x.data);
  assert.deepEqual(promos, [{ tipo: 'segunda_unidad', etiqueta: '2da Unid 70% DTO', descuento: 70, minimo: 2, precioUnitario: 3194.75 }]);
  assert.equal(precioEfectivo(4915, promos), 3194.75);
});

test('Coto: "35%Dto" sin condición de cantidad es porcentaje; "Miembros Comunidad" es medio_pago', () => {
  const data = {
    product_list_price: 1000,
    sale_type: ['Hasta 40% DTO!!', 'Todas las Ofertas', 'Miembros Comunidad'],
    discounts: [{ takingText: null, discountText: '35%Dto', discountPrice: '$650' }],
  };
  const promos = parsePromosCoto(data);
  assert.deepEqual(promos, [
    { tipo: 'porcentaje', etiqueta: '35% OFF', descuento: 35, minimo: 1, precioUnitario: 650 },
    { tipo: 'medio_pago', etiqueta: 'Miembros Comunidad' },
  ]);
  assert.equal(precioEfectivo(1000, promos), 650);
});

test('Coto: sin descuentos devuelve lista vacía', () => {
  const x = require('./fixtures/coto-ketchup-natura.json').response.results[0];
  assert.deepEqual(parsePromosCoto(x.data), []);
});
