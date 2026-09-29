// Статический сервер предпросмотра C-фронта (ноль зависимостей).
// Mock живёт в браузере (js/lib/mock.js) и включён по умолчанию, пока API B не готов.
// Настоящий backend: открыть http://localhost:PORT/?api=https://backend-host — UI пойдёт в реальный /api/v1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = +(process.argv[process.argv.indexOf('--port') + 1] ?? 5173) || 5173;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.pdf': 'application/pdf' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = path.normalize(path.join(root, url.pathname === '/' ? 'index.html' : '.' + url.pathname));
  if (!p.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(p, (err, buf) => {
    if (err) {
      // SPA-fallback для hash-роутера не нужен (всё после #), отдаём 404 честно.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(port, () => console.log(`C-frontend preview: http://localhost:${port}/ (mock по умолчанию; ?api=<base> — настоящий backend)`));
