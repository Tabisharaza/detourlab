import http from 'node:http';
import * as fileSystem from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)), process.argv.includes('--dist') ? 'dist' : '.');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
// Keep the request boundary importable for deterministic I/O-failure tests.
// The optional filesystem adapter does not change the CLI's normal disk reads.
export function createRequestHandler(directory = root, fs = fileSystem) {
  const sourceRoot = path.resolve(directory);
  return async (req,res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return; }
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const full = path.resolve(sourceRoot,relative);
      if (!full.startsWith(sourceRoot + path.sep) || relative.split('/').some(s=>s.startsWith('.')) || !['index.html','src','public','examples'].includes(relative.split('/')[0])) { res.writeHead(404);res.end('Not found');return; }
      if (!(await fs.stat(full)).isFile()) throw new Error('Not a file');
      // A rebuild can remove an asset between stat and readFile. Do not commit a
      // successful response until all GET bytes are available: a second writeHead
      // from the error path would reject this async handler and stop the server.
      const body = req.method === 'HEAD' ? undefined : await fs.readFile(full);
      res.writeHead(200,{'Content-Type':types[path.extname(full)] || 'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",'Referrer-Policy':'no-referrer'});
      res.end(body);
    } catch {res.writeHead(404);res.end('Not found');}
  };
}

if (import.meta.main) {
  const port = Number(process.env.PORT || 4173);
  const server = http.createServer(createRequestHandler());
  server.listen(port,'127.0.0.1',()=>console.log(`DetourLab → http://127.0.0.1:${port}`));
}
