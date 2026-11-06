const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsearVtex, parsearCoto, urlBusquedaVtex, urlEanVtex } = require('../lib/stores');

const fx = (n) => require(`./fixtures/${n}`);

test('parsearVtex: expone ean, contenido, categoría, variantes y promos normalizadas', () => {
  const items = parsearVtex(fx('vtex-dia-ketchup-natura.json'));
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    nombre: 'Ketchup Natura 500 Gr.',
    marca: 'NATURA',
    precio: 3420,
    disponible: true,
    ean: '7791866000664',
    contenido: { valor: 500, unidad: 'g' },
    variantes: [],
    categoria: '/Almacén/Aceites y Aderezos/Ketchup/',
    promos: [],
    precioEfectivo: 3420,
  });
});

test('parsearVtex: el mismo producto tiene el mismo ean en DIA, Carrefour y Jumbo', () => {
  const ean = (n, nombre) => parsearVtex(fx(n)).find((i) => i.nombre === nombre).ean;
  assert.equal(ean('vtex-dia-ketchup-natura.json', 'Ketchup Natura 500 Gr.'), '7791866000664');
  assert.equal(ean('vtex-carrefour-ketchup-natura.json', 'Ketchup Natura 500 cc.'), '7791866000664');
  assert.equal(ean('vtex-jumbo-ketchup-natura.json', 'Ketchup 500 Grs Natura'), '7791866000664');
});

test('parsearVtex: descarta ítems sin precio o no disponibles', () => {
  const data = JSON.parse(JSON.stringify(fx('vtex-dia-ketchup-natura.json')));
  data[0].items[0].sellers[0].commertialOffer.IsAvailable = false;
  data[1].items[0].sellers[0].commertialOffer.Price = 0;
  assert.deepEqual(parsearVtex(data), []);
});

test('parsearVtex: incluye promos de teasers y precio efectivo', () => {
  const items = parsearVtex(fx('vtex-dia-yogur.json'));
  const yog = items.find((i) => i.nombre.startsWith('Yogur Griego Sabor Frutilla'));
  assert.deepEqual(yog.promos, [{ tipo: 'segunda_unidad', etiqueta: '2do al 70%', descuento: 70, minimo: 2 }]);
  assert.equal(yog.precioEfectivo, 1423.5);
});

test('parsearCoto: expone ean como string, contenido, categoría y precio', () => {
  const items = parsearCoto(fx('coto-ketchup-natura.json'));
  assert.deepEqual(items[0], {
    nombre: 'Ketchup NATURA Pouch 500 Gr',
    marca: 'NATURA',
    precio: 3422,
    disponible: true,
    ean: '7791866000664',
    contenido: { valor: 500, unidad: 'g' },
    variantes: [],
    categoria: '/Almacén/Aderezos y Salsas/',
    promos: [],
    precioEfectivo: 3422,
  });
});

test('parsearCoto: descarta resultados con precio desactualizado (priceWithoutTax null)', () => {
  const data = JSON.parse(JSON.stringify(fx('coto-ketchup-natura.json')));
  data.response.results[0].data.price[0].priceWithoutTax = null;
  const items = parsearCoto(data);
  assert.equal(items.length, 3);
  assert.ok(!items.some((i) => i.ean === '7791866000664'));
});

test('parsearCoto: incluye promos con precio efectivo informado por Coto', () => {
  const items = parsearCoto(fx('coto-yogur.json'));
  assert.equal(items[0].precioEfectivo, 3194.75);
  assert.equal(items[0].promos[0].tipo, 'segunda_unidad');
});

test('urls VTEX: búsqueda libre pide 50 resultados y la búsqueda por ean usa alternateIds_Ean', () => {
  assert.equal(urlBusquedaVtex('https://x.com/api/catalog_system/pub/products/search', 'ketchup natura'),
    'https://x.com/api/catalog_system/pub/products/search?ft=ketchup%20natura&_from=0&_to=49');
  assert.equal(urlEanVtex('https://x.com/api/catalog_system/pub/products/search', '7791866000664'),
    'https://x.com/api/catalog_system/pub/products/search?fq=alternateIds_Ean:7791866000664');
});
