const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compararProducto, compararTodos, normalizarEntrada } = require('../lib/pipeline');
const { normalizarItem } = require('../lib/stores');

const it = (nombre, precio, ean, extra = {}) => normalizarItem({ nombre, precio, ean, marca: extra.marca ?? 'NATURA', categoria: extra.categoria ?? '/Almacén/' });

function fakeStore(nombre, catalogo, { porEan = {}, falla = false } = {}) {
  const llamadas = { buscar: [], buscarPorEan: [] };
  return {
    nombre, llamadas,
    buscar: async (q) => { llamadas.buscar.push(q); if (falla) throw new Error('boom'); return catalogo; },
    buscarPorEan: async (ean) => { llamadas.buscarPorEan.push(ean); return porEan[ean] ?? []; },
  };
}

test('normalizarEntrada: acepta string u objeto con q/marca/ean', () => {
  assert.deepEqual(normalizarEntrada('ketchup natura'), { q: 'ketchup natura', marca: null, ean: null });
  assert.deepEqual(normalizarEntrada({ q: 'mayonesa', marca: 'hellmanns', ean: '779' }), { q: 'mayonesa', marca: 'hellmanns', ean: '779' });
});

test('compararProducto: alinea por EAN y expone _match', async () => {
  const stores = [
    fakeStore('DIA',       [it('Ketchup Natura 250 Gr.', 1740, 'B'), it('Ketchup Natura 500 Gr.', 3420, 'A')]),
    fakeStore('CARREFOUR', [it('Ketchup Natura 500 cc.', 3400, 'A')]),
    fakeStore('COTO',      [it('Ketchup NATURA Pouch 500 Gr', 3422, 'A')]),
  ];
  const r = await compararProducto('ketchup natura', stores);
  assert.equal(r._match.tipo, 'ean');
  assert.equal(r._match.ean, 'A');
  assert.equal(r.DIA[0].ean, 'A');
  assert.equal(r.DIA.length, 2);
});

test('compararProducto: si a una tienda le falta el EAN ganador, lo busca directo por EAN', async () => {
  const faltante = it('Ketchup 500 Grs Natura', 3650, 'A');
  const stores = [
    fakeStore('DIA',       [it('Ketchup Natura 500 Gr.', 3420, 'A')]),
    fakeStore('CARREFOUR', [it('Ketchup Natura 500 cc.', 3400, 'A')]),
    fakeStore('JUMBO',     [it('Ketchup Natura 250 Gr', 1850, 'B')], { porEan: { A: [faltante] } }),
  ];
  const r = await compararProducto('ketchup natura', stores);
  assert.deepEqual(stores[2].llamadas.buscarPorEan, ['A']);
  assert.deepEqual(stores[0].llamadas.buscarPorEan, []); // las que ya lo tienen no consultan
  assert.equal(r.JUMBO[0].ean, 'A');
  assert.equal(r._match.porTienda.JUMBO, 'ean');
  assert.equal(r._match.cobertura, 3);
});

test('compararProducto: excluye mascotas y exige marca detectada en el query', async () => {
  const stores = [
    fakeStore('DIA', [
      it('Atún Desmenuzado Al Natural Dia 170 Gr.', 1390, 'D1', { marca: 'DIA' }),
      it('Alimento Gato Sabor Atun Felix 85 Gr.', 1450, 'F1', { marca: 'FELIX', categoria: '/Mascotas/Gatos/' }),
    ]),
    fakeStore('COTO', [
      it('Atun En Aceite Ciudad Del Lago 170 Gr', 1549, 'C1', { marca: 'CIUDAD DEL LAGO' }),
      it('Alimento Gato Whiskas Atun 85 Gr', 1200, 'W1', { marca: 'WHISKAS', categoria: '/Mascotas/' }),
    ]),
  ];
  const r = await compararProducto('atun', stores);
  assert.deepEqual(r.DIA.map((i) => i.ean), ['D1']);
  assert.deepEqual(r.COTO.map((i) => i.ean), ['C1']);
  assert.equal(r._match.tipo, 'ninguno');
});

test('compararProducto: una tienda que falla devuelve lista vacía sin romper el resto', async () => {
  const stores = [
    fakeStore('DIA', [it('Ketchup Natura 500 Gr.', 3420, 'A')]),
    fakeStore('COTO', [], { falla: true }),
  ];
  const r = await compararProducto('ketchup natura', stores);
  assert.deepEqual(r.COTO, []);
  assert.equal(r.DIA.length, 1);
});

test('compararProducto: entrada con marca explícita filtra por esa marca', async () => {
  const stores = [
    fakeStore('DIA',  [it('Mayonesa Hellmanns 250', 1600, 'H', { marca: 'HELLMANNS' }), it('Mayonesa Natura 250', 1500, 'N')]),
    fakeStore('COTO', [it('Mayonesa Hellmanns 250', 1650, 'H', { marca: 'HELLMANNS' }), it('Mayonesa Natura 250', 1550, 'N')]),
  ];
  const r = await compararProducto({ q: 'mayonesa', marca: 'hellmanns' }, stores);
  assert.equal(r._match.ean, 'H');
  assert.deepEqual(r.DIA.map((i) => i.ean), ['H']);
});

test('compararTodos: conserva precios manuales (NINI) y usa el texto del producto como clave', async () => {
  const stores = [fakeStore('DIA', [it('Ketchup Natura 500 Gr.', 3420, 'A')])];
  const guardados = { 'ketchup natura': { NINI: [{ nombre: 'Ketchup Natura 500', precio: 3000 }] } };
  const data = await compararTodos(['ketchup natura', { q: 'mayonesa', marca: 'natura' }], stores, { preciosGuardados: guardados, concurrencia: 2 });
  assert.deepEqual(Object.keys(data), ['ketchup natura', 'mayonesa']);
  assert.deepEqual(data['ketchup natura'].NINI, [{ nombre: 'Ketchup Natura 500', precio: 3000 }]);
  assert.equal(data['mayonesa'].NINI, undefined);
});
