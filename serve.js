/**
 * Servidor local para el comparador de precios.
 * Uso: node serve.js
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  // Emulate Vercel's /api/scrape serverless function locally
  if (urlPath === '/api/scrape') {
    const handler = require('./api/scrape');
    const mockRes = {
      _status: 200,
      _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      status(code)    { this._status = code; return this; },
      json(data) {
        res.writeHead(this._status, { 'Content-Type': 'application/json', ...this._headers });
        res.end(JSON.stringify(data));
      },
    };
    try {
      await handler(req, mockRes);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static files
  const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  const ext      = path.extname(filePath);
  const mime     = MIME[ext] || 'text/plain; charset=utf-8';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('\n🛒  Comparador de Precios - Servidor iniciado');
  console.log(`    http://localhost:${PORT}\n`);
  console.log('    El scraper corre en tiempo real al abrir la página (~20-30s)\n');
  console.log('    Ctrl+C para detener\n');
});
