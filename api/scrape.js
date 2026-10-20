/**
 * Vercel Serverless Function — /api/scrape
 * Busca todos los productos en todos los supermercados, alinea el mismo ítem
 * entre tiendas (EAN / aproximado) y preserva los precios manuales (NINI).
 *
 * Respuesta: { [producto]: { DIA: [...], CARREFOUR: [...], ..., NINI?: [...], _match: {...} } }
 */

const path = require('path');
const { SUPERMERCADOS } = require('../lib/stores');
const { compararTodos } = require('../lib/pipeline');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const { productos } = require(path.resolve(__dirname, '../productos.json'));
    let preciosGuardados = {};
    try { preciosGuardados = require(path.resolve(__dirname, '../precios.json')); } catch { /* opcional */ }

    const data = await compararTodos(productos, SUPERMERCADOS, { preciosGuardados, concurrencia: 8 });
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
