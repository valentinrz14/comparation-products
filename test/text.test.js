const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractContent } = require('../lib/text');

test('extractContent: gramos con distintas notaciones se normalizan a g', () => {
  assert.deepEqual(extractContent('Ketchup Natura 500 Gr.'),      { valor: 500, unidad: 'g' });
  assert.deepEqual(extractContent('Ketchup 500 Grs Natura'),      { valor: 500, unidad: 'g' });
  assert.deepEqual(extractContent('Queso Crema Light Tregar Pot 190 Grm'), { valor: 190, unidad: 'g' });
  assert.deepEqual(extractContent('Yogur Batido SER Pro+ 175g'),  { valor: 175, unidad: 'g' });
});

test('extractContent: kilos se convierten a gramos', () => {
  assert.deepEqual(extractContent('Arroz Integral Dos Hermanos Paq 1 Kgm'), { valor: 1000, unidad: 'g' });
  assert.deepEqual(extractContent('Queso Reggianito Rallado 0.130 Kg x 1 Un La Serenisima'), { valor: 130, unidad: 'g' });
  assert.deepEqual(extractContent('Azucar Ledesma Superior X 1kg'), { valor: 1000, unidad: 'g' });
});

test('extractContent: volumen se normaliza a ml', () => {
  assert.deepEqual(extractContent('Ketchup Natura 500 cc.'),   { valor: 500, unidad: 'ml' });
  assert.deepEqual(extractContent('Leche Protein La Serenisima 1 Lt.'), { valor: 1000, unidad: 'ml' });
  assert.deepEqual(extractContent('Leche Protein La Serenisima 1L'), { valor: 1000, unidad: 'ml' });
  assert.deepEqual(extractContent('Jugo De Limón Silva 500cmq'), { valor: 500, unidad: 'ml' });
});

test('extractContent: unidades sueltas se normalizan a un', () => {
  assert.deepEqual(extractContent('Caldo Verdura Balance Knorr 12 Ud.'),  { valor: 12, unidad: 'un' });
  assert.deepEqual(extractContent('Mate cocido Unión filtro x 25 uni'),   { valor: 25, unidad: 'un' });
  assert.deepEqual(extractContent('Mate Cocido Union 25 Saquitos'),       { valor: 25, unidad: 'un' });
  assert.deepEqual(extractContent('Tortillas Integrales Rapiditas 10u'),  { valor: 10, unidad: 'un' });
  assert.deepEqual(extractContent('Salchichas Paty viena tipo alemana 4 u.'), { valor: 4, unidad: 'un' });
});

test('extractContent: si hay peso y unidades, gana el peso', () => {
  assert.deepEqual(extractContent('Caldo Sabor Verduras Balance x 12 Un 114 Grs Knorr'), { valor: 114, unidad: 'g' });
  assert.deepEqual(extractContent('Salchichas Clasicas X6 Ud Paty Viena 230 Gr.'), { valor: 230, unidad: 'g' });
});

test('extractContent: venta por kilo se marca como pesable', () => {
  assert.deepEqual(extractContent('Queso Port Salut La Serenísima X Kg'), { valor: 1000, unidad: 'g', pesable: true });
  assert.deepEqual(extractContent('Queso Por Salut Sin Lactosa La Serenisima x Kg.'), { valor: 1000, unidad: 'g', pesable: true });
});

test('extractContent: sin contenido devuelve null', () => {
  assert.equal(extractContent('Palta Hass'), null);
  assert.equal(extractContent(''), null);
});

const { tokens, scoreMatch, rankear, extractVariants, filtrarRelevantes } = require('../lib/text');

test('tokens: quita stopwords y acentos pero conserva "sin" y "por"', () => {
  assert.deepEqual(tokens('Queso Por Salut Sin Lactosa La Serenísima x Kg.'),
    ['queso', 'por', 'salut', 'sin', 'lactosa', 'serenisima', 'kg.']);
});

test('scoreMatch: cuenta tokens del query presentes en el nombre, con prefijos cortos', () => {
  assert.equal(scoreMatch('Yogur Batido Ser PRO+ Con Proteínas', 'yogurt batido Ser PRO'), 4);
  assert.equal(scoreMatch('Yogur Serenisima', 'yogurt ser'), 1); // ser ≠ serenisima
});

test('rankear: exige 80% de tokens y ordena por score y precio', () => {
  const items = [
    { nombre: 'Ketchup Natura 500 Gr.', precio: 3420 },
    { nombre: 'Ketchup Natura 250 Gr.', precio: 1740 },
    { nombre: 'Ketchup Hellmanns 250 Gr.', precio: 1500 },
    { nombre: 'Ketchup Natura sin precio', precio: 0 },
  ];
  assert.deepEqual(rankear(items, 'ketchup natura').map((i) => i.nombre),
    ['Ketchup Natura 250 Gr.', 'Ketchup Natura 500 Gr.']);
});

