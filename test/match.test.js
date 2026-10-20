const { test } = require('node:test');
const assert = require('node:assert/strict');
const { alinear, claveAprox, detectarMarca } = require('../lib/match');

// Ítem mínimo con la forma que producen los adaptadores
const it = (nombre, precio, ean, extra = {}) => ({
  nombre, precio, ean, marca: extra.marca ?? 'NATURA',
  contenido: 'contenido' in extra ? extra.contenido : { valor: 500, unidad: 'g' },
  variantes: extra.variantes ?? [], promos: [], precioEfectivo: precio, _score: extra.score ?? 2,
});

test('alinear: gana el EAN presente en más tiendas, aunque otro sea más barato', () => {
  const porSuper = {
    DIA:       [it('Ketchup Natura 250', 1740, 'B', { contenido: { valor: 250, unidad: 'g' } }), it('Ketchup Natura 500', 3420, 'A')],
    CARREFOUR: [it('Ketchup Natura 250 cc', 1739, 'B', { contenido: { valor: 250, unidad: 'ml' } }), it('Ketchup Natura 500 cc', 3400, 'A')],
    JUMBO:     [it('Ketchup 500 Grs Natura', 3650, 'A')],
  };
  const { match } = alinear(porSuper);
  assert.equal(match.tipo, 'ean');
  assert.equal(match.ean, 'A');
  assert.equal(match.cobertura, 3);
});

test('alinear: a igual cobertura gana el EAN más barato', () => {
  const porSuper = {
    DIA:       [it('Mayonesa Hellmanns 250', 1600, 'H'), it('Mayonesa Natura 250', 1500, 'N')],
    CARREFOUR: [it('Mayonesa Hellmanns 250', 1650, 'H'), it('Mayonesa Natura 250', 1550, 'N')],
  };
  assert.equal(alinear(porSuper).match.ean, 'N');
});

test('alinear: el ítem alineado queda primero en la lista de cada tienda', () => {
  const porSuper = {
    DIA:       [it('Ketchup Natura 250', 1740, 'B'), it('Ketchup Natura 500', 3420, 'A')],
    CARREFOUR: [it('Ketchup Natura 500 cc', 3400, 'A')],
    JUMBO:     [it('Ketchup 500 Grs Natura', 3650, 'A')],
  };
  const { porSuper: out } = alinear(porSuper);
  assert.equal(out.DIA[0].ean, 'A');
  assert.equal(out.DIA[1].ean, 'B');
  assert.equal(out.DIA.length, 2);
});

test('alinear: tienda sin el EAN ganador se completa por marca + contenido + variantes (aprox)', () => {
  const porSuper = {
    DIA:       [it('Ketchup Natura 500 Gr.', 3420, 'A')],
    CARREFOUR: [it('Ketchup Natura 500 cc.', 3400, 'A')],
    COTO:      [it('Ketchup NATURA Pouch 500 Gr', 3422, null)],
  };
  const { match, porSuper: out } = alinear(porSuper);
  assert.equal(match.tipo, 'ean');
  assert.deepEqual(match.porTienda, { DIA: 'ean', CARREFOUR: 'ean', COTO: 'aprox' });
  assert.equal(out.COTO[0].precio, 3422);
});

test('alinear: una variante distinta (light) no se usa como aproximado', () => {
  const porSuper = {
    DIA:       [it('Queso Tregar 290', 3000, 'A', { marca: 'TREGAR', contenido: { valor: 290, unidad: 'g' } })],
    CARREFOUR: [it('Queso Tregar 290', 3100, 'A', { marca: 'TREGAR', contenido: { valor: 290, unidad: 'g' } })],
    COTO:      [it('Queso Tregar Light 290', 2900, null, { marca: 'TREGAR', contenido: { valor: 290, unidad: 'g' }, variantes: ['light'] })],
  };
  const { match, porSuper: out } = alinear(porSuper);
  assert.equal(match.porTienda.COTO, null);
  assert.equal(out.COTO.length, 1); // se conserva como candidato, pero no alineado
  assert.equal(match.faltantes.length, 1);
});

test('alinear: sin EAN compartido agrupa por marca + contenido + variantes', () => {
  const porSuper = {
    DIA:       [it('Yerba Pipore 500', 2400, 'X1', { marca: 'PIPORÉ' })],
    COTO:      [it('Yerba Mate Con Palo Pipore 500g', 2229, null, { marca: 'PIPORE' })],
    CARREFOUR: [it('Yerba Playadito 500', 2000, 'Y1', { marca: 'PLAYADITO' })],
  };
  const { match } = alinear(porSuper);
  assert.equal(match.tipo, 'aprox');
  assert.equal(match.cobertura, 2);
  assert.deepEqual(match.porTienda, { DIA: 'aprox', COTO: 'aprox', CARREFOUR: null });
});

test('alinear: sin ninguna coincidencia entre tiendas devuelve tipo ninguno y deja las listas como estaban', () => {
  const porSuper = {
    DIA:  [it('Cosa A', 100, 'A', { marca: 'A' })],
    COTO: [it('Cosa B', 200, 'B', { marca: 'B' })],
  };
  const { match, porSuper: out } = alinear(porSuper);
  assert.equal(match.tipo, 'ninguno');
  assert.equal(match.cobertura, 0);
  assert.deepEqual(out, porSuper);
});

