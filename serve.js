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

const server = http.createServer((req, res) => {
  const urlPath  = req.url.split('?')[0]; // strip query string
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
  console.log('    Para actualizar precios: node scraper.js');
  console.log('    Ctrl+C para detener\n');
});