test('extractVariants: detecta variantes que cambian el producto', () => {
  assert.deepEqual(extractVariants('Queso Port Salut light La Serenísima sin lactosa x kg.'), ['light', 'sin lactosa']);
  assert.deepEqual(extractVariants('Leche en polvo descremada fortificada La Serenísima 200 g.'), ['descremada']);
  assert.deepEqual(extractVariants('Leche En Polvo La Serenisima Descremada 200 Gr.'), ['descremada']);
  assert.deepEqual(extractVariants('Arvejas sin sal agregada 300 Grs'), ['sin sal']);
  assert.deepEqual(extractVariants('Ketchup Natura 500 Gr.'), []);
});

test('extractVariants: sinónimos se normalizan a una sola forma', () => {
  assert.deepEqual(extractVariants('Ricotta Descremado Sin Sal Tregar 290g'), ['descremada', 'sin sal']);
  assert.deepEqual(extractVariants('Ricotta Tregar magra bajo sodio en pote 290 g.'), ['descremada', 'sin sal']);
  assert.deepEqual(extractVariants('Ricotta Entero Tregar 290g'), ['entera']);
});

test('filtrarRelevantes: excluye categoría Mascotas cuando el query no es de mascotas', () => {
  const items = [
    { nombre: 'Atún Desmenuzado Al Natural Dia 170 Gr.', marca: 'DIA',   categoria: '/Almacén/Conservas/Pescados/', precio: 1390 },
    { nombre: 'Alimento Humedo Para Gatos Sabor Atun Felix 85 Gr.', marca: 'FELIX', categoria: '/Mascotas/Gatos/Alimento Húmedo/', precio: 1450 },
  ];
  assert.deepEqual(filtrarRelevantes(items, 'atun').map((i) => i.marca), ['DIA']);
});

test('filtrarRelevantes: conserva Mascotas si el query nombra la marca o es de mascotas', () => {
  const items = [
    { nombre: 'Alimento Gato Fancy Feast Goulash 85 Gr', marca: 'FANCY FEAST', categoria: '/Mascotas/Gatos/', precio: 1000 },
    { nombre: 'Alimento Gato Whiskas Pescado 85 Gr', marca: 'WHISKAS', categoria: '/Mascotas/Gatos/', precio: 900 },
  ];
  assert.deepEqual(filtrarRelevantes(items, 'fancy feast goulash').map((i) => i.marca), ['FANCY FEAST']);
  assert.equal(filtrarRelevantes(items, 'alimento gato').length, 2);
});

test('filtrarRelevantes: si el query nombra una marca, exige que la marca coincida', () => {
  const items = [
    { nombre: 'Mate Cocido Union 25 Saquitos', marca: 'UNION', categoria: '/Almacén/', precio: 1450 },
    { nombre: 'Mate Cocido X25 Saq Cja 75 Grm', marca: 'SUAVE', categoria: '/Almacén/', precio: 1364 }, // Coto: marca mal cargada pero nombre sin "union"
    { nombre: 'Mate Cocido Union X25 Saq', marca: 'SUAVE', categoria: '/Almacén/', precio: 1364 },        // marca mal cargada, nombre dice Union
  ];
  assert.deepEqual(filtrarRelevantes(items, 'mate cocido union', { marca: 'union' }).map((i) => i.precio), [1450, 1364]);
});

test('norm/tokens: toleran valores que no son string (marca como array o número)', () => {
  const { norm } = require('../lib/text');
  assert.equal(norm(['La Serenísima']), 'la serenisima');
  assert.equal(norm(123), '123');
  assert.equal(norm(null), '');
  assert.deepEqual(tokens(undefined), []);
});

test('tokenMatch: los tokens numéricos solo matchean si son iguales (000 ≠ 0000)', () => {
  const { tokenMatch } = require('../lib/text');
  assert.equal(tokenMatch('000', '0000'), false);
  assert.equal(tokenMatch('000', '000'), true);
  assert.equal(scoreMatch('Harina 000 Pureza Ultra Refinada 1 Kg.', 'harina 0000 pureza'), 2);
});

test('tokenMatch: tolera un error de tipeo en tokens largos, no en cortos', () => {
  const { tokenMatch } = require('../lib/text');
  assert.equal(tokenMatch('luchetti', 'lucchetti'), true);
  assert.equal(tokenMatch('serenisma', 'serenisima'), true);
  assert.equal(tokenMatch('ser', 'set'), false);
  assert.equal(tokenMatch('pan', 'paty'), false);
});

test('extractVariants: leudante es una variante de harina', () => {
  assert.deepEqual(extractVariants('Harina Leudante 0000 1 Kg Pureza'), ['leudante']);
});