test('alinear: tiendas sin resultados quedan como faltantes', () => {
  const porSuper = { DIA: [it('K', 10, 'A')], CARREFOUR: [it('K', 11, 'A')], JUMBO: [] };
  const { match } = alinear(porSuper);
  assert.deepEqual(match.faltantes, ['JUMBO']);
});

test('claveAprox: gramos y mililitros se consideran equivalentes; pesable es su propia clave', () => {
  assert.equal(claveAprox(it('a', 1, null, { contenido: { valor: 500, unidad: 'g' } })),
               claveAprox(it('b', 1, null, { contenido: { valor: 500, unidad: 'ml' } })));
  assert.notEqual(claveAprox(it('a', 1, null, { contenido: { valor: 1000, unidad: 'g' } })),
                  claveAprox(it('b', 1, null, { contenido: { valor: 1000, unidad: 'g', pesable: true } })));
  assert.equal(claveAprox(it('a', 1, null, { marca: 'La Serenísima' })), claveAprox(it('b', 1, null, { marca: 'LA SERENISIMA' })));
  assert.equal(claveAprox(it('a', 1, null, { contenido: null })), null);
});

test('detectarMarca: devuelve el token del query que es marca de al menos 2 resultados', () => {
  const items = [
    { marca: 'UNION', nombre: 'Mate Cocido Union 25 Saquitos' },
    { marca: 'SUAVE', nombre: 'Mate Cocido X25 Saq' },
    { marca: 'Unión', nombre: 'Mate cocido Unión filtro x 25 uni' },
  ];
  assert.equal(detectarMarca(items, 'mate cocido union'), 'union');
  assert.equal(detectarMarca(items, 'mate cocido'), null);
  assert.equal(detectarMarca([{ marca: 'DIA', nombre: 'Mayonesa DIA' }], 'mayonesa dia'), null); // una sola coincidencia no alcanza
});

test('alinear: un aproximado con precio fuera de rango (menos de la mitad o más del doble) no se alinea', () => {
  const porSuper = {
    DIA:       [it('Harina 000 Cañuelas 1 Kg', 1039, 'A', { marca: 'CAÑUELAS', contenido: { valor: 1000, unidad: 'g' } })],
    CARREFOUR: [it('Harina 000 Cañuelas 1 kg', 1039, 'A', { marca: 'CAÑUELAS', contenido: { valor: 1000, unidad: 'g' } })],
    COTO:      [it('Harina De Trigo CAÑUELAS 000 Paquete 1 Kg', 195.39, 'Z', { marca: 'CAÑUELAS', contenido: { valor: 1000, unidad: 'g' } })],
  };
  const { match } = alinear(porSuper);
  assert.equal(match.porTienda.COTO, null);
  assert.deepEqual(match.faltantes, ['COTO']);
});

test('alinear: JUMBO y DISCO son el mismo backend, así que un EAN solo en esos dos no cuenta como coincidencia entre tiendas', () => {
  const porSuper = {
    JUMBO: [it('Queso Muzzarella x 220 Gr', 6400, 'Z', { marca: 'LA SERENISIMA', contenido: { valor: 220, unidad: 'g' } })],
    DISCO: [it('Queso Muzzarella x 220 Gr', 6400, 'Z', { marca: 'LA SERENISIMA', contenido: { valor: 220, unidad: 'g' } })],
    CARREFOUR: [it('Mozzarella La Serenísima 500 grs', 13730, 'X', { marca: 'LA SERENISIMA' })],
    COTO: [it('Queso Mozzarella Sin Lactosa 500g', 13205, 'Y', { marca: 'LA SERENISIMA', variantes: ['sin lactosa'] })],
  };
  const { match } = alinear(porSuper);
  assert.equal(match.tipo, 'ninguno');
});

test('alinear: a igual cobertura real, un EAN en DIA+COTO le gana a uno en JUMBO+DISCO+... solo si cubre más backends', () => {
  const porSuper = {
    DIA:   [it('A 500', 100, 'A'), it('B 500', 90, 'B', { contenido: { valor: 300, unidad: 'g' } })],
    COTO:  [it('A 500', 110, 'A')],
    JUMBO: [it('B 500', 90, 'B', { contenido: { valor: 300, unidad: 'g' } })],
    DISCO: [it('B 500', 90, 'B', { contenido: { valor: 300, unidad: 'g' } })],
  };
  // A cubre DIA+COTO (2 backends); B cubre DIA+CENCOSUD (2 backends) y es más barato → gana B
  const r1 = alinear(porSuper);
  assert.equal(r1.match.ean, 'B');
  assert.equal(r1.match.cobertura, 3); // tiendas reales donde se muestra
  // Si B ya no está en DIA, cubre solo CENCOSUD (1 backend) → gana A
  porSuper.DIA = [it('A 500', 100, 'A')];
  assert.equal(alinear(porSuper).match.ean, 'A');
});
