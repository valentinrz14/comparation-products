/**
 * Pipeline de comparación: búsqueda → filtro de relevancia → ranking →
 * alineación entre tiendas (EAN / aproximado) → segunda pasada por EAN.
 */

const { rankear, filtrarRelevantes } = require('./text');
const { alinear, detectarMarca } = require('./match');

// productos.json acepta strings ("ketchup natura") u objetos ({ q, marca, ean })
function normalizarEntrada(entrada) {
  if (typeof entrada === 'string') return { q: entrada, marca: null, ean: null };
  return { q: entrada.q, marca: entrada.marca ?? null, ean: entrada.ean ? String(entrada.ean) : null };
}
function claveEntrada(entrada) {
  return typeof entrada === 'string' ? entrada : entrada.q;
}

async function buscarEnTodas(stores, q) {
  const res = await Promise.allSettled(stores.map((s) => s.buscar(q)));
  const porSuper = {};
  stores.forEach((s, i) => { porSuper[s.nombre] = res[i].status === 'fulfilled' ? (res[i].value ?? []) : []; });
  return porSuper;
}

async function compararProducto(entrada, stores) {
  const { q, marca: marcaExplicita, ean: eanExplicito } = normalizarEntrada(entrada);
  const crudo = await buscarEnTodas(stores, q);

  const todos = Object.values(crudo).flat();
  const marca = marcaExplicita ?? detectarMarca(todos, q);

  let porSuper = {};
  for (const [tienda, items] of Object.entries(crudo)) {
    let relevantes = filtrarRelevantes(items, q, { marca });
    if (eanExplicito) relevantes = relevantes.filter((i) => i.ean === eanExplicito);
    porSuper[tienda] = rankear(relevantes, q);
  }

  let resultado = alinear(porSuper);
  const eanObjetivo = eanExplicito ?? (resultado.match.tipo === 'ean' ? resultado.match.ean : null);

  // Segunda pasada: tiendas sin el EAN ganador lo buscan directo
  if (eanObjetivo) {
    const pendientes = stores.filter((s) => s.buscarPorEan && resultado.match.porTienda[s.nombre] !== 'ean');
    if (pendientes.length) {
      const extra = await Promise.allSettled(pendientes.map((s) => s.buscarPorEan(eanObjetivo)));
      let hubo = false;
      pendientes.forEach((s, i) => {
        const items = extra[i].status === 'fulfilled' ? (extra[i].value ?? []).filter((it) => it.ean === eanObjetivo) : [];
        if (!items.length) return;
        hubo = true;
        const rankeados = rankear(items, q);
        const conScore  = rankeados.length ? rankeados : items.map((it) => ({ ...it, _score: 0 }));
        porSuper[s.nombre] = [...conScore, ...porSuper[s.nombre].filter((it) => it.ean !== eanObjetivo)];
      });
      if (hubo) resultado = alinear(porSuper);
    }
  }

  return { ...resultado.porSuper, _match: resultado.match };
}

async function pLimit(tasks, concurrency) {
  const results = new Array(tasks.length);
  let idx = 0;
  const worker = async () => {
    while (idx < tasks.length) { const i = idx++; results[i] = await tasks[i](); }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

async function compararTodos(productos, stores, { preciosGuardados = {}, concurrencia = 8, onProgreso } = {}) {
  const tasks = productos.map((entrada, i) => async () => {
    const clave = claveEntrada(entrada);
    const r = await compararProducto(entrada, stores);
    // Precios cargados a mano (tickets NINI) — no se scrapean, se preservan
    if (preciosGuardados[clave]?.NINI?.length) r.NINI = preciosGuardados[clave].NINI;
    onProgreso?.(i, clave, r);
    return r;
  });
  const results = await pLimit(tasks, concurrencia);
  const data = {};
  productos.forEach((entrada, i) => { data[claveEntrada(entrada)] = results[i]; });
  return data;
}

module.exports = { compararProducto, compararTodos, normalizarEntrada, claveEntrada, pLimit };
